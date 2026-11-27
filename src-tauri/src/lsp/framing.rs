//! The framing language servers use over standard input and output: each JSON-RPC message is
//! preceded by HTTP-style headers, of which only `Content-Length` (the body's size in bytes)
//! matters.
//!
//! ```text
//! Content-Length: 52\r\n
//! \r\n
//! {"jsonrpc":"2.0","method":"initialized","params":{}}
//! ```

use std::fmt;

/// The longest header block accepted. Real ones are under 100 bytes; anything longer means the
/// server is printing something other than the protocol.
pub const MAX_HEADER: usize = 8 * 1024;
/// The largest message accepted from a server.
pub const MAX_BODY: usize = 64 * 1024 * 1024;

const HEADER_END: &[u8] = b"\r\n\r\n";

/// Why a server's output stopped making sense. After any of these the stream cannot be trusted
/// again, since there is no telling where the next message starts.
#[derive(Debug, PartialEq)]
pub enum FrameError {
    /// More than `MAX_HEADER` bytes without the blank line that ends the headers.
    HeaderTooLong,
    /// The headers are not text, or a line in them is not `Name: value`.
    BadHeader,
    /// No `Content-Length` header, or one that is not a number.
    NoLength,
    /// A message longer than the decoder's limit, with the length it announced.
    TooLarge(usize),
    /// A message that is not UTF-8.
    NotText,
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            FrameError::HeaderTooLong => write!(f, "it printed something that is not a language server message"),
            FrameError::BadHeader => write!(f, "it sent a message with a malformed header"),
            FrameError::NoLength => write!(f, "it sent a message without a valid Content-Length"),
            FrameError::TooLarge(bytes) => write!(f, "it sent a message of {bytes} bytes, which is more than Longhand accepts"),
            FrameError::NotText => write!(f, "it sent a message that is not UTF-8 text"),
        }
    }
}

/// Wraps one message for sending: the header, a blank line, then the message.
pub fn encode(message: &str) -> Vec<u8> {
    let mut frame = format!("Content-Length: {}\r\n\r\n", message.len()).into_bytes();
    frame.extend_from_slice(message.as_bytes());
    frame
}

/// Turns a byte stream into messages, however the bytes are split across reads. Feed it with
/// `push` and take messages with `pop` until it returns `None`; taking every message before
/// pushing more keeps the buffer no larger than one message plus one read.
pub struct Decoder {
    buffer: Vec<u8>,
    /// The length of the message whose headers have been read and removed from the buffer.
    body: Option<usize>,
    max_body: usize,
}

impl Decoder {
    /// A decoder that refuses messages longer than `max_body` bytes.
    pub fn new(max_body: usize) -> Decoder {
        Decoder { buffer: Vec::new(), body: None, max_body }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    /// The next complete message, `None` when more bytes are needed first.
    pub fn pop(&mut self) -> Result<Option<String>, FrameError> {
        let length = match self.body {
            Some(length) => length,
            None => {
                let Some(length) = self.take_header()? else { return Ok(None) };
                self.body = Some(length);
                length
            }
        };
        if self.buffer.len() < length {
            return Ok(None);
        }
        self.body = None;
        let body: Vec<u8> = self.buffer.drain(..length).collect();
        String::from_utf8(body).map(Some).map_err(|_| FrameError::NotText)
    }

    /// Removes a complete header block from the front of the buffer and returns the body length
    /// it announces, or `None` when the block has not all arrived.
    fn take_header(&mut self) -> Result<Option<usize>, FrameError> {
        let searched = &self.buffer[..self.buffer.len().min(MAX_HEADER + HEADER_END.len())];
        let Some(end) = searched.windows(HEADER_END.len()).position(|window| window == HEADER_END) else {
            return if self.buffer.len() > MAX_HEADER { Err(FrameError::HeaderTooLong) } else { Ok(None) };
        };
        let length = content_length(&self.buffer[..end])?;
        if length > self.max_body {
            return Err(FrameError::TooLarge(length));
        }
        self.buffer.drain(..end + HEADER_END.len());
        Ok(Some(length))
    }
}

/// The value of the `Content-Length` header in a header block. Other headers (servers may send
/// `Content-Type`) are checked for shape and ignored.
fn content_length(headers: &[u8]) -> Result<usize, FrameError> {
    let headers = std::str::from_utf8(headers).map_err(|_| FrameError::BadHeader)?;
    let mut length = None;
    for line in headers.split("\r\n") {
        let (name, value) = line.split_once(':').ok_or(FrameError::BadHeader)?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            length = Some(value.trim().parse::<usize>().map_err(|_| FrameError::NoLength)?);
        }
    }
    length.ok_or(FrameError::NoLength)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every message the decoder yields from `chunks`, or the error that stopped it.
    fn decode(chunks: &[&[u8]]) -> Result<Vec<String>, FrameError> {
        let mut decoder = Decoder::new(MAX_BODY);
        let mut messages = Vec::new();
        for chunk in chunks {
            decoder.push(chunk);
            while let Some(message) = decoder.pop()? {
                messages.push(message);
            }
        }
        Ok(messages)
    }

    #[test]
    fn a_message_is_sent_with_its_length_in_bytes() {
        assert_eq!(encode("{}"), b"Content-Length: 2\r\n\r\n{}");
        // "é" is two bytes: the length counts bytes, not characters.
        assert_eq!(encode("{\"a\":\"é\"}"), "Content-Length: 10\r\n\r\n{\"a\":\"é\"}".as_bytes());
    }

