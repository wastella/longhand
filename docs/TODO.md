# To do

Work that is known about and not started. The [roadmap](../README.md#roadmap) is the public list
of larger features; this is the working list behind it. Move an item out when a pull request for
it merges.

## Notebooks

- **Margin review and Explain in notebooks.** Notes are pinned to a file and a line range, and a
  notebook's lines on disk are JSON. Notes need to be pinned to a cell and a line inside it, and
  survive cells being added or deleted; the tutor's instructions need to name cells, not file
  lines.
- **Language-server underlines in code cells.** A cell is not a file, and checking one alone marks
  every name from an earlier cell as an error. The code cells need to be joined into one virtual
  Python document for the server, with positions mapped back to the right cell.

## Tutor

- Cancelling a run stops the Claude Code process but not its child processes.
- Revealed code is hidden again after a restart, and revealing it again is logged again.
- The full guardrail evaluation in `evals/` has never been run end to end, so there is no measured
  leak rate yet.

## Shell

- Quitting from the Dock, logging out and shutting down skip the unsaved-work prompt.

## Tests

- `the terminal resizes with the text size and after being hidden` in `tests/ui/terminal.test.mjs`
  fails now and then: the terminal fits on an animation frame, so two quick zoom steps sometimes
  produce two resizes.

## Languages

- Language servers and syntax colouring are Python only for now. C, C++, Java, JavaScript,
  TypeScript, Rust and Go were built once and removed until each can be checked against its real
  server; Run File and the test panel are also Python only.
