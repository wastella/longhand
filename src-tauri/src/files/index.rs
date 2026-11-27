//! The cached list of the open folder's files, shared by quick open and find in files. The
//! watcher marks it stale; it is rebuilt on the next request, not on every change, so a script
//! writing a thousand checkpoints costs one walk instead of a thousand.

use super::walk::{list_files, Listing};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Enough for any course folder; past this the listing says it is incomplete.
const MAX_INDEXED: usize = 100_000;

struct Cached {
    root: PathBuf,
    /// The value of `changes` when the walk started.
    version: u64,
    listing: Arc<Listing>,
}

#[derive(Default)]
pub struct FileIndex {
    cached: Mutex<Option<Cached>>,
    /// Held while walking, so simultaneous requests share one walk.
    building: Mutex<()>,
    changes: AtomicU64,
}

impl FileIndex {
    /// The files under `root`, walking the folder only if something changed since the last walk.
    /// None if `is_current` says `root` stopped being the open folder during the walk, so a
    /// switch of folder never waits for the old folder's walk to finish.
    pub fn listing(&self, root: &Path, is_current: impl Fn() -> bool) -> Option<Arc<Listing>> {
        let _walking = self.building.lock().unwrap();
        if let Some(listing) = self.fresh(root) {
            return Some(listing);
        }
        let version = self.changes.load(Ordering::SeqCst);
        let listing = Arc::new(list_files(root, MAX_INDEXED, is_current)?);
        *self.cached.lock().unwrap() = Some(Cached { root: root.to_path_buf(), version, listing: listing.clone() });
        Some(listing)
    }

    fn fresh(&self, root: &Path) -> Option<Arc<Listing>> {
        let cached = self.cached.lock().unwrap();
        let c = cached.as_ref()?;
        (c.root == root && c.version == self.changes.load(Ordering::SeqCst)).then(|| c.listing.clone())
    }

    /// Something on disk changed; the next request walks again. Safe to call during a walk.
    pub fn invalidate(&self) {
        self.changes.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;

    #[test]
    fn reuses_the_walk_until_invalidated() {
        let root = temp_dir("index");
        fs::write(root.join("a.py"), "").unwrap();
        let index = FileIndex::default();
        let files = |root: &Path| index.listing(root, || true).unwrap().files.clone();
        assert_eq!(files(&root), ["a.py"]);

        fs::write(root.join("b.py"), "").unwrap();
        assert_eq!(files(&root), ["a.py"], "cached until something says it changed");
        index.invalidate();
        assert_eq!(files(&root), ["a.py", "b.py"]);

        let other = temp_dir("index-other");
        assert!(index.listing(&other, || false).is_none(), "a walk of a folder no longer open gives up");
        assert!(files(&other).is_empty(), "a different folder is walked afresh");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }
}