    #[test]
    fn what_is_encoded_decodes_to_the_same_message() {
        let message = r#"{"jsonrpc":"2.0","id":1,"result":{"label":"naïve ✓"}}"#;
        assert_eq!(decode(&[&encode(message)]), Ok(vec![message.to_string()]));
    }

    #[test]
    fn several_messages_in_one_read_come_out_in_order() {
        let stream = [encode("{\"id\":1}"), encode("{\"id\":2}"), encode("{\"id\":3}")].concat();
        assert_eq!(decode(&[&stream]).unwrap(), ["{\"id\":1}", "{\"id\":2}", "{\"id\":3}"]);
    }

    #[test]
    fn a_stream_split_anywhere_gives_the_same_messages() {
        let stream = [encode("{\"id\":1}"), encode("{\"text\":\"é\"}"), encode("{}")].concat();
        let whole = decode(&[&stream]).unwrap();
        // One byte at a time splits every header, every blank line and every character.
        let bytes: Vec<&[u8]> = stream.chunks(1).collect();
        assert_eq!(decode(&bytes).unwrap(), whole);
        for at in 1..stream.len() {
            assert_eq!(decode(&[&stream[..at], &stream[at..]]).unwrap(), whole, "split at byte {at}");
        }
    }

    #[test]
    fn nothing_comes_out_until_the_whole_message_has_arrived() {
        let frame = encode("{\"id\":1}");
        let mut decoder = Decoder::new(MAX_BODY);
        decoder.push(&frame[..frame.len() - 1]);
        assert_eq!(decoder.pop(), Ok(None));
        decoder.push(&frame[frame.len() - 1..]);
        assert_eq!(decoder.pop(), Ok(Some("{\"id\":1}".to_string())));
        assert_eq!(decoder.pop(), Ok(None));
    }

    #[test]
    fn a_large_message_survives_many_small_reads() {
        let message = format!("{{\"text\":\"{}\"}}", "x".repeat(3 * 1024 * 1024));
        let frame = encode(&message);
        let chunks: Vec<&[u8]> = frame.chunks(4096).collect();
        assert_eq!(decode(&chunks).unwrap(), [message]);
    }

    #[test]
    fn other_headers_and_any_letter_case_are_accepted() {
        let frame = b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-LENGTH:  2 \r\n\r\n{}";
        assert_eq!(decode(&[frame]).unwrap(), ["{}"]);
    }

    #[test]
    fn an_empty_message_is_still_a_message() {
        assert_eq!(decode(&[b"Content-Length: 0\r\n\r\n", &encode("{}")]).unwrap(), ["", "{}"]);
    }

    #[test]
    fn headers_without_a_usable_length_are_refused() {
        assert_eq!(decode(&[b"Content-Type: text/plain\r\n\r\n{}"]), Err(FrameError::NoLength));
        assert_eq!(decode(&[b"Content-Length: two\r\n\r\n{}"]), Err(FrameError::NoLength));
        assert_eq!(decode(&[b"Content-Length: -1\r\n\r\n{}"]), Err(FrameError::NoLength));
        assert_eq!(decode(&[b"Content-Length: 99999999999999999999999\r\n\r\n{}"]), Err(FrameError::NoLength));
    }

    #[test]
    fn output_that_is_not_the_protocol_is_refused() {
        assert_eq!(decode(&[b"Traceback (most recent call last)\r\n\r\n"]), Err(FrameError::BadHeader));
        assert_eq!(decode(&[b"Content-Length: 2\r\n\xff\xfe: 1\r\n\r\n{}"]), Err(FrameError::BadHeader));
        // Bare line feeds do not end a header block, so this never becomes a message.
        assert_eq!(decode(&[b"Content-Length: 2\n\n{}"]), Ok(vec![]));
    }

    #[test]
    fn a_header_that_never_ends_is_refused_rather_than_buffered() {
        let noise = vec![b'a'; MAX_HEADER];
        let mut decoder = Decoder::new(MAX_BODY);
        decoder.push(&noise);
        assert_eq!(decoder.pop(), Ok(None), "it could still be a long header");
        decoder.push(b"b");
        assert_eq!(decoder.pop(), Err(FrameError::HeaderTooLong));
        // A blank line that comes only after the limit does not rescue it.
        assert_eq!(decode(&[&[noise.as_slice(), b"aaaaaaaa\r\n\r\n"].concat()]), Err(FrameError::HeaderTooLong));
    }

    #[test]
    fn a_message_over_the_limit_is_refused_before_it_is_read() {
        let mut decoder = Decoder::new(16);
        decoder.push(b"Content-Length: 16\r\n\r\n0123456789abcdef");
        assert_eq!(decoder.pop(), Ok(Some("0123456789abcdef".to_string())));
        decoder.push(b"Content-Length: 17\r\n\r\n");
        assert_eq!(decoder.pop(), Err(FrameError::TooLarge(17)));
    }

    #[test]
    fn a_message_that_is_not_utf8_is_refused() {
        assert_eq!(decode(&[b"Content-Length: 2\r\n\r\n\xff\xfe"]), Err(FrameError::NotText));
    }
}
