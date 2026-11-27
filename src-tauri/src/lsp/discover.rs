//! Finds the language server for a kind of code among what the student has installed. Nothing
//! is ever downloaded or installed from here: a server that is not found is reported as missing
//! and the interface says how to install it.

use super::probe;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// How long a helper tool (`xcrun`, `rustup`, `go env`, `rust-analyzer --version`) may take.
/// rustup's proxies can take a few seconds the first time after a toolchain update.
const TOOL_LIMIT: Duration = Duration::from_secs(10);

/// The servers Longhand knows how to start, named as the interface names them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Python,
    /// C and C++.
    Clang,
    Java,
    /// JavaScript and TypeScript.
    TypeScript,
    Rust,
    Go,
}

impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        Some(match name {
            "python" => Kind::Python,
            "clang" => Kind::Clang,
            "java" => Kind::Java,
            "typescript" => Kind::TypeScript,
            "rust" => Kind::Rust,
            "go" => Kind::Go,
            _ => return None,
        })
    }
}

/// Where to look: the open folder, the search path (see `search_path.rs`), the home directory
/// and the Python environment that was active when Longhand was started, if any.
pub struct Search<'a> {
    pub folder: &'a Path,
    pub path: &'a str,
    pub home: &'a Path,
    pub virtual_env: Option<&'a Path>,
}

