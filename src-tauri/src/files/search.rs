//! Find in files: plain-text search over the indexed files, optionally matching case and whole
//! words. Large and binary files are skipped, results are capped, and a newer search cancels
//! an older one.

use serde::Serialize;
use std::fs;
use std::path::Path;

/// More than a student can read; past this the result says it is incomplete.
const MAX_HITS: usize = 500;
/// Larger files are data or generated output, not code to search.
const MAX_SEARCH_BYTES: u64 = 1024 * 1024;
/// How much of a long line is shown around its first match, in characters.
const SHOWN_CHARS: usize = 200;
const CONTEXT_BEFORE: usize = 30;

pub struct Matcher {
    needle: Vec<char>,
    case_sensitive: bool,
    whole_word: bool,
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

impl Matcher {
    pub fn new(query: &str, case_sensitive: bool, whole_word: bool) -> Self {
        let mut m = Matcher { needle: Vec::new(), case_sensitive, whole_word };
        m.needle = query.chars().map(|c| m.fold(c)).collect();
        m
    }

    /// One character to one character, so positions in the folded text are positions in the line.
    fn fold(&self, c: char) -> char {
        if self.case_sensitive {
            c
        } else {
            c.to_lowercase().next().unwrap_or(c)
        }
    }

    fn folded(&self, text: &str) -> Vec<char> {
        text.chars().map(|c| self.fold(c)).collect()
    }

    /// Whether `text` could hold a match: a quick check before going line by line.
    fn may_match(&self, text: &str) -> bool {
        let needle: String = self.needle.iter().collect();
        if self.case_sensitive {
            text.contains(&needle)
        } else {
            text.chars().map(|c| self.fold(c)).collect::<String>().contains(&needle)
        }
    }

