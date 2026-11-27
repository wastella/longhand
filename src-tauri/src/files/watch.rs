//! Watching the open folder for changes made outside the editor (the terminal, git, a training
//! script writing checkpoints). Events are gathered into batches so a burst of writes reaches
//! the interface as one update instead of thousands.

use super::walk::is_hidden;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

/// A batch ends after this long without a new event…
const QUIET: Duration = Duration::from_millis(200);
/// …or after this long in any case, so a script that never stops writing still shows progress.
const MAX_WAIT: Duration = Duration::from_secs(1);
/// Past this many paths a batch just says "anything may have changed".
const MAX_PATHS: usize = 500;

/// What one changed path means for the interface.
#[derive(Debug, PartialEq)]
enum Change {
    /// Inside `.git` or the app's own data, which the interface never shows.
    Unseen,
    Path(String),
    /// Outside the folder as we know it (or the folder itself): refresh everything.
    Everything,
}

fn classify(root: &Path, path: &Path) -> Change {
    let Ok(rel) = path.strip_prefix(root) else { return Change::Everything };
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        Change::Everything
    } else if parts.iter().any(|p| is_hidden(p)) {
        Change::Unseen
    } else {
        Change::Path(parts.join("/"))
    }
}

#[derive(Default)]
struct Batch {
    paths: BTreeSet<String>,
    everything: bool,
}

impl Batch {
    fn add(&mut self, root: &Path, event: notify::Result<Event>) {
        let Ok(event) = event else { return self.everything = true };
        if event.need_rescan() {
            self.everything = true;
        }
        for path in &event.paths {
            match classify(root, path) {
                Change::Unseen => {}
                Change::Path(p) => {
                    self.paths.insert(p);
                }
                Change::Everything => self.everything = true,
            }
        }
        if self.paths.len() > MAX_PATHS {
            self.everything = true;
        }
    }

    /// The changed paths, `[""]` for "anything may have changed", or None if nothing visible changed.
    fn finish(self) -> Option<Vec<String>> {
        if self.everything {
            Some(vec![String::new()])
        } else if self.paths.is_empty() {
            None
        } else {
            Some(self.paths.into_iter().collect())
        }
    }
}

fn gather(root: &Path, events: Receiver<notify::Result<Event>>, on_change: impl Fn(Vec<String>)) {
    while let Ok(first) = events.recv() {
        let mut batch = Batch::default();
        batch.add(root, first);
        let deadline = Instant::now() + MAX_WAIT;
        let mut open = true;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match events.recv_timeout(QUIET.min(left)) {
                Ok(event) => batch.add(root, event),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    open = false;
                    break;
                }
            }
        }
        if let Some(paths) = batch.finish() {
            on_change(paths);
        }
        if !open {
            return;
        }
    }
}

/// Watches `root` until the returned watcher is dropped, calling `on_change` with each batch of
/// changed paths (relative to `root`).
pub fn watch(root: PathBuf, on_change: impl Fn(Vec<String>) + Send + 'static) -> notify::Result<RecommendedWatcher> {
    let (sender, events) = channel();
    let mut watcher = notify::recommended_watcher(sender)?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    // The thread ends when the watcher, which owns the sending side, is dropped.
    thread::spawn(move || gather(&root, events, on_change));
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;
    use std::sync::mpsc;

    #[test]
    fn paths_are_relative_and_hidden_ones_are_dropped() {
        let root = Path::new("/course");
        assert_eq!(classify(root, Path::new("/course/tests/test_model.py")), Change::Path("tests/test_model.py".into()));
        assert_eq!(classify(root, Path::new("/course/.git/index")), Change::Unseen);
        assert_eq!(classify(root, Path::new("/course/.longhand/log.jsonl")), Change::Unseen);
        assert_eq!(classify(root, Path::new("/course")), Change::Everything);
        assert_eq!(classify(root, Path::new("/elsewhere/a.py")), Change::Everything);
    }

    fn event(paths: &[&str]) -> notify::Result<Event> {
        let mut e = Event::new(notify::EventKind::Any);
        e.paths = paths.iter().map(PathBuf::from).collect();
        Ok(e)
    }

    #[test]
    fn a_burst_of_events_becomes_one_batch() {
        let (send, events) = mpsc::channel();
        for i in 0..20 {
            send.send(event(&[&format!("/course/checkpoints/step_{i}.pt")])).unwrap();
        }
        send.send(event(&["/course/.git/index"])).unwrap();
        drop(send);
        let (got, batches) = mpsc::channel();
        gather(Path::new("/course"), events, move |paths| got.send(paths).unwrap());
        let all: Vec<Vec<String>> = batches.iter().collect();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].len(), 20);
        assert_eq!(all[0][0], "checkpoints/step_0.pt");
    }

    #[test]
    fn too_many_paths_or_a_rescan_mean_everything() {
        let mut batch = Batch::default();
        for i in 0..=MAX_PATHS {
            batch.add(Path::new("/c"), event(&[&format!("/c/{i}")]));
        }
        assert_eq!(batch.finish(), Some(vec![String::new()]));

        let mut batch = Batch::default();
        batch.add(Path::new("/c"), event(&["/c/.git/HEAD"]));
        assert_eq!(batch.finish(), None);
    }

    #[test]
    fn notices_files_written_on_disk() {
        let root = temp_dir("watch").canonicalize().unwrap();
        let (got, batches) = mpsc::channel();
        let watcher = watch(root.clone(), move |paths| {
            let _ = got.send(paths);
        })
        .unwrap();
        // FSEvents can take a moment to start delivering.
        thread::sleep(Duration::from_millis(300));
        fs::write(root.join("notes.md"), "hello").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = false;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match batches.recv_timeout(left) {
                Ok(paths) if paths.iter().any(|p| p == "notes.md" || p.is_empty()) => {
                    seen = true;
                    break;
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        drop(watcher);
        fs::remove_dir_all(root).unwrap();
        assert!(seen, "the new file was reported");
    }
}
