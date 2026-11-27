//! Finds the language server for a kind of code among what the student has installed. Nothing
//! is ever downloaded or installed from here: a server that is not found is reported as missing
//! and the interface says how to install it.
//!
//! Looking runs nothing that belongs to the open folder and nothing inside it. The few helper
//! tools that are asked (`xcode-select`, `xcrun`, `go env`) are the machine's own and run in the
//! home folder. What is found may well be the folder's own (a server in its `.venv` or
//! `node_modules`), which is why `lsp.rs` looks only once the student has turned code checking
//! on for the folder.

use super::probe;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

/// How long a helper tool (`xcode-select`, `xcrun`, `go env`) may take.
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
    /// Variables from the login shell that the servers are started with.
    pub vars: &'a [(String, String)],
    /// Where rustup keeps its toolchains and settings (`~/.rustup` unless moved).
    pub rustup_home: &'a Path,
    /// `RUSTUP_TOOLCHAIN`, when set: the toolchain rustup uses whatever the folder says.
    pub rustup_toolchain: Option<&'a str>,
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
    /// Further variables it runs with.
    vars: Vec<(String, String)>,
}

impl Found {
    fn new(name: &'static str, path: PathBuf, args: &'static [&'static str], search: &Search) -> Found {
        Found { name, path, args, python: None, search_path: search.path.to_string(), vars: search.vars.to_vec() }
    }

    /// The command that starts the server in `folder`. With a Python environment it runs as it
    /// would in a shell where that environment is activated: pyright and jedi both ask the
    /// `python` on PATH what it can import, so this is what makes the folder's packages resolve.
    pub fn command(&self, folder: &Path) -> Command {
        let mut command = Command::new(&self.path);
        command.args(self.args).current_dir(folder).envs(self.vars.iter().map(|(name, value)| (name, value)));
        // rust-analyzer runs cargo, which may be rustup's proxy: it must report a toolchain
        // that is not installed, not download it. (Older rustups ignore this; for them
        // `rust_analyzer` finds no server in a folder whose toolchain is missing.)
        command.env("RUSTUP_AUTO_INSTALL", "0");
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

/// A helper tool run with the search path. It runs in the home folder, never the open one: a
/// tool that reads the folder it is in (`go` reads `go.mod`) must not act on what a folder says.
fn tool(program: &Path, args: &[&str], search: &Search) -> Command {
    let mut command = Command::new(program);
    command.args(args).current_dir(search.home).env("PATH", search.path);
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

/// rustup puts a `rust-analyzer` in `~/.cargo/bin` whether or not the component is installed:
/// a proxy that runs the real one from whichever toolchain the folder uses. Running a proxy, or
/// asking `rustup which`, in a folder whose `rust-toolchain.toml` names a toolchain that is not
/// installed makes rustup download that toolchain, which looking for a server must never do.
/// So nothing is run. The toolchain is worked out from rustup's own files, a proxy is replaced
/// by the real program inside that toolchain, and when rustup manages Rust here and the
/// folder's toolchain is not installed there is no server: installing it is the student's call.
fn rust_analyzer(search: &Search) -> Option<PathBuf> {
    let rustup = on_path("rustup", search).next();
    let toolchain = match (&rustup, active_toolchain(search)) {
        (Some(_), Some(name)) => Some(toolchain_dir(search.rustup_home, &name)?),
        _ => None,
    };
    let in_toolchain = || executable(toolchain.as_ref()?.join("bin/rust-analyzer"));
    let is_proxy = |path: &Path| rustup.as_deref().is_some_and(|rustup| same_program(path, rustup));
    on_path("rust-analyzer", search).find_map(|path| if is_proxy(&path) { in_toolchain() } else { Some(path) }).or_else(in_toolchain)
}

/// Whether two paths are the same program: one file under two names (rustup's proxies are
/// links to it), or copies of it, which is how rustup installs them where it cannot link.
fn same_program(a: &Path, b: &Path) -> bool {
    let (Ok(a), Ok(b)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    (a.dev(), a.ino()) == (b.dev(), b.ino()) || (a.len() == b.len() && a.len() > 0)
}

/// The value of `key = "value"` on a line of one of rustup's files. `key` may itself be quoted.
fn value_of<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (name, value) = line.split_once('=')?;
    (name.trim().trim_matches('"') == key).then(|| value.trim().trim_matches(|c| c == '"' || c == '\''))
}

/// The toolchain rustup would use in the folder, in rustup's own order: `RUSTUP_TOOLCHAIN`, an
/// override set for the folder or one above it, the nearest `rust-toolchain` file, the default.
fn active_toolchain(search: &Search) -> Option<String> {
    if let Some(name) = search.rustup_toolchain.filter(|name| !name.is_empty()) {
        return Some(name.to_string());
    }
    let settings = std::fs::read_to_string(search.rustup_home.join("settings.toml")).unwrap_or_default();
    let named_in = |text: &str, key: &str| text.lines().find_map(|line| value_of(line, key)).map(String::from);
    let overridden = search.folder.ancestors().find_map(|dir| named_in(&settings, &dir.to_string_lossy()));
    let pinned = || {
        search.folder.ancestors().find_map(|dir| {
            let text = ["rust-toolchain", "rust-toolchain.toml"].iter().find_map(|name| std::fs::read_to_string(dir.join(name)).ok())?;
            // The older form of the file is the toolchain's name and nothing else.
            let bare = text.trim();
            named_in(&text, "channel").or_else(|| (!bare.is_empty() && !bare.contains(['=', '[', '\n'])).then(|| bare.to_string()))
        })
    };
    overridden.or_else(pinned).or_else(|| named_in(&settings, "default_toolchain"))
}

/// Where the toolchain called `name` is installed: under that name, or, for a short name such
/// as `stable` or `1.84`, under the name with this machine's kind appended.
fn toolchain_dir(rustup_home: &Path, name: &str) -> Option<PathBuf> {
    let toolchains = rustup_home.join("toolchains");
    let exact = toolchains.join(name);
    if exact.is_dir() {
        return Some(exact);
    }
    let prefix = format!("{name}-");
    // `nightly` is not `nightly-2025-01-01-…`: what follows must be a machine, not a date.
    let is_full_name = |dir: &str| dir.strip_prefix(&prefix).is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_digit()));
    std::fs::read_dir(toolchains)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.is_dir() && path.file_name().is_some_and(|dir| is_full_name(&dir.to_string_lossy())))
}

// ---- Go ----

/// `go install` puts gopls in `$GOPATH/bin` (`~/go/bin` unless changed), which many profiles
/// never add to PATH.
fn gopls(search: &Search) -> Option<PathBuf> {
    on_path("gopls", search).next().or_else(|| executable(search.home.join("go/bin/gopls"))).or_else(|| {
        let go = on_path("go", search).next()?;
        let mut ask = tool(&go, &["env", "GOPATH"], search);
        // The installed go answers itself, rather than fetching a version some go.mod asks for.
        ask.env("GOTOOLCHAIN", "local");
        let gopath = probe::answer(ask, TOOL_LIMIT)?;
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
            self.find_in(kind, virtual_env, None)
        }

        fn find_in(&self, kind: Kind, virtual_env: Option<&Path>, rustup_toolchain: Option<&str>) -> Option<Found> {
            let vars = [("JAVA_HOME".to_string(), "/opt/java".to_string())];
            let rustup_home = self.home.join(".rustup");
            find(
                kind,
                &Search {
                    folder: &self.folder,
                    path: &self.path,
                    home: &self.home,
                    virtual_env,
                    vars: &vars,
                    rustup_home: &rustup_home,
                    rustup_toolchain,
                },
            )
        }

        /// A file that records being run, for proving that looking ran nothing.
        fn tripwire(&self, at: &str) -> PathBuf {
            self.script(at, &format!("echo \"$0 $*\" >> '{}'", self.root.join("ran").display()))
        }

        fn ran(&self) -> String {
            fs::read_to_string(self.root.join("ran")).unwrap_or_default()
        }

        /// Installs rustup with `toolchain`, and its proxy for rust-analyzer, as rustup does.
        fn rustup(&self, toolchain: &str, default: &str) {
            let rustup = self.tripwire("bin/rustup");
            fs::hard_link(&rustup, self.root.join("bin/rust-analyzer")).unwrap();
            fs::create_dir_all(self.home.join(".rustup/toolchains").join(toolchain).join("bin")).unwrap();
            fs::write(self.home.join(".rustup/settings.toml"), format!("default_toolchain = \"{default}\"\nversion = \"12\"\n")).unwrap();
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
        assert_eq!(env("JAVA_HOME").as_deref(), Some("/opt/java"), "what the login shell sets is passed on");
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
        let set = |name: &str, value: &str| (name.to_string(), Some(value.to_string()));
        assert_eq!(envs, [set("JAVA_HOME", "/opt/java"), set("PATH", &machine.path), set("RUSTUP_AUTO_INSTALL", "0")]);
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

    const HOST: &str = "stable-aarch64-apple-darwin";

    #[test]
    fn a_rustup_proxy_without_the_component_is_not_a_server_and_is_never_run() {
        let machine = Machine::new("lsp-find-rust");
        machine.rustup(HOST, HOST);
        assert_eq!(machine.find(Kind::Rust), None);
        // A rust-analyzer that is not rustup's, later on the path, is one.
        let real = machine.install("other-bin/rust-analyzer");
        let found = machine.find(Kind::Rust).unwrap();
        assert_eq!((found.name, &found.path, found.args), ("rust-analyzer", &real, &[][..]));
        assert_eq!(machine.ran(), "", "neither rustup nor its proxy was run");
    }

    #[test]
    fn a_rustup_proxy_is_replaced_by_the_real_program_in_the_folders_toolchain() {
        let machine = Machine::new("lsp-find-rustup");
        machine.rustup(HOST, HOST);
        let real = machine.install(&format!("home/.rustup/toolchains/{HOST}/bin/rust-analyzer"));
        assert_eq!(machine.find(Kind::Rust).unwrap().path, real);
        // Also when the proxy is not on the path at all.
        fs::remove_file(machine.root.join("bin/rust-analyzer")).unwrap();
        assert_eq!(machine.find(Kind::Rust).unwrap().path, real);

        // The folder picks the toolchain: by a short name, by the older one-line file, by an
        // override set for a folder above it, and RUSTUP_TOOLCHAIN over them all.
        let pinned = machine.install("home/.rustup/toolchains/1.84-aarch64-apple-darwin/bin/rust-analyzer");
        fs::write(machine.folder.join("rust-toolchain.toml"), "[toolchain]\nchannel = \"1.84\"\ncomponents = [\"rustfmt\"]\n").unwrap();
        assert_eq!(machine.find(Kind::Rust).unwrap().path, pinned);
        fs::remove_file(machine.folder.join("rust-toolchain.toml")).unwrap();
        fs::write(machine.folder.join("rust-toolchain"), "1.84\n").unwrap();
        assert_eq!(machine.find(Kind::Rust).unwrap().path, pinned);
        assert_eq!(machine.find_in(Kind::Rust, None, Some(HOST)).unwrap().path, real);
        let settings = format!("default_toolchain = \"1.84\"\n\n[overrides]\n\"{}\" = \"{HOST}\"\n", machine.root.display());
        fs::write(machine.home.join(".rustup/settings.toml"), settings).unwrap();
        assert_eq!(machine.find(Kind::Rust).unwrap().path, real);
        assert_eq!(machine.ran(), "");
    }

    #[test]
    fn a_folder_whose_toolchain_is_not_installed_has_no_server_so_rustup_downloads_nothing() {
        let machine = Machine::new("lsp-find-rust-pinned");
        machine.rustup(HOST, HOST);
        machine.install(&format!("home/.rustup/toolchains/{HOST}/bin/rust-analyzer"));
        // Its own rust-analyzer would run cargo, which is rustup's proxy too.
        machine.install("other-bin/rust-analyzer");
        machine.install("home/.rustup/toolchains/nightly-2025-01-01-aarch64-apple-darwin/bin/rust-analyzer");
        fs::write(machine.folder.join("rust-toolchain.toml"), "[toolchain]\nchannel = \"nightly\"\n").unwrap();
        assert_eq!(machine.find(Kind::Rust), None, "a dated nightly is not the nightly the folder asks for");
        assert_eq!(machine.ran(), "");
        // Without rustup the file means nothing, and the rust-analyzer on the path is the server.
        fs::remove_file(machine.root.join("bin/rustup")).unwrap();
        fs::remove_file(machine.root.join("bin/rust-analyzer")).unwrap();
        assert_eq!(machine.find(Kind::Rust).unwrap().path, machine.root.join("other-bin/rust-analyzer"));
    }

    #[test]
    fn looking_runs_nothing_from_the_folder() {
        let machine = Machine::new("lsp-find-tripwires");
        for planted in [
            "project/.venv/bin/python",
            "project/.venv/bin/pylsp",
            "project/venv/bin/basedpyright-langserver",
            "project/node_modules/.bin/typescript-language-server",
            "project/rust-analyzer",
            "project/gopls",
            "project/go",
            "project/clangd",
            "project/jdtls",
            "project/rustup",
        ] {
            machine.tripwire(planted);
        }
        fs::write(machine.folder.join("rust-toolchain.toml"), "[toolchain]\nchannel = \"nightly\"\n").unwrap();
        fs::write(machine.folder.join("go.mod"), "module planted\n\ngo 1.99\ntoolchain go1.99.0\n").unwrap();
        for (_, kind) in KINDS {
            machine.find(kind);
        }
        assert_eq!(machine.ran(), "");
    }

    #[test]
    fn go_is_asked_from_the_home_folder_and_told_not_to_fetch_another_version() {
        let machine = Machine::new("lsp-find-go-home");
        let custom = machine.install("gopath/bin/gopls");
        let said = format!(
            "[ \"$PWD\" = '{}' ] && [ \"$GOTOOLCHAIN\" = local ] && echo '{}'",
            machine.home.display(),
            machine.root.join("gopath").display()
        );
        machine.script("bin/go", &said);
        assert_eq!(machine.find(Kind::Go).unwrap().path, custom);
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
