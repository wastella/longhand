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

| Path                            | What it is                                                               |
| ------------------------------- | ------------------------------------------------------------------------ |
| `src/renderer/`                 | The interface: plain JavaScript, CodeMirror 6 and xterm.js, no framework |
| `src-tauri/src/main.rs`         | Window, menu, file access, per-folder settings and the usage log         |
| `src-tauri/src/tutor.rs`        | Starts the tutor through the `claude` CLI and streams its answer         |
| `src-tauri/src/tutor-prompt.md` | The tutor's instructions                                                 |
| `src-tauri/src/pytest.rs`       | Runs pytest and parses its output                                        |
| `src-tauri/src/term.rs`         | The terminal                                                             |
| `scripts/`                      | A mock backend, interface tests and the README screenshot                |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces talk to each other.

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

The interface tests run the real interface against `scripts/mock-backend.js`, so they need Chrome
or Chromium (set `CHROME` if it is somewhere unusual) but not a Rust build. If you change what the
backend returns, update the mock to match.

`LONGHAND_SMOKE_DIR=/path/to/a/pytest/project npm run smoke` drives the real app end to end,
including two real tutor questions on your own Claude account. Run it when you touch `tutor.rs`,
`term.rs` or `pytest.rs`.

If you change the interface's appearance, run `npm run screenshot` and commit the new
`docs/screenshot.png`.

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
