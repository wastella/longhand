//! Finds the language server for a kind of code among what the student has installed. Nothing
//! is ever downloaded or installed from here: a server that is not found is reported as missing
//! and the interface says how to install it.
//!
//! Looking runs nothing at all: it only checks which files exist. What is found may well be the
//! folder's own (a server in its `.venv`), which is why `lsp.rs` looks only once the student has
//! turned code checking on for the folder.
//!
//! Python is the only kind for now. Another language is a `Kind`, a line in `parse` and an arm
//! in `find`, plus its entry in the interface's `language/kinds.js`.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The servers Longhand knows how to start, named as the interface names them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Python,
}

impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        match name {
            "python" => Some(Kind::Python),
            _ => None,
        }
    }
}

/// Where to look: the open folder, the search path (see `search_path.rs`) and the Python
/// environment that was active when Longhand was started, if any.
pub struct Search<'a> {
    pub folder: &'a Path,
    pub path: &'a str,
    pub virtual_env: Option<&'a Path>,
}

/// A server that can be started.
#[derive(Debug, PartialEq)]
pub struct Found {
    /// The server's short name, such as `basedpyright` or `pylsp`.
    pub name: &'static str,
    pub path: PathBuf,
    pub args: &'static [&'static str],
    /// The folder's own Python interpreter, when it has an environment.
    pub python: Option<PathBuf>,
    /// The PATH the server runs with.
    search_path: String,
}

