# Contributing to Longhand

Thanks for wanting to help. Longhand is small on purpose, and the aim is to keep it that way while
making it solid.

## Setup

You need Node.js 22+, Rust stable (via [rustup](https://rustup.rs)) and, on macOS, Xcode's
command-line tools.

```bash
npm install
npm run dev
```

The first build compiles the Rust dependencies and takes a few minutes. Later builds are quick.

## How the code is laid out

| Path                            | What it is                                                                 |
| ------------------------------- | -------------------------------------------------------------------------- |
| `src/renderer/main.js`          | Starts the interface and mounts each area into its region of `index.html`  |
| `src/renderer/backend.js`       | The only module that calls the Rust backend                                |
| `src/renderer/state.js`         | Shared state and the events areas use to talk to each other                |
| `src/renderer/shell/`           | Layout, panels, title and status bars, welcome screen, text size, commands |
| `src/renderer/editor/`          | CodeMirror, tabs, saving                                                   |
| `src/renderer/files/`           | File tree, its menu, find in files                                         |
| `src/renderer/terminal/`        | The terminal (xterm.js)                                                    |
| `src/renderer/tests/`           | The test panel                                                             |
| `src/renderer/tutor/`           | The tutor panel: chat, Markdown and hidden code, context, setup steps      |
| `src/renderer/styles/`          | Design tokens, shared components and one stylesheet per area               |
| `src-tauri/src/main.rs`         | Start-up and command registration                                          |
| `src-tauri/src/workspace.rs`    | The open folder, per-folder settings and the usage log                     |
| `src-tauri/src/files.rs`        | File access, kept inside the open folder                                   |
| `src-tauri/src/menu.rs`         | The menu bar                                                               |
| `src-tauri/src/system.rs`       | Dialogs, opening links, the self-test result                               |
| `src-tauri/src/tutor.rs`        | Starts the tutor through the `claude` CLI and streams its answer           |
| `src-tauri/src/tutor-prompt.md` | The tutor's instructions                                                   |
| `src-tauri/src/pytest.rs`       | Runs pytest and parses its output                                          |
| `src-tauri/src/term.rs`         | The terminal                                                               |
| `tests/ui/`                     | Interface tests, one file per area                                         |
| `tests/mock/`                   | A mock backend for the interface tests and previews, one file per area     |
| `scripts/`                      | The headless-Chrome launcher and the preview command with its scenarios    |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces talk to each other, and
[docs/DESIGN.md](docs/DESIGN.md) describes the design tokens and shared components.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
npm run format:check                 # Prettier
npm run test:ui                      # interface tests in headless Chrome
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The interface tests run the real interface against the mock backend in `tests/mock/`, so they
need Chrome or Chromium (set `CHROME` if it is somewhere unusual) but not a Rust build. If you
change what the backend returns, update that area's mock file to match.

`LONGHAND_SMOKE_DIR=/path/to/a/pytest/project npm run smoke` drives the real app end to end,
including two real tutor questions on your own Claude account. Run it when you touch `tutor.rs`,
`term.rs` or `pytest.rs`.

To look at the interface without building the app, run
`npm run preview -- --out shot.png --scenario <name>` (`--list` shows the scenarios in
`scripts/scenarios/`). If you change the interface's appearance, run `npm run screenshot` and
commit the new `docs/screenshot.png`.

## What fits

Good first contributions: bug fixes, clearer error messages, tests, editor basics that are
missing (see the roadmap in the README), and support for more platforms.

Changes to the tutor's prompt or policies are welcome but need evidence: show the prompts you
tried and what the tutor said before and after.

Some things will be declined however well they are built, because leaving them out is the point
of the project:

- AI autocomplete or inline suggestions
- Any mode where the AI edits files or runs commands
- "Fix this for me" actions on errors or failing tests
- Telemetry or anything that sends data to a server the project runs

If you are unsure whether an idea fits, open an issue before writing the code.

## Pull requests

- Keep each pull request to one change, with tests where the change can be tested.
- Describe what a user would notice, not only what the code does.
- Add a line to `CHANGELOG.md` under "Unreleased" for anything a user would notice.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
