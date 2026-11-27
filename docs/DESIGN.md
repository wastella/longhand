# Design

Longhand should feel like a quiet desk: the student's code is the brightest thing on screen, and
everything else steps back. This page describes the look the app has, so new work matches it.
The reference points are small, opinionated native Mac apps, not VS Code.

## Principles

- **Quiet.** Chrome is muted grey text on neutral surfaces. Nothing pulses or badges for
  attention; motion is short and only marks something appearing or changing state.
- **Typographic.** Hierarchy comes from size, weight, case and muted colour, not from boxes or
  colour fills. Pane titles and section labels are small uppercase labels; the welcome screen is
  one title, one or two sentences and one action.
- **Neutral surfaces, two themes.** Three close greys separate the editor, the side panels and
  hovered rows, in dark and in light. Borders are single 1px lines in `--color-border`.
- **One accent, used sparingly.** Amber (`--color-accent`) marks the one primary action in a view
  (Ask, Open Folder…, Check again), keyboard focus, unsaved files, links and the highlighted item
  of a menu. If two things on screen are amber, one of them probably should not be.
- **No decoration.** No gradients and no illustrations. Shadows only on things that float above
  the layout (menus, sheets, notifications, tooltips). Status colours appear only as small dots,
  icons or short words.
- **Every control reachable from the keyboard,** with the accent focus ring showing where focus
  is.

## Tokens

All values live in [`src/renderer/styles/tokens.css`](../src/renderer/styles/tokens.css). Use a
token rather than a literal; if none fits, add one there rather than inventing a value in place.

| Group    | Tokens                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface  | `--color-surface` (editor, terminal), `--color-surface-raised` (side panels, bars), `--color-surface-hover` (hovered and selected rows, buttons), `--color-surface-sunken` (code in answers), `--color-surface-overlay` (menus, sheets, notifications), `--color-overlay-hover` |
| Line     | `--color-border` (separators), `--color-border-control` (buttons, fields, selects), `--color-border-strong`, `--color-border-overlay` (the edge of anything floating)                                                                                                           |
| Text     | `--color-text`, `--color-text-strong`, `--color-text-secondary`, `--color-text-muted`, `--color-on-accent`                                                                                                                                                                      |
| Signal   | `--color-accent`, `--color-accent-soft`, `--color-success`, `--color-danger`, `--color-danger-soft`, `--color-warning`, `--focus-ring-color`, `--color-selection`, `--color-backdrop`                                                                                           |
| Code     | `--color-code-*`: syntax colours (keyword, string, number, function, type, comment, punctuation) for the editor and code in tutor answers, and the editor's marks (line numbers, active line, matches, brackets); `--color-note-*` for tutor notes in the editor                |
| Terminal | `--color-ansi-*`: the sixteen ANSI colours, read by `terminal/theme.js`                                                                                                                                                                                                         |
| Type     | `--font-ui`, `--font-mono`, `--code-size` (a setting), `--text-2xs` … `--text-display`, `--leading-ui`, `--leading-reading`, `--leading-output`                                                                                                                                 |
| Space    | `--space-1` … `--space-10`, `--space-12`, `--space-16`, where `--space-N` is 2N px                                                                                                                                                                                              |
| Shape    | `--radius-xs` (3px) … `--radius-3xl` (10px), `--radius-round`, `--shadow-overlay`                                                                                                                                                                                               |
| Control  | `--control-height-sm` (20px), `--control-height` (24px), `--control-height-lg` (30px), `--icon-size`, `--icon-size-sm`, `--icon-size-xs`, `--icon-stroke`                                                                                                                       |
| Motion   | `--duration-fast` (hover colours), `--duration-normal` (things appearing), `--ease-out`                                                                                                                                                                                         |
| Layout   | `--titlebar-height`, `--pane-head-height`, `--tab-bar-height`, `--status-height`, `--row-height`, default panel sizes, `--splitter-hit`, `--sheet-width`, `--palette-width`, `--notice-width`, z-index layers                                                                   |

A few compact controls keep odd pixel paddings (3px, 7px, 9px). These are optical adjustments
that belong to the component; layout spacing uses the scale.

## Themes

Colour tokens are roles, not hues. The dark block (`:root, [data-theme='dark']`) and the light
block (`[data-theme='light']`) define the same roles and nothing else. **A new colour token
must be defined in both blocks**, with its contrast checked in both; a token defined only in the
dark block shows dark colours in the light theme. `shell/theme.js` puts the
chosen theme on `<html>` as `data-theme` (Settings > Appearance: Match System, Dark or Light),
tells the window to match, and emits `theme:changed` with `'dark'` or `'light'`.

- **CSS** needs nothing: `var(--color-…)` follows the theme.
- **Code that copies token values** (xterm.js draws its own canvas; CodeMirror themes are built
  in JavaScript) reads them with `token()` from `src/renderer/dom.js` and reads them again on
  `theme:changed`.
- Any element can carry `data-theme` to show a subtree in the other theme; the kitchen-sink
  preview does this to show both side by side.

### Contrast

WCAG contrast ratios for the pairings the interface uses (4.5:1 is the minimum for text, 3:1 for
large text and the edges of controls). Checked whenever a colour token changes.

