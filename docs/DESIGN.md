# Design

Longhand should feel like a quiet desk: the student's code is the brightest thing on screen, and
everything else steps back. This page describes the look the app already has, so new work
matches it.

## Principles

- **Quiet.** Chrome is muted grey text on dark neutral surfaces. Nothing animates, pulses or
  badges for attention.
- **Typographic.** Hierarchy comes from size, weight, case and muted colour, not from boxes,
  icons or colour fills. Pane titles are small uppercase labels; the welcome screen is one title
  and one sentence.
- **Dark neutral surfaces.** Three close greys separate the editor, the side panels and hovered
  rows. Borders are single 1px lines in `--color-border`.
- **One accent, used sparingly.** Amber (`--color-accent`) marks the one primary action in a view
  (Ask, Open a folder, Check again), keyboard focus, unsaved files and links. If two things on
  screen are amber, one of them probably should not be.
- **No decoration.** No gradients, no illustrations, no shadows except on menus that float above
  the layout. Status colours (success, danger, warning) appear only as small dots or short words.

## Tokens

All values live in [`src/renderer/styles/tokens.css`](../src/renderer/styles/tokens.css). Use a
token rather than a literal; if none fits, add one there rather than inventing a value in place.

| Group   | Tokens                                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface | `--color-surface` (editor, terminal), `--color-surface-raised` (side panels, tab bar), `--color-surface-hover` (hovered and selected rows, buttons), `--color-surface-sunken` (code in answers) |
| Line    | `--color-border`, `--color-border-strong` (hovered button), `--color-border-overlay` (menus)                                                                                                    |
| Text    | `--color-text`, `--color-text-strong`, `--color-text-secondary`, `--color-text-muted`, `--color-on-accent`                                                                                      |
| Signal  | `--color-accent`, `--color-success`, `--color-danger`, `--color-warning`, `--focus-ring-color`, `--color-selection`                                                                             |
| Type    | `--font-ui`, `--font-mono`, `--code-size` (user-adjustable), `--text-2xs` … `--text-display`, `--leading-ui`, `--leading-reading`, `--leading-output`                                           |
| Space   | `--space-1` … `--space-10`, where `--space-N` is 2N px                                                                                                                                          |
| Shape   | `--radius-xs` (3px) … `--radius-2xl` (8px), `--radius-round`, `--shadow-overlay`                                                                                                                |
| Layout  | `--titlebar-height`, `--pane-head-height`, `--tab-bar-height`, `--status-height`, `--row-height`, panel widths                                                                                  |

Colour tokens are roles, not hues, and they sit in their own `:root` block. A light theme would
be a second block that redefines only those. Code that cannot use `var()` (xterm.js draws its own
canvas) reads token values with `token()` from `src/renderer/dom.js`.

A few compact controls keep odd pixel paddings (3px, 7px, 9px). These are optical adjustments
that belong to the component; layout spacing uses the scale.

## Shared components

These live in [`base.css`](../src/renderer/styles/base.css). Build new UI from them before adding
area-specific styles.

- **Buttons.** The default `button` is a raised grey pill for secondary actions (Explain
  selection, Ask tutor). `.primary` is amber with dark text, for the one main action in a view.
  `.ghost` has no background until hovered, for actions in pane headers (Find, +, New, Run all).
- **Text input** (`.text-input`). Sunk to `--color-surface` with a 1px border that turns amber on
  focus. Size, font and radius are set per use: the question box, the search field, the naming
  field in the tree.
- **List row** (`.list-row`). One clickable line in a list: flex, no wrapping, and the hover
  surface on hover or when `.active`. Used by file tree rows, test results and search hits.
- **Pane header** (`.pane-head`, or `paneHead()` in `dom.js`). The 30px row at the top of a panel:
  small uppercase muted title, a `spacer()`, then ghost buttons or a select.
- **Empty state** (`.empty-state`, or `emptyState(text)` in `dom.js`). One muted line where a
  list has nothing to show: "No matches.", "Run the tests to see results here."

## Checking your work

`npm run preview -- --out shot.png --scenario <name>` renders the interface against the mock
backend; `--list` shows the scenarios. Compare against `docs/screenshot.png` and the other
scenarios before and after a visual change.