impl Found {
    fn new(name: &'static str, path: PathBuf, args: &'static [&'static str], search: &Search) -> Found {
        Found { name, path, args, python: None, search_path: search.path.to_string() }
    }

    /// The command that starts the server in `folder`. With a Python environment it runs as it
    /// would in a shell where that environment is activated: pyright and jedi both ask the
    /// `python` on PATH what it can import, so this is what makes the folder's packages resolve.
    pub fn command(&self, folder: &Path) -> Command {
        let mut command = Command::new(&self.path);
        command.args(self.args).current_dir(folder);
        match self.python.as_deref().and_then(environment_of) {
            Some(environment) => {
                command.env("PATH", format!("{}:{}", environment.join("bin").display(), self.search_path));
                command.env("VIRTUAL_ENV", environment);
            }
            None => {
                command.env("PATH", &self.search_path);
            }
        }
        command
    }
}

/// The environment directory of an interpreter at `<environment>/bin/python`.
fn environment_of(python: &Path) -> Option<&Path> {
    python.parent()?.parent()
}

/// The server for `kind`, or `None` when none is installed.
pub fn find(kind: Kind, search: &Search) -> Option<Found> {
    match kind {
        Kind::Python => python(search),
    }
}

/// `path` if it is a regular file (or a link to one) that may be executed.
fn executable(path: PathBuf) -> Option<PathBuf> {
    let meta = std::fs::metadata(&path).ok()?;
    (meta.is_file() && meta.permissions().mode() & 0o111 != 0).then_some(path)
}

/// Every executable called `name` on the search path, in order. Relative entries (such as `.`)
/// are skipped: a starter repository must not be able to plant a "server" that way.
fn on_path<'a>(name: &'a str, search: &'a Search) -> impl Iterator<Item = PathBuf> + 'a {
    search.path.split(':').map(Path::new).filter(|dir| dir.is_absolute()).filter_map(move |dir| executable(dir.join(name)))
}

// ---- Python ----

/// The Python servers, best first, with the program each installs and its arguments.
const PYTHON_SERVERS: [(&str, &str, &[&str]); 3] =
    [("basedpyright", "basedpyright-langserver", &["--stdio"]), ("pyright", "pyright-langserver", &["--stdio"]), ("pylsp", "pylsp", &[])];

/// The folder's own environment comes first (`.venv` is where uv and most courses put it), then
/// the environment Longhand was started in, then the search path. A server installed in an
/// earlier place wins over a better one in a later place: it is the one the project chose.
fn python(search: &Search) -> Option<Found> {
    let environments: Vec<PathBuf> =
        [Some(search.folder.join(".venv")), Some(search.folder.join("venv")), search.virtual_env.map(Path::to_path_buf)]
            .into_iter()
            .flatten()
            .collect();
    let best_in = |place: &dyn Fn(&str) -> Option<PathBuf>| {
        PYTHON_SERVERS.iter().find_map(|&(name, program, args)| place(program).map(|path| Found::new(name, path, args, search)))
    };
    let mut found = environments
        .iter()
        .find_map(|environment| best_in(&|program| executable(environment.join("bin").join(program))))
        .or_else(|| best_in(&|program| on_path(program, search).next()))?;
    found.python = environments.iter().find_map(|environment| executable(environment.join("bin/python")));
    Some(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;

    /// A scratch machine: a project folder and two directories on the PATH.
    struct Machine {
        root: PathBuf,
        folder: PathBuf,
        path: String,
    }

    impl Machine {
        fn new(name: &str) -> Machine {
            let root = temp_dir(name).canonicalize().unwrap();
            let folder = root.join("project");
            for dir in [&folder, &root.join("bin"), &root.join("other-bin")] {
                fs::create_dir_all(dir).unwrap();
            }
            let path = format!("{}:{}", root.join("bin").display(), root.join("other-bin").display());
            Machine { root, folder, path }
        }

        /// Writes an executable script at `at` (relative to the scratch root) and returns its path.
        fn script(&self, at: &str, body: &str) -> PathBuf {
            let path = self.root.join(at);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        /// An executable that does nothing, standing in for a server or an interpreter.
        fn install(&self, at: &str) -> PathBuf {
            self.script(at, "exit 0")
        }

        fn find(&self) -> Option<Found> {
            self.find_with(None)
        }

        fn find_with(&self, virtual_env: Option<&Path>) -> Option<Found> {
            find(Kind::Python, &Search { folder: &self.folder, path: &self.path, virtual_env })
        }

        /// A file that records being run, for proving that looking ran nothing.
        fn tripwire(&self, at: &str) -> PathBuf {
            self.script(at, &format!("echo \"$0 $*\" >> '{}'", self.root.join("ran").display()))
        }

        fn ran(&self) -> String {
            fs::read_to_string(self.root.join("ran")).unwrap_or_default()
        }
    }

    impl Drop for Machine {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn kinds_are_named_as_the_interface_names_them() {
        assert_eq!(Kind::parse("python"), Some(Kind::Python));
        assert_eq!(Kind::parse("Python"), None);
        assert_eq!(Kind::parse("rust"), None, "only Python, for now");
    }

    #[test]
    fn a_machine_with_nothing_installed_has_no_server() {
        assert_eq!(Machine::new("lsp-find-none").find(), None);
    }

    #[test]
    fn only_executable_files_count() {
        let machine = Machine::new("lsp-find-exec");
        fs::write(machine.root.join("bin/pylsp"), "not a program").unwrap();
        fs::create_dir_all(machine.root.join("bin/pyright-langserver")).unwrap();
        assert_eq!(machine.find(), None, "a file without the executable bit, and a directory");
        // The next place on the path is still tried.
        let real = machine.install("other-bin/pylsp");
        assert_eq!(machine.find().unwrap().path, real);
    }

    #[test]
    fn relative_path_entries_are_never_searched() {
        let mut machine = Machine::new("lsp-find-relative");
        machine.install("project/pylsp");
        machine.path = format!(".:{}", machine.path);
        // Even from inside the folder, where "." would find the planted file.
        assert_eq!(machine.find(), None);
    }

    #[test]
    fn the_folders_own_environment_comes_before_the_path() {
        let machine = Machine::new("lsp-find-venv");
        machine.install("bin/basedpyright-langserver");
        let own = machine.install("project/.venv/bin/pylsp");
        let python = machine.install("project/.venv/bin/python");
        let found = machine.find().unwrap();
        // pylsp ranks below basedpyright, but it is the one the project installed.
        assert_eq!((found.name, &found.path, found.args), ("pylsp", &own, &[][..]));
        assert_eq!(found.python, Some(python));
    }

    #[test]
    fn python_servers_are_preferred_in_order_within_a_place() {
        let machine = Machine::new("lsp-find-rank");
        let pylsp = machine.install("bin/pylsp");
        assert_eq!(machine.find().unwrap().path, pylsp);
        let pyright = machine.install("other-bin/pyright-langserver");
        let found = machine.find().unwrap();
        assert_eq!((found.name, &found.path, found.args), ("pyright", &pyright, &["--stdio"][..]), "later on the path, but better");
        let based = machine.install("other-bin/basedpyright-langserver");
        let found = machine.find().unwrap();
        assert_eq!((found.name, &found.path, found.args), ("basedpyright", &based, &["--stdio"][..]));
        assert_eq!(found.python, None, "the folder has no environment of its own");
    }

    #[test]
    fn a_server_on_the_path_still_analyses_against_the_folders_environment() {
        let machine = Machine::new("lsp-find-interpreter");
        let server = machine.install("bin/basedpyright-langserver");
        let python = machine.install("project/.venv/bin/python");
        let found = machine.find().unwrap();
        assert_eq!(found.path, server);
        assert_eq!(found.python.as_ref(), Some(&python));

        let command = found.command(&machine.folder);
        let env = |name: &str| {
            command.get_envs().find(|(key, _)| *key == name).and_then(|(_, value)| value).map(|v| v.to_string_lossy().into_owned())
        };
        let environment = machine.folder.join(".venv");
        assert_eq!(env("VIRTUAL_ENV").as_deref(), Some(environment.to_str().unwrap()));
        assert_eq!(env("PATH").unwrap(), format!("{}/bin:{}", environment.display(), machine.path));
        assert_eq!(command.get_current_dir(), Some(machine.folder.as_path()));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--stdio"]);
    }

    #[test]
    fn environments_are_tried_in_order_dot_venv_then_venv_then_the_active_one() {
        let machine = Machine::new("lsp-find-envs");
        let active = machine.root.join("active");
        let active_server = machine.install("active/bin/pylsp");
        let active_python = machine.install("active/bin/python");
        let found = machine.find_with(Some(&active)).unwrap();
        assert_eq!((&found.path, found.python.as_ref()), (&active_server, Some(&active_python)));
        assert_eq!(machine.find(), None, "not found unless it is the active environment");

        let venv_python = machine.install("project/venv/bin/python");
        let found = machine.find_with(Some(&active)).unwrap();
        assert_eq!(
            (&found.path, found.python.as_ref()),
            (&active_server, Some(&venv_python)),
            "the folder's interpreter, the active server"
        );

        let dot_server = machine.install("project/.venv/bin/pyright-langserver");
        let dot_python = machine.install("project/.venv/bin/python");
        let found = machine.find_with(Some(&active)).unwrap();
        assert_eq!((found.name, &found.path, found.python.as_ref()), ("pyright", &dot_server, Some(&dot_python)));
    }

    #[test]
    fn a_server_without_an_environment_runs_with_the_search_path_only() {
        let machine = Machine::new("lsp-find-env-plain");
        machine.install("bin/pylsp");
        let command = machine.find().unwrap().command(&machine.folder);
        let envs: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_string_lossy().into_owned(), value.map(|v| v.to_string_lossy().into_owned())))
            .collect();
        assert_eq!(envs, [("PATH".to_string(), Some(machine.path.clone()))]);
    }

    #[test]
    fn looking_runs_nothing_from_the_folder() {
        let machine = Machine::new("lsp-find-tripwires");
        for planted in ["project/.venv/bin/python", "project/.venv/bin/pylsp", "project/venv/bin/basedpyright-langserver"] {
            machine.tripwire(planted);
        }
        machine.find();
        assert_eq!(machine.ran(), "");
    }
}
