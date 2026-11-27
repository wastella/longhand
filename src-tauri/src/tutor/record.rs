//! The student's own record of tutor use in a folder, read from `.longhand/log.jsonl`. This is
//! the one reader of the log: the Record view (`from_log`) and the title bar's counts
//! (`summary`) both count through `counted`, so they cannot disagree.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Request kinds that, as an entry's `kind`, mark a question logged by builds of this branch
/// before the fix that keeps `kind: "ask"` (see `tutor::log_ask`). Such entries carry `about`.
const LEGACY_ASK_KINDS: [&str; 4] = ["conversation", "lookup", "review", "failure"];

/// What a log entry counts as.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Counted {
    Ask,
    Reveal,
    Tests,
}

pub fn counted(entry: &Value) -> Option<Counted> {
    match entry["kind"].as_str()? {
        "ask" => Some(Counted::Ask),
        "reveal" => Some(Counted::Reveal),
        "tests" => Some(Counted::Tests),
        k if LEGACY_ASK_KINDS.contains(&k) && entry["about"].is_string() => Some(Counted::Ask),
        _ => None,
    }
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tally {
    /// Questions by what they were about: question, explain, review, failure, hint, lookup.
    pub asks: BTreeMap<String, u32>,
    /// The highest rung of the hint ladder asked for (0 when none).
    pub hint_rung: u8,
    pub reveals: u32,
    /// Test runs. Not tutor use, so not shown in the record, but counted in the title bar.
    #[serde(skip)]
    pub tests: u32,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Day {
    pub date: String,
    #[serde(flatten)]
    pub tally: Tally,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Record {
    /// Days with any tutor use, newest first.
    pub days: Vec<Day>,
    pub total: Tally,
}

impl Tally {
    fn add(&mut self, entry: &Value, what: Counted) {
        match what {
            Counted::Ask => {
                let about = entry["about"].as_str().unwrap_or("question").to_string();
                *self.asks.entry(about).or_default() += 1;
                let rung = entry["rung"].as_u64().unwrap_or(0).min(u8::MAX as u64) as u8;
                self.hint_rung = self.hint_rung.max(rung);
            }
            Counted::Reveal => self.reveals += 1,
            Counted::Tests => self.tests += 1,
        }
    }

    fn questions(&self) -> u32 {
        self.asks.values().sum()
    }

    fn is_tutor_use(&self) -> bool {
        self.questions() > 0 || self.reveals > 0
    }
}

/// Every counted entry, by local date (oldest first), and the total.
fn tally(text: &str) -> (BTreeMap<String, Tally>, Tally) {
    let mut days: BTreeMap<String, Tally> = BTreeMap::new();
    let mut total = Tally::default();
    for entry in text.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        let Some(what) = counted(&entry) else { continue };
        let Some(date) = entry["t"]
            .as_str()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.with_timezone(&chrono::Local).date_naive().to_string())
        else {
            continue;
        };
        days.entry(date).or_default().add(&entry, what);
        total.add(&entry, what);
    }
    (days, total)
}

/// The Record view: days with tutor use, newest first.
pub fn from_log(text: &str) -> Record {
    let (days, total) = tally(text);
    let days = days.into_iter().rev().filter(|(_, t)| t.is_tutor_use()).map(|(date, tally)| Day { date, tally }).collect();
    Record { days, total }
}

/// The title bar's counts: `{ today: { ask, reveal, tests }, total: { … } }`, `today` being the
/// local date given.
pub fn summary(text: &str, today: chrono::NaiveDate) -> Value {
    let (days, total) = tally(text);
    let counts = |t: Option<&Tally>| {
        let t = t.map(|t| (t.questions(), t.reveals, t.tests)).unwrap_or_default();
        json!({ "ask": t.0, "reveal": t.1, "tests": t.2 })
    };
    json!({ "today": counts(days.get(&today.to_string())), "total": counts(Some(&total)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(day: u32, hour: u32) -> String {
        chrono::Local.with_ymd_and_hms(2026, 11, day, hour, 0, 0).unwrap().to_rfc3339()
    }

    #[test]
    fn use_is_grouped_by_day_with_the_highest_hint_rung() {
        let log = [
            format!(r#"{{"t":"{}","kind":"ask","about":"lookup"}}"#, at(26, 9)),
            format!(r#"{{"t":"{}","kind":"ask","about":"hint","rung":2}}"#, at(27, 10)),
            format!(r#"{{"t":"{}","kind":"ask","about":"hint","rung":1}}"#, at(27, 11)),
            format!(r#"{{"t":"{}","kind":"ask"}}"#, at(27, 12)),
            format!(r#"{{"t":"{}","kind":"reveal","lines":4}}"#, at(27, 13)),
            format!(r#"{{"t":"{}","kind":"tests"}}"#, at(27, 14)),
            "not json".to_string(),
        ]
        .join("\n");
        let record = from_log(&log);
        assert_eq!(record.days.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(), ["2026-11-27", "2026-11-26"]);
        let today = &record.days[0].tally;
        assert_eq!(today.asks, BTreeMap::from([("hint".to_string(), 2), ("question".to_string(), 1)]));
        assert_eq!((today.hint_rung, today.reveals), (2, 1));
        assert_eq!(record.total.asks["lookup"], 1);
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["days"][0]["hintRung"], 2);
        assert_eq!(json["days"][1]["date"], "2026-11-26");
    }

    #[test]
    fn the_title_bar_and_the_record_count_the_same_entries_old_and_new() {
        let log = [
            // Logs from before the tutor engine.
            format!(r#"{{"t":"{}","kind":"ask","about":"question"}}"#, at(27, 9)),
            // What builds of this branch wrote when the request kind overwrote "ask".
            format!(r#"{{"t":"{}","kind":"conversation","about":"question","model":"sonnet"}}"#, at(27, 10)),
            format!(r#"{{"t":"{}","kind":"lookup","about":"lookup"}}"#, at(27, 11)),
            // A "lookup" without "about" is not a question.
            format!(r#"{{"t":"{}","kind":"lookup"}}"#, at(27, 11)),
            format!(r#"{{"t":"{}","kind":"reveal","lines":3}}"#, at(27, 12)),
            format!(r#"{{"t":"{}","kind":"tests"}}"#, at(27, 13)),
            format!(r#"{{"t":"{}","kind":"tests"}}"#, at(26, 13)),
            format!(r#"{{"t":"{}","kind":"config","policy":"strict"}}"#, at(27, 14)),
        ]
        .join("\n");
        let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 27).unwrap();
        let s = summary(&log, today);
        assert_eq!(s["today"], serde_json::json!({ "ask": 3, "reveal": 1, "tests": 1 }));
        assert_eq!(s["total"], serde_json::json!({ "ask": 3, "reveal": 1, "tests": 2 }));
        let record = from_log(&log);
        assert_eq!(record.days[0].tally.questions(), 3, "the record's Today is the title bar's");
        // The 26th had only a test run: not tutor use, so not a day in the record.
        assert_eq!(record.days.len(), 1);
    }

    #[test]
    fn an_empty_log_is_an_empty_record() {
        assert_eq!(from_log(""), Record { days: vec![], total: Tally::default() });
    }
}