| Foreground               | Background               | Dark  | Light |
| ------------------------ | ------------------------ | ----- | ----- |
| `--color-text`           | `--color-surface`        | 11.92 | 15.12 |
| `--color-text`           | `--color-surface-raised` | 11.09 | 13.89 |
| `--color-text`           | `--color-surface-hover`  | 9.87  | 12.58 |
| `--color-text-secondary` | `--color-surface-raised` | 9.18  | 9.81  |
| `--color-text-muted`     | `--color-surface`        | 5.64  | 5.47  |
| `--color-text-muted`     | `--color-surface-raised` | 5.25  | 5.03  |
| `--color-text-muted`     | `--color-surface-hover`  | 4.67  | 4.55  |
| `--color-accent`         | `--color-surface`        | 7.49  | 5.42  |
| `--color-accent`         | `--color-surface-raised` | 6.97  | 4.98  |
| `--color-on-accent`      | `--color-accent`         | 7.49  | 5.42  |
| `--color-success`        | `--color-surface`        | 7.75  | 5.33  |
| `--color-success`        | `--color-surface-raised` | 7.21  | 4.90  |
| `--color-danger`         | `--color-surface`        | 5.80  | 5.43  |
| `--color-danger`         | `--color-surface-raised` | 5.40  | 4.99  |
| `--color-warning`        | `--color-surface`        | 9.33  | 5.07  |
| `--color-border-control` | `--color-surface`        | 3.36  | 3.45  |
| `--color-border-control` | `--color-surface-raised` | 3.12  | 3.17  |

The light accent is a deeper amber than the dark one so it still reads as text and carries white
labels on primary buttons.

Code colours on the editor (`--color-surface`) and on code blocks in tutor answers
(`--color-surface-sunken`). Every syntax colour is at least 4.5:1. Line numbers are a guide beside
the text rather than text to read, and are held to 3:1 in the editor.

| Token                      | Dark, editor | Dark, answer code | Light, editor | Light, answer code |
| -------------------------- | ------------ | ----------------- | ------------- | ------------------ |
| `--color-code-keyword`     | 7.88         | 8.31              | 6.59          | 5.93               |
| `--color-code-string`      | 8.74         | 9.21              | 5.84          | 5.26               |
| `--color-code-number`      | 7.71         | 8.13              | 6.08          | 5.48               |
| `--color-code-function`    | 8.15         | 8.59              | 6.47          | 5.83               |
| `--color-code-type`        | 8.41         | 8.87              | 6.01          | 5.41               |
| `--color-code-comment`     | 4.62         | 4.87              | 5.10          | 4.60               |
| `--color-code-punctuation` | 6.28         | 6.63              | 6.80          | 6.12               |
| `--color-code-line-number` | 3.26         | 3.44              | 3.16          | 2.84               |

The terminal's colours on `--color-surface`. All are at least 4.5:1 except ANSI black in the dark
theme (3.5:1), which has to stay a dark grey to read as black, both as text and as a background
behind light text.

| Token                         | Dark  | Light |
| ----------------------------- | ----- | ----- |
| `--color-ansi-black`          | 3.47  | 15.12 |
| `--color-ansi-red`            | 5.80  | 5.98  |
| `--color-ansi-green`          | 7.75  | 5.33  |
| `--color-ansi-yellow`         | 9.33  | 5.80  |
| `--color-ansi-blue`           | 6.75  | 6.71  |
| `--color-ansi-magenta`        | 6.96  | 6.34  |
| `--color-ansi-cyan`           | 8.00  | 5.90  |
| `--color-ansi-white`          | 9.86  | 5.83  |
| `--color-ansi-bright-black`   | 5.64  | 6.01  |
| `--color-ansi-bright-red`     | 7.97  | 4.87  |
| `--color-ansi-bright-green`   | 10.17 | 4.94  |
| `--color-ansi-bright-yellow`  | 11.62 | 4.77  |
| `--color-ansi-bright-blue`    | 9.07  | 5.13  |
| `--color-ansi-bright-magenta` | 9.28  | 5.12  |
| `--color-ansi-bright-cyan`    | 10.48 | 4.94  |
| `--color-ansi-bright-white`   | 16.84 | 8.85  |

## Shared components

These live in [`base.css`](../src/renderer/styles/base.css) and, where they need behaviour, in
`shell/` (exported from `shell/index.js`). Build new interface from them before adding area
styles. `npm run preview -- --scenario kitchen-sink` shows every one in both themes.

- **Buttons.** The default `button` is a raised grey pill for secondary actions (Explain
  selection, Ask tutor). `.primary` is amber, for the one main action in a view. `.ghost` has no
  background until hovered, for actions in pane headers (Find, New, Run all); with
  `aria-pressed="true"` it reads as switched on. `.danger` is a destructive secondary action.
  Add the `.button` class for the design system's sizing (a fixed minimum height, an icon and
  label centred with a gap); a plain `<button>` keeps the size its content gives it, so existing
  rows do not grow. Sizes: `.button.small`, default, `.button.large`. `.button.icon-button` is a
  square button holding one `icon()`;
  give it an `aria-label`.
