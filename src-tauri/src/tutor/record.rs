//! The student's own record of tutor use in a folder, by day, read from `.longhand/log.jsonl`.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tally {
    /// Questions by what they were about: question, explain, review, failure, hint, lookup.
    pub asks: BTreeMap<String, u32>,
    /// The highest rung of the hint ladder asked for (0 when none).
    pub hint_rung: u8,
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
    fn add(&mut self, entry: &Value) {
        match entry["kind"].as_str() {
            Some("ask") => {
                let about = entry["about"].as_str().unwrap_or("question").to_string();
                *self.asks.entry(about).or_default() += 1;
                let rung = entry["rung"].as_u64().unwrap_or(0).min(u8::MAX as u64) as u8;
                self.hint_rung = self.hint_rung.max(rung);
            }
            Some("reveal") => self.reveals += 1,
            _ => {}
        }
    }
}

/// Tallies the log's lines, grouping by the local date of each entry.
pub fn from_log(text: &str) -> Record {
    let mut days: BTreeMap<String, Tally> = BTreeMap::new();
    let mut total = Tally::default();
    for entry in text.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        if !matches!(entry["kind"].as_str(), Some("ask" | "reveal")) {
            continue;
        }
        let Some(date) = entry["t"]
            .as_str()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.with_timezone(&chrono::Local).date_naive().to_string())
        else {
            continue;
        };
        days.entry(date).or_default().add(&entry);
        total.add(&entry);
    }
    Record { days: days.into_iter().rev().map(|(date, tally)| Day { date, tally }).collect(), total }
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
    fn an_empty_log_is_an_empty_record() {
        assert_eq!(from_log(""), Record { days: vec![], total: Tally::default() });
    }
}
