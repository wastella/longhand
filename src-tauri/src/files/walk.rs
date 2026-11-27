//! Which files the app shows, and walking a folder the way git sees it, so quick open and find
//! in files skip virtual environments, caches and anything the course's `.gitignore` excludes.
//! Only ignore files inside the open folder count: a `.gitignore` in the student's home folder
//! or their global git excludes must not hide coursework.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::{Match, WalkBuilder};
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

/// The ignore files read in each folder, in the order the walker lets them win.
const IGNORE_FILES: &[&str] = &[".ignore", ".gitignore"];

/// How many entries a long walk visits between checks that it should carry on.
const CHECK_EVERY: usize = 1000;

pub fn is_hidden(name: &str) -> bool {
    HIDDEN.contains(&name)
}

fn is_generated(name: &str) -> bool {
    GENERATED.contains(&name) || name.ends_with(".pyc") || name.ends_with(".egg-info")
}

/// A walker over the open folder `root` that skips hidden and generated entries and whatever
/// the folder's own ignore files exclude. `.gitignore` applies even before the folder is a git
/// repository, since course folders are often downloaded rather than cloned.
fn walker(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder.hidden(false).parents(false).git_global(false).require_git(false).follow_links(false).filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        entry.depth() == 0 || !(is_hidden(&name) || is_generated(&name))
    });
    builder
}

/// The ignore rules for the entries of one folder, deepest first, read from that folder up to
/// the open folder and no further.
struct Rules(Vec<Gitignore>);

impl Rules {
    fn for_dir(root: &Path, dir: &Path) -> Rules {
        let read = |base: &Path, file: &Path| {
            let mut builder = GitignoreBuilder::new(base);
            builder.add(file);
            builder.build().ok()
        };
        let mut levels = Vec::new();
        let mut at = Some(dir);
        while let Some(level) = at.filter(|l| l.starts_with(root)) {
            levels.extend(IGNORE_FILES.iter().map(|name| level.join(name)).filter(|f| f.is_file()).filter_map(|f| read(level, &f)));
            at = if level == root { None } else { level.parent() };
        }
        let exclude = root.join(".git/info/exclude");
        if exclude.is_file() {
            levels.extend(read(root, &exclude));
        }
        Rules(levels)
    }

    /// Whether `path` is ignored; the deepest rule that says anything wins.
    fn ignore(&self, path: &Path, is_dir: bool) -> bool {
        for rules in &self.0 {
            match rules.matched(path, is_dir) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        false
    }
}

/// One entry of a folder, for the tree. `ignored` entries are generated or git-ignored.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    pub ignored: bool,
}

/// The entries of `dir` inside the open folder `root`, folders first, then by name ignoring case.
pub fn list_dir(root: &Path, dir: &Path) -> io::Result<Vec<Entry>> {
    let rules = Rules::for_dir(root, dir);
    let mut entries: Vec<Entry> = fs::read_dir(dir)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if is_hidden(&name) {
                return None;
            }
            let kind = e.file_type().ok()?;
            let dir = kind.is_dir() || (kind.is_symlink() && e.path().is_dir());
            let ignored = is_generated(&name) || rules.ignore(&e.path(), dir);
            Some(Entry { name, dir, ignored })
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

/// Walks `root`, or gives up with None as soon as `keep_going` says no (another folder opened).
pub fn list_files(root: &Path, cap: usize, keep_going: impl Fn() -> bool) -> Option<Listing> {
    let mut listing = Listing::default();
    for (i, entry) in walker(root).build().flatten().enumerate() {
        if i % CHECK_EVERY == 0 && !keep_going() {
            return None;
        }
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
    Some(listing)
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
            "cs336_basics/scratch.txt",
            "tests/test_model.py",
            "tests/_snapshots/attention.npz",
            ".venv/lib/site.py",
            "data/owt_train.txt",
            ".git/HEAD",
            ".DS_Store",
        ] {
            touch(&root, rel);
        }
        fs::write(root.join(".gitignore"), "data/\nscratch.txt\n").unwrap();
        root
    }

    fn files(root: &Path) -> Vec<String> {
        list_files(root, 1000, || true).unwrap().files
    }

    #[test]
    fn listing_skips_generated_ignored_and_hidden_files() {
        let root = course();
        assert_eq!(files(&root), [".gitignore", "cs336_basics/model.py", "tests/_snapshots/attention.npz", "tests/test_model.py"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn listing_stops_at_the_cap_or_when_told() {
        let root = course();
        let capped = list_files(&root, 2, || true).unwrap();
        assert_eq!(capped.files.len(), 2);
        assert!(capped.truncated);
        assert!(list_files(&root, 1000, || false).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_entries_mark_ignored_ones_and_drop_hidden_ones() {
        let root = course();
        let entries = list_dir(&root, &root).unwrap();
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
        // The open folder's .gitignore still applies inside its subfolders.
        let package = list_dir(&root, &root.join("cs336_basics")).unwrap();
        assert_eq!(
            package.iter().map(|e| (e.name.as_str(), e.ignored)).collect::<Vec<_>>(),
            [("__pycache__", true), ("model.py", false), ("scratch.txt", true)]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ignore_files_above_the_open_folder_do_not_count() {
        let home = temp_dir("walk-home");
        fs::write(home.join(".gitignore"), "*\n").unwrap();
        let root = home.join("cs336");
        touch(&root, "cs336_basics/model.py");
        assert_eq!(files(&root), ["cs336_basics/model.py"]);
        let package = list_dir(&root, &root.join("cs336_basics")).unwrap();
        assert!(!package[0].ignored);
        assert!(!list_dir(&root, &root).unwrap()[0].ignored);
        fs::remove_dir_all(home).unwrap();
    }
}