- **Text input** (`.text-input`). Sunk to `--color-surface` with a 1px border that turns amber on
  focus; `.invalid` turns it red. Padding and radius have defaults; size and font are set per
  use.
- **Select.** The system pop-up menu in the app's colours. **Switch** (`input.switch` with
  `role="switch"`) for on/off settings.
- **List row** (`.list-row`). One clickable line in a list: flex, no wrapping, the hover surface
  on hover, and on `.active` or `aria-selected="true"` for the selected row. Used by the file
  tree, test results, search hits and palette rows.
- **Pane header** (`.pane-head`, or `paneHead()` in `dom.js`). The 30px row at the top of a
  panel: small uppercase muted title, a `spacer()`, then ghost buttons or a select.
  **Section label** (`.section-label`) is the same label inside a view.
- **Empty state** (`.empty-state`, or `emptyState(text)` in `dom.js`). One muted line where a
  list has nothing to show. `.centered` fills its container and centres an optional `<strong>`
  title, the line and an action.
- **Badge** (`.badge`, `.accent`, `.success`, `.danger`). A short count or state beside a label.
  **Status dot** (`.status-dot` with a status class) for connected, failing and so on.
- **Key cap** (`.kbd`, or `kbd('CmdOrCtrl+B')`). Shortcuts are written the way `menu.rs` gives
  them to Tauri; `formatKeys()` draws them for the platform (⇧⌘F on a Mac).
- **Popover and menu** (`.popover` holding `.menu-item` rows, `.menu-separator`, and a
  `.kbd-text` hint inside an item). The highlighted item (`:hover` or `aria-selected="true"`)
  fills with the accent like a native menu.
- **Sheet** (`openSheet({ title, body, footer, className, onClose })`). A modal panel dropping
  from under the title bar over a dimmed window. Escape, the close button or a click outside
  closes it. While it is open the rest of the app is `inert`, so Tab and shortcuts such as ⌘1
  cannot reach behind it. The sheet itself takes focus (no control shows a ring until Tab reaches
  it) and focus returns afterwards. Settings and the shortcut reference are sheets.
- **Palette** (`.palette` holding `.palette-input`, a `.palette-list` of `.palette-row` options,
  the chosen one `.active`, each with an optional `.palette-detail` and `.palette-match` around
  matched characters, then an optional `.palette-note` or `.palette-foot`). A lookup floating at
  the top centre of the window; quick open (`files/quick-open.js`) is one.
- **Tooltip.** Put `data-tip="Text"` on any element; add `data-tip-command="toggle-files"` to show
  that menu command's shortcut beside the text, so it always matches the menu. One floating
  tooltip appears after a short hover or on keyboard focus.
- **Notifications** (`notify({ message, kind, action })`). Messages in the bottom-right corner
  that block nothing: `info` and `success` fade after a few seconds (not while hovered), `error`
  stays until dismissed. `action` is `{ label, run }`. Use them for anything the student must not
  miss; `showStatus` is for passing remarks in the status bar. The corner is a polite live
  region, so screen readers read new messages when idle; errors interrupt. At most four show at
  once: a new one replaces the oldest that would fade anyway, never an error.
- **Spinner and progress** (`.spinner`, `.progress` with a `<span>` whose width is the progress,
  `.progress.indeterminate`).

## Icons

`icon(name, className)` from `shell/index.js` returns an inline SVG from a small set drawn by
[Lucide](https://lucide.dev) (ISC licence, compatible with MIT; the full notice is in THIRD_PARTY_NOTICES.md and a short one in
`shell/icons.js`): plus, x, chevron-right, chevron-down, folder, folder-open, file, search,
settings, check, alert, info, trash, panel-left, panel-bottom, panel-right, play, stop, refresh,
external. They are 16px (`.small` is 14px) with a 1.75 stroke in the text colour. Add one by
copying its shapes from Lucide into `icons.js`; do not mix in another set.

## Motion

`--duration-fast` (100ms) for hover and pressed colours, `--duration-normal` (160ms) for menus,
sheets, notifications and tooltips appearing, always with `--ease-out`. Things fade in and move at
most 6px. When the system asks for reduced motion both durations become zero, so overlays simply
appear; use the tokens rather than fixed times so area animations follow. Spinners and
indeterminate progress bars then fade slowly in place instead of moving, so they still read as
busy.

## Layout

The window is a title bar, three resizable regions (files, the editor over the bottom panel, the
tutor) and a status bar. `shell/layout.js` remembers which panels are open and their sizes. When
the window is too small for every open panel at its minimum beside a 360px editor, the tutor folds
away first, then the files; they return when the window grows. Before a folder is open only the
welcome screen shows.

## Checking your work

`npm run preview -- --out shot.png --scenario <name>` renders the interface against the mock
backend; `--list` shows the scenarios. `kitchen-sink`, `welcome`, `folder-open`, `settings`,
`shortcuts`, `light-theme` and `narrow-window` cover the shell. Add `--theme dark` or
`--theme light` to render any scenario in that theme. Compare against `docs/screenshot.png` and
the other scenarios before and after a visual change, in both themes.
