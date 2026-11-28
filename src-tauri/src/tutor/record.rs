//! The student's own record of tutor use in a folder, read from `.longhand/log.jsonl`. This is
//! the one reader of the log.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// Request kinds that, as an entry's `kind`, mark a question logged by builds of this branch
/// before the fix that keeps `kind: "ask"` (see `tutor::log_ask`). Such entries carry `about`.
const LEGACY_ASK_KINDS: [&str; 4] = ["conversation", "lookup", "review", "failure"];

/// What a log entry counts as.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Counted {
    Ask,
    Reveal,
}

pub fn counted(entry: &Value) -> Option<Counted> {
    match entry["kind"].as_str()? {
        "ask" => Some(Counted::Ask),
        "reveal" => Some(Counted::Reveal),
        k if LEGACY_ASK_KINDS.contains(&k) && entry["about"].is_string() => Some(Counted::Ask),
        _ => None,
    }
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tally {
    /// Questions by what they were about: question, explain, review, failure, lookup (and hint,
    /// in logs from before the hint ladder was removed).
    pub asks: BTreeMap<String, u32>,
    pub reveals: u32,
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
            }
            Counted::Reveal => self.reveals += 1,
        }
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
    let days = days.into_iter().rev().map(|(date, tally)| Day { date, tally }).collect();
    Record { days, total }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(day: u32, hour: u32) -> String {
        chrono::Local.with_ymd_and_hms(2026, 11, day, hour, 0, 0).unwrap().to_rfc3339()
    }

    #[test]
    fn use_is_grouped_by_day_and_old_hints_still_count() {
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
        assert_eq!(today.reveals, 1);
        assert_eq!(record.total.asks["lookup"], 1);
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["days"][0]["asks"]["hint"], 2);
        assert_eq!(json["days"][1]["date"], "2026-11-26");
    }

    #[test]
    fn the_record_counts_entries_old_and_new() {
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
        let record = from_log(&log);
        assert_eq!(record.days[0].tally.asks.values().sum::<u32>(), 3);
        assert_eq!(record.days[0].tally.reveals, 1);
        // The 26th had only a test run: not tutor use, so not counted and not a day in the record.
        assert_eq!(record.days.len(), 1);
    }

    #[test]
    fn an_empty_log_is_an_empty_record() {
        assert_eq!(from_log(""), Record { days: vec![], total: Tally::default() });
    }
}
