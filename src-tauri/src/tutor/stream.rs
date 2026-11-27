//! Reading the CLI's stream-json output: each line becomes the events the tutor cares about.

use super::cli::READ_ONLY_TOOLS;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The CLI started and lists the tools the model may use.
    Init {
        tools: Vec<String>,
    },
    /// A new block of answer text begins.
    Block,
    Text(String),
    Tool {
        name: String,
        target: String,
    },
    Limit(Limit),
    /// The run ended. `text` is the answer, or the reason when `is_error`.
    Result {
        is_error: bool,
        text: String,
    },
}

/// The subscription's usage limits, from the CLI's rate_limit_event.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Limit {
    /// "allowed", "allowed_warning" or "rejected".
    pub status: String,
    /// When the limit that applies resets, in seconds since the epoch.
    pub resets_at: Option<i64>,
    pub five_hour: Option<f64>,
    pub seven_day: Option<f64>,
}

/// The events in one line of output. Lines from subagents and unknown types yield nothing.
pub fn parse(line: &str) -> Vec<Event> {
    let Ok(msg) = serde_json::from_str::<Value>(line) else { return vec![] };
    match msg["type"].as_str().unwrap_or("") {
        "system" if msg["subtype"] == "init" => {
            let tools = msg["tools"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).map(String::from).collect();
            vec![Event::Init { tools }]
        }
        "stream_event" if msg["parent_tool_use_id"].is_null() => {
            let ev = &msg["event"];
            if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                vec![Event::Text(ev["delta"]["text"].as_str().unwrap_or("").to_string())]
            } else if ev["type"] == "content_block_start" && ev["content_block"]["type"] == "text" {
                vec![Event::Block]
            } else {
                vec![]
            }
        }
        "assistant" if msg["parent_tool_use_id"].is_null() => msg["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|block| block["type"] == "tool_use")
            .map(|block| {
                let input = &block["input"];
                let target = ["file_path", "pattern", "path"].iter().find_map(|k| input[*k].as_str()).unwrap_or("");
                Event::Tool { name: block["name"].as_str().unwrap_or("").to_string(), target: target.to_string() }
            })
            .collect(),
        "rate_limit_event" => {
            let info = &msg["rate_limit_info"];
            let windows = &info["unifiedWindows"];
            vec![Event::Limit(Limit {
                status: info["status"].as_str().unwrap_or("").to_string(),
                resets_at: info["resetsAt"].as_i64(),
                five_hour: windows["five_hour"]["utilization"].as_f64(),
                seven_day: windows["seven_day"]["utilization"].as_f64(),
            })]
        }
        "result" => {
            let is_error = msg["is_error"] == true;
            let mut text = msg["result"].as_str().unwrap_or("").to_string();
            if let Some(errors) = msg["errors"].as_array().filter(|_| text.is_empty()) {
                text = errors.iter().filter_map(|e| e.as_str()).collect::<Vec<_>>().join("\n");
            }
            vec![Event::Result { is_error, text }]
        }
        _ => vec![],
    }
}

/// Tools offered beyond the read-only three. Any at all means the run must stop.
pub fn unexpected_tools(tools: &[String]) -> Vec<String> {
    tools.iter().filter(|t| !READ_ONLY_TOOLS.contains(&t.as_str())).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines as the CLI (2.1.332) printed them, trimmed to the fields that matter.
    const INIT: &str = r#"{"type":"system","subtype":"init","tools":["Glob","Grep","Read"],"model":"claude-haiku-5-5"}"#;
    const LIMIT: &str = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1795756800,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.57,"resetsAt":1795756800,"status":"allowed"},"seven_day":{"utilization":0.58,"resetsAt":1795759200,"status":"allowed"}}}}"#;
    const MISSING: &str = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"errors":["No conversation found with session ID: 45a4908f"]}"#;

    #[test]
    fn start_up_lists_the_tools_and_extra_ones_are_caught() {
        let tools: Vec<String> = ["Glob", "Grep", "Read"].map(String::from).to_vec();
        assert_eq!(parse(INIT), vec![Event::Init { tools: tools.clone() }]);
        assert!(unexpected_tools(&tools).is_empty());
        let more: Vec<String> = ["Read", "Bash", "Edit"].map(String::from).to_vec();
        assert_eq!(unexpected_tools(&more), vec!["Bash", "Edit"]);
    }

    #[test]
    fn text_blocks_and_tool_use_become_events() {
        let start = r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_start","content_block":{"type":"text","text":""}}}"#;
        let delta = r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}"#;
        let thinking = r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_start","content_block":{"type":"thinking"}}}"#;
        let tool = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"thinking"},{"type":"tool_use","name":"Read","input":{"file_path":"/w/a.py"}}]}}"#;
        assert_eq!(parse(start), vec![Event::Block]);
        assert_eq!(parse(delta), vec![Event::Text("Hi".into())]);
        assert_eq!(parse(thinking), vec![]);
        assert_eq!(parse(tool), vec![Event::Tool { name: "Read".into(), target: "/w/a.py".into() }]);
    }

    #[test]
    fn subagent_output_and_noise_are_ignored() {
        let nested = r#"{"type":"stream_event","parent_tool_use_id":"x","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}"#;
        assert_eq!(parse(nested), vec![]);
        assert_eq!(parse("not json"), vec![]);
        assert_eq!(parse(r#"{"type":"system","subtype":"status"}"#), vec![]);
    }

    #[test]
    fn limits_carry_when_they_reset() {
        let expected = Limit { status: "allowed".into(), resets_at: Some(1795756800), five_hour: Some(0.57), seven_day: Some(0.58) };
        assert_eq!(parse(LIMIT), vec![Event::Limit(expected)]);
    }

    #[test]
    fn errors_without_a_result_take_the_error_list() {
        assert_eq!(parse(MISSING), vec![Event::Result { is_error: true, text: "No conversation found with session ID: 45a4908f".into() }]);
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"Done."}"#;
        assert_eq!(parse(ok), vec![Event::Result { is_error: false, text: "Done.".into() }]);
    }
}