    /// The matches in `line`, as character ranges that do not overlap.
    pub fn find(&self, line: &str) -> Vec<(usize, usize)> {
        let hay = self.folded(line);
        let n = self.needle.len();
        let mut found = Vec::new();
        if n == 0 || hay.len() < n {
            return found;
        }
        // A side that starts or ends with a word character must sit at a word boundary.
        let check_start = self.whole_word && is_word(self.needle[0]);
        let check_end = self.whole_word && is_word(self.needle[n - 1]);
        let mut i = 0;
        while i + n <= hay.len() {
            let fits = hay[i..i + n] == self.needle[..]
                && !(check_start && i > 0 && is_word(hay[i - 1]))
                && !(check_end && i + n < hay.len() && is_word(hay[i + n]));
            if fits {
                found.push((i, i + n));
                i += n;
            } else {
                i += 1;
            }
        }
        found
    }
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub path: String,
    pub line: usize,
    /// The line, trimmed and cut to a window around its first match.
    pub text: String,
    /// The matches within `text`, as [start, end) in UTF-16 units, the way JavaScript counts.
    pub ranges: Vec<(usize, usize)>,
}

#[derive(Debug, Default, Serialize)]
pub struct Found {
    pub hits: Vec<Hit>,
    /// How many files had at least one hit.
    pub files: usize,
    pub truncated: bool,
    /// Files skipped for being larger than MAX_SEARCH_BYTES.
    pub skipped: usize,
}

/// Cuts `line` to what is shown and moves the match ranges along with it.
fn shown(line: &str, matches: &[(usize, usize)]) -> (String, Vec<(usize, usize)>) {
    let chars: Vec<char> = line.chars().collect();
    let lead = chars.iter().take_while(|c| c.is_whitespace()).count();
    let first = matches.first().map_or(lead, |m| m.0);
    let (start, prefix) = if first > lead + CONTEXT_BEFORE + 10 { (first - CONTEXT_BEFORE, "…") } else { (lead, "") };
    let end = (start + SHOWN_CHARS).min(chars.len());
    let end = chars[..end].iter().rposition(|c| !c.is_whitespace()).map_or(start, |i| i + 1).max(start);
    let utf16 = |from: usize, to: usize| chars[from..to].iter().map(|c| c.len_utf16()).sum::<usize>();
    let offset = prefix.encode_utf16().count();
    let ranges = matches
        .iter()
        .filter(|m| m.0 >= start && m.0 < end)
        .map(|&(a, b)| (offset + utf16(start, a), offset + utf16(start, b.min(end))))
        .collect();
    (format!("{prefix}{}", chars[start..end].iter().collect::<String>()), ranges)
}

/// Searches `files` (relative to `root`) in order. Returns None if `cancelled` turned true.
pub fn search(root: &Path, files: &[String], matcher: &Matcher, cancelled: impl Fn() -> bool) -> Option<Found> {
    let mut found = Found::default();
    for rel in files {
        if cancelled() {
            return None;
        }
        let path = root.join(rel);
        let Ok(meta) = fs::metadata(&path) else { continue };
        if meta.len() > MAX_SEARCH_BYTES {
            found.skipped += 1;
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        if bytes.iter().take(8000).any(|b| *b == 0) {
            continue;
        }
        let Ok(text) = String::from_utf8(bytes) else { continue };
        if !matcher.may_match(&text) {
            continue;
        }
        let before = found.hits.len();
        for (i, line) in text.lines().enumerate() {
            let matches = matcher.find(line);
            if matches.is_empty() {
                continue;
            }
            if found.hits.len() >= MAX_HITS {
                found.truncated = true;
                break;
            }
            let (text, ranges) = shown(line, &matches);
            found.hits.push(Hit { path: rel.clone(), line: i + 1, text, ranges });
        }
        if found.hits.len() > before {
            found.files += 1;
        }
        if found.truncated {
            break;
        }
    }
    Some(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn matches_ignore_case_unless_asked() {
        assert_eq!(Matcher::new("mean", false, false).find("Mean = mean + MEAN"), [(0, 4), (7, 11), (14, 18)]);
        assert_eq!(Matcher::new("mean", true, false).find("Mean = mean + MEAN"), [(7, 11)]);
    }

    #[test]
    fn whole_words_need_boundaries_where_the_query_has_word_characters() {
        let m = Matcher::new("mean", false, true);
        assert_eq!(m.find("self.mean += delta / mean_count"), [(5, 9)]);
        assert_eq!(m.find("running_mean"), []);
        assert_eq!(Matcher::new("(x", false, true).find("f(x) + g(xs)"), [(1, 3)]);
    }

    #[test]
    fn matches_do_not_overlap() {
        assert_eq!(Matcher::new("aa", false, false).find("aaaa"), [(0, 2), (2, 4)]);
    }

    #[test]
    fn shown_text_is_trimmed_and_ranges_follow_it() {
        let line = "        return self.sum_sq";
        let (text, ranges) = shown(line, &Matcher::new("sum_sq", false, false).find(line));
        assert_eq!(text, "return self.sum_sq");
        assert_eq!(ranges, [(12, 18)]);
    }

    #[test]
    fn long_lines_are_cut_around_the_first_match() {
        let line = format!("{}needle{}", "x".repeat(500), "y".repeat(500));
        let (text, ranges) = shown(&line, &Matcher::new("needle", false, false).find(&line));
        assert!(text.starts_with('…'));
        assert_eq!(text.chars().count(), 1 + SHOWN_CHARS);
        assert_eq!(&text[ranges[0].0 + 2..ranges[0].1 + 2], "needle", "'…' is one UTF-16 unit but three bytes");
    }

    #[test]
    fn ranges_count_utf16_units() {
        let line = "😀 mean";
        let (_, ranges) = shown(line, &Matcher::new("mean", false, false).find(line));
        assert_eq!(ranges, [(3, 7)]);
    }

    #[test]
    fn search_skips_binary_and_large_files_and_can_be_cancelled() {
        let root = temp_dir("search");
        fs::write(root.join("a.py"), "x = 1\nprint(x)\n").unwrap();
        fs::write(root.join("b.bin"), b"x\0x").unwrap();
        fs::write(root.join("c.txt"), "x".repeat(MAX_SEARCH_BYTES as usize + 1)).unwrap();
        let files: Vec<String> = ["a.py", "b.bin", "c.txt", "gone.py"].map(String::from).to_vec();
        let found = search(&root, &files, &Matcher::new("x", true, true), || false).unwrap();
        assert_eq!(found.hits.iter().map(|h| (h.path.as_str(), h.line)).collect::<Vec<_>>(), [("a.py", 1), ("a.py", 2)]);
        assert_eq!((found.files, found.skipped, found.truncated), (1, 1, false));
        assert!(search(&root, &files, &Matcher::new("x", true, true), || true).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn search_stops_at_the_cap() {
        let root = temp_dir("search-cap");
        fs::write(root.join("many.py"), "hit\n".repeat(MAX_HITS + 5)).unwrap();
        let found = search(&root, &["many.py".into()], &Matcher::new("hit", false, false), || false).unwrap();
        assert_eq!(found.hits.len(), MAX_HITS);
        assert!(found.truncated);
        fs::remove_dir_all(root).unwrap();
    }
}