/// A server that can be started.
#[derive(Debug, PartialEq)]
pub struct Found {
    /// The server's short name, such as `basedpyright` or `clangd`.
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
        Kind::Clang => clangd(search).map(|path| Found::new("clangd", path, &[], search)),
        Kind::Java => on_path("jdtls", search).next().map(|path| Found::new("jdtls", path, &[], search)),
        Kind::TypeScript => {
            let own = executable(search.folder.join("node_modules/.bin/typescript-language-server"));
            let path = own.or_else(|| on_path("typescript-language-server", search).next())?;
            Some(Found::new("typescript-language-server", path, &["--stdio"], search))
        }
        Kind::Rust => rust_analyzer(search).map(|path| Found::new("rust-analyzer", path, &[], search)),
        Kind::Go => gopls(search).map(|path| Found::new("gopls", path, &[], search)),
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

/// A helper tool run in the folder with the search path, as it would run in the terminal.
fn tool(program: &Path, args: &[&str], search: &Search) -> Command {
    let mut command = Command::new(program);
    command.args(args).current_dir(search.folder).env("PATH", search.path);
    command
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

// ---- C and C++ ----

fn clangd(search: &Search) -> Option<PathBuf> {
    on_path("clangd", search).find(|path| !is_xcode_shim(path) || developer_tools_installed()).or_else(|| xcrun_clangd(search))
}

/// On a Mac `/usr/bin/clangd` always exists. Without Xcode's command-line tools it is a stub
/// that puts up an "install the developer tools?" dialog when run, which looking for a server
/// must never do.
fn is_xcode_shim(path: &Path) -> bool {
    cfg!(target_os = "macos") && path == Path::new("/usr/bin/clangd")
}

fn developer_tools_installed() -> bool {
    let mut command = Command::new("/usr/bin/xcode-select");
    command.arg("-p");
    probe::answer(command, TOOL_LIMIT).is_some_and(|dir| Path::new(&dir).is_dir())
}

/// The clangd inside Xcode or the command-line tools, for a PATH that leaves out `/usr/bin`.
/// `xcrun` is itself a stub without the developer tools, so it is only asked when they exist.
fn xcrun_clangd(search: &Search) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let xcrun = on_path("xcrun", search).next().filter(|_| developer_tools_installed())?;
    executable(probe::answer(tool(&xcrun, &["-f", "clangd"], search), TOOL_LIMIT)?.into())
}

// ---- Rust ----

/// rustup puts a `rust-analyzer` in `~/.cargo/bin` whether or not the component is installed;
/// without it that proxy only prints how to add it. So a candidate counts only if it answers
/// `--version`, asked in the folder because the folder's `rust-toolchain.toml` picks the toolchain.
fn rust_analyzer(search: &Search) -> Option<PathBuf> {
    let answers = |path: &PathBuf| probe::run(tool(path, &["--version"], search), TOOL_LIMIT).is_some_and(|outcome| outcome.success);
    on_path("rust-analyzer", search).find(answers).or_else(|| {
        let rustup = on_path("rustup", search).next()?;
        executable(probe::answer(tool(&rustup, &["which", "rust-analyzer"], search), TOOL_LIMIT)?.into())
    })
}

// ---- Go ----

/// `go install` puts gopls in `$GOPATH/bin` (`~/go/bin` unless changed), which many profiles
/// never add to PATH.
fn gopls(search: &Search) -> Option<PathBuf> {
    on_path("gopls", search).next().or_else(|| executable(search.home.join("go/bin/gopls"))).or_else(|| {
        let go = on_path("go", search).next()?;
        let gopath = probe::answer(tool(&go, &["env", "GOPATH"], search), TOOL_LIMIT)?;
        gopath.split(':').find_map(|dir| executable(Path::new(dir).join("bin/gopls")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;

    /// A scratch machine: a project folder, a home directory and two directories on the PATH.
    struct Machine {
        root: PathBuf,
        folder: PathBuf,
        home: PathBuf,
        path: String,
    }

    impl Machine {
        fn new(name: &str) -> Machine {
            // Canonical, so paths compare equal to what tools print (/tmp is a link on a Mac).
            let root = temp_dir(name).canonicalize().unwrap();
            let folder = root.join("project");
            let home = root.join("home");
            for dir in [&folder, &home, &root.join("bin"), &root.join("other-bin")] {
                fs::create_dir_all(dir).unwrap();
            }
            let path = format!("{}:{}", root.join("bin").display(), root.join("other-bin").display());
            Machine { root, folder, home, path }
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

        fn find(&self, kind: Kind) -> Option<Found> {
            self.find_with(kind, None)
        }

        fn find_with(&self, kind: Kind, virtual_env: Option<&Path>) -> Option<Found> {
            find(kind, &Search { folder: &self.folder, path: &self.path, home: &self.home, virtual_env })
        }
    }

    impl Drop for Machine {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    const KINDS: [(&str, Kind); 6] = [
        ("python", Kind::Python),
        ("clang", Kind::Clang),
        ("java", Kind::Java),
        ("typescript", Kind::TypeScript),
        ("rust", Kind::Rust),
        ("go", Kind::Go),
    ];

    #[test]
    fn kinds_are_named_as_the_interface_names_them() {
        for (name, kind) in KINDS {
            assert_eq!(Kind::parse(name), Some(kind));
        }
        assert_eq!(Kind::parse("cobol"), None);
        assert_eq!(Kind::parse("Python"), None);
    }

    #[test]
    fn a_machine_with_nothing_installed_has_no_servers() {
        let machine = Machine::new("lsp-find-none");
        for (name, kind) in KINDS {
            assert_eq!(machine.find(kind), None, "{name}");
        }
    }

    #[test]
    fn only_executable_files_count() {
        let machine = Machine::new("lsp-find-exec");
        fs::write(machine.root.join("bin/gopls"), "not a program").unwrap();
        fs::create_dir_all(machine.root.join("bin/jdtls")).unwrap();
        assert_eq!(machine.find(Kind::Go), None, "a file without the executable bit");
        assert_eq!(machine.find(Kind::Java), None, "a directory");
        // The next place on the path is still tried.
        let real = machine.install("other-bin/gopls");
        assert_eq!(machine.find(Kind::Go).unwrap().path, real);
    }

    #[test]
    fn relative_path_entries_are_never_searched() {
        let mut machine = Machine::new("lsp-find-relative");
        machine.install("project/gopls");
        machine.path = format!(".:{}", machine.path);
        // Even from inside the folder, where "." would find the planted file.
        assert_eq!(machine.find(Kind::Go), None);
    }

    #[test]
    fn the_folders_own_environment_comes_before_the_path() {
        let machine = Machine::new("lsp-find-venv");
        machine.install("bin/basedpyright-langserver");
        let own = machine.install("project/.venv/bin/pylsp");
        let python = machine.install("project/.venv/bin/python");
        let found = machine.find(Kind::Python).unwrap();
        // pylsp ranks below basedpyright, but it is the one the project installed.
        assert_eq!((found.name, &found.path, found.args), ("pylsp", &own, &[][..]));
        assert_eq!(found.python, Some(python));
    }

    #[test]
    fn python_servers_are_preferred_in_order_within_a_place() {
        let machine = Machine::new("lsp-find-rank");
        let pylsp = machine.install("bin/pylsp");
        assert_eq!(machine.find(Kind::Python).unwrap().path, pylsp);
        let pyright = machine.install("other-bin/pyright-langserver");
        let found = machine.find(Kind::Python).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("pyright", &pyright, &["--stdio"][..]), "later on the path, but better");
        let based = machine.install("other-bin/basedpyright-langserver");
        let found = machine.find(Kind::Python).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("basedpyright", &based, &["--stdio"][..]));
        assert_eq!(found.python, None, "the folder has no environment of its own");
    }

    #[test]
    fn a_server_on_the_path_still_analyses_against_the_folders_environment() {
        let machine = Machine::new("lsp-find-interpreter");
        let server = machine.install("bin/basedpyright-langserver");
        let python = machine.install("project/.venv/bin/python");
        let found = machine.find(Kind::Python).unwrap();
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
        let found = machine.find_with(Kind::Python, Some(&active)).unwrap();
        assert_eq!((&found.path, found.python.as_ref()), (&active_server, Some(&active_python)));
        assert_eq!(machine.find(Kind::Python), None, "not found unless it is the active environment");

        let venv_python = machine.install("project/venv/bin/python");
        let found = machine.find_with(Kind::Python, Some(&active)).unwrap();
        assert_eq!(
            (&found.path, found.python.as_ref()),
            (&active_server, Some(&venv_python)),
            "the folder's interpreter, the active server"
        );

        let dot_server = machine.install("project/.venv/bin/pyright-langserver");
        let dot_python = machine.install("project/.venv/bin/python");
        let found = machine.find_with(Kind::Python, Some(&active)).unwrap();
        assert_eq!((found.name, &found.path, found.python.as_ref()), ("pyright", &dot_server, Some(&dot_python)));
    }

    #[test]
    fn a_server_without_an_environment_runs_with_the_search_path() {
        let machine = Machine::new("lsp-find-env-plain");
        machine.install("bin/jdtls");
        let command = machine.find(Kind::Java).unwrap().command(&machine.folder);
        let envs: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_string_lossy().into_owned(), value.map(|v| v.to_string_lossy().into_owned())))
            .collect();
        assert_eq!(envs, [("PATH".to_string(), Some(machine.path.clone()))]);
    }

    #[test]
    fn typescript_prefers_the_projects_own_server() {
        let machine = Machine::new("lsp-find-ts");
        let global = machine.install("bin/typescript-language-server");
        let found = machine.find(Kind::TypeScript).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("typescript-language-server", &global, &["--stdio"][..]));
        let own = machine.install("project/node_modules/.bin/typescript-language-server");
        assert_eq!(machine.find(Kind::TypeScript).unwrap().path, own);
    }

    #[test]
    fn clangd_and_jdtls_are_found_on_the_path() {
        let machine = Machine::new("lsp-find-simple");
        let clangd = machine.install("other-bin/clangd");
        let jdtls = machine.install("bin/jdtls");
        let found = machine.find(Kind::Clang).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("clangd", &clangd, &[][..]));
        let found = machine.find(Kind::Java).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("jdtls", &jdtls, &[][..]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn xcrun_is_asked_for_clangd_when_the_path_has_none() {
        if !developer_tools_installed() {
            return eprintln!("skipped: Xcode's command-line tools are not installed");
        }
        let machine = Machine::new("lsp-find-xcrun");
        let clangd = machine.install("toolchain/usr/bin/clangd");
        machine.script("bin/xcrun", &format!("[ \"$1 $2\" = '-f clangd' ] && echo '{}'", clangd.display()));
        assert_eq!(machine.find(Kind::Clang).unwrap().path, clangd);
        // An xcrun that names something that is not there is no server.
        machine.script("bin/xcrun", "echo /nonexistent/clangd");
        assert_eq!(machine.find(Kind::Clang), None);
    }

    #[test]
    fn a_rustup_proxy_without_the_component_is_not_a_server() {
        let machine = Machine::new("lsp-find-rust");
        machine.script("bin/rust-analyzer", "echo \"error: 'rust-analyzer' is not installed for the toolchain\" >&2; exit 1");
        assert_eq!(machine.find(Kind::Rust), None);
        // One that answers --version, later on the path, is.
        let real = machine.script("other-bin/rust-analyzer", "[ \"$1\" = --version ] && echo 'rust-analyzer 1.0'");
        let found = machine.find(Kind::Rust).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("rust-analyzer", &real, &[][..]));
    }

    #[test]
    fn rustup_is_asked_where_rust_analyzer_is_when_the_path_has_none() {
        let machine = Machine::new("lsp-find-rustup");
        let real = machine.install("toolchains/stable/bin/rust-analyzer");
        machine.script("bin/rustup", &format!("[ \"$1 $2\" = 'which rust-analyzer' ] && echo '{}'", real.display()));
        assert_eq!(machine.find(Kind::Rust).unwrap().path, real);
        machine.script("bin/rustup", "echo 'error: not installed' >&2; exit 1");
        assert_eq!(machine.find(Kind::Rust), None);
    }

    #[test]
    fn rust_analyzer_is_asked_from_inside_the_folder() {
        let machine = Machine::new("lsp-find-rust-cwd");
        // Stands in for a proxy that reads the folder's rust-toolchain.toml.
        machine.script("bin/rust-analyzer", "[ -f rust-toolchain.toml ]");
        assert_eq!(machine.find(Kind::Rust), None);
        fs::write(machine.folder.join("rust-toolchain.toml"), "[toolchain]\nchannel = \"stable\"\n").unwrap();
        assert!(machine.find(Kind::Rust).is_some());
    }

    #[test]
    fn gopls_is_found_on_the_path_then_in_the_home_go_folder_then_through_go_env() {
        let machine = Machine::new("lsp-find-go");
        let custom = machine.install("gopath/bin/gopls");
        machine.script("bin/go", &format!("[ \"$1 $2\" = 'env GOPATH' ] && echo '/nonexistent:{}'", machine.root.join("gopath").display()));
        assert_eq!(machine.find(Kind::Go).unwrap().path, custom, "the second GOPATH entry has it");
        let home = machine.install("home/go/bin/gopls");
        assert_eq!(machine.find(Kind::Go).unwrap().path, home);
        let on_path = machine.install("other-bin/gopls");
        let found = machine.find(Kind::Go).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("gopls", &on_path, &[][..]));
    }
}
