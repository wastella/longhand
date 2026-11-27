//! Which files the app shows, and walking a folder the way git sees it, so quick open and find
//! in files skip virtual environments, caches and anything the course's `.gitignore` excludes.

use ignore::WalkBuilder;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::Path;

/// Never shown: version control internals, the app's own data and Finder's litter.
const HIDDEN: &[&str] = &[".git", ".longhand", ".DS_Store"];

/// Environments, caches and build output: quiet in the tree, left out of quick open and search.
const GENERATED: &[&str] = &[
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".tox",
    "wandb",
    ".ipynb_checkpoints",
    "target",
];

pub fn is_hidden(name: &str) -> bool {
    HIDDEN.contains(&name)
}

fn is_generated(name: &str) -> bool {
    GENERATED.contains(&name) || name.ends_with(".pyc") || name.ends_with(".egg-info")
}

/// A walker over `dir` that skips hidden and generated entries and whatever git would ignore.
/// `.gitignore` applies even before the folder is a git repository, since course folders are
/// often downloaded rather than cloned.
pub fn walker(dir: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(dir);
    builder.hidden(false).require_git(false).follow_links(false).filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        entry.depth() == 0 || !(is_hidden(&name) || is_generated(&name))
    });
    builder
}

/// One entry of a folder, for the tree. `ignored` entries are generated or git-ignored.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    pub ignored: bool,
}

/// The entries of `dir`, folders first, then by name ignoring case.
pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
    let wanted: HashSet<OsString> =
        walker(dir).max_depth(Some(1)).build().flatten().filter(|e| e.depth() == 1).map(|e| e.file_name().to_owned()).collect();
    let mut entries: Vec<Entry> = fs::read_dir(dir)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if is_hidden(&name) {
                return None;
            }
            let kind = e.file_type().ok()?;
            let dir = kind.is_dir() || (kind.is_symlink() && e.path().is_dir());
            Some(Entry { ignored: !wanted.contains(&e.file_name()), name, dir })
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Every file under `root` that quick open and search consider, as sorted relative paths.
#[derive(Debug, Default)]
pub struct Listing {
    pub files: Vec<String>,
    /// The walk stopped at the cap, so some files are missing.
    pub truncated: bool,
}

pub fn list_files(root: &Path, cap: usize) -> Listing {
    let mut listing = Listing::default();
    for entry in walker(root).build().flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if listing.files.len() >= cap {
            listing.truncated = true;
            break;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else { continue };
        listing.files.push(rel.to_string_lossy().replace('\\', "/"));
    }
    listing.files.sort();
    listing
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    fn touch(root: &Path, rel: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "x").unwrap();
    }

    /// A small coursework folder: a package, tests, an environment, data and a .gitignore.
    fn course() -> std::path::PathBuf {
        let root = temp_dir("walk");
        for rel in [
            "cs336_basics/model.py",
            "cs336_basics/__pycache__/model.cpython-312.pyc",
            "tests/test_model.py",
            "tests/_snapshots/attention.npz",
            ".venv/lib/site.py",
            "data/owt_train.txt",
            ".git/HEAD",
            ".gitignore",
            ".DS_Store",
        ] {
            touch(&root, rel);
        }
        fs::write(root.join(".gitignore"), "data/\n").unwrap();
        root
    }

    #[test]
    fn listing_skips_generated_ignored_and_hidden_files() {
        let root = course();
        let listing = list_files(&root, 1000);
        assert_eq!(listing.files, [".gitignore", "cs336_basics/model.py", "tests/_snapshots/attention.npz", "tests/test_model.py"]);
        assert!(!listing.truncated);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn listing_stops_at_the_cap() {
        let root = course();
        let listing = list_files(&root, 2);
        assert_eq!(listing.files.len(), 2);
        assert!(listing.truncated);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_entries_mark_ignored_ones_and_drop_hidden_ones() {
        let root = course();
        let entries = list_dir(&root).unwrap();
        let shown: Vec<(&str, bool, bool)> = entries.iter().map(|e| (e.name.as_str(), e.dir, e.ignored)).collect();
        assert_eq!(
            shown,
            [
                (".venv", true, true),
                ("cs336_basics", true, false),
                ("data", true, true),
                ("tests", true, false),
                (".gitignore", false, false),
            ]
        );
        let package = list_dir(&root.join("cs336_basics")).unwrap();
        assert_eq!(package.iter().map(|e| (e.name.as_str(), e.ignored)).collect::<Vec<_>>(), [("__pycache__", true), ("model.py", false)]);
        fs::remove_dir_all(root).unwrap();
    }
}
