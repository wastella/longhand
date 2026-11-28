// The CodeMirror configuration every open file gets, and the editor's key bindings.

import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { fileExtensionSlot, fileExtensions } from './extensions.js';
import { languageSupport } from './languages.js';
import { lineEndingsFor } from './line-endings.js';
import { currentThemeMode, editorTheme, isStale, themeMode } from './theme.js';
import { createSearchPanel, openReplace } from './search-panel.js';
import { goToLinePanel, openGoToLine } from './go-to-line.js';
import { closeNotes, moveToNote, notesFor } from './notes.js';
import { focusSelectionActions, hideSelectionActions, selectionActions } from './selection-actions.js';

/** Holds what depends on the file's name, so a rename can swap it without losing undo history. */
export const languageSlot = new Compartment();

const editorKeymap = [
  // Only here, not as a menu accelerator, so Ctrl+G still reaches the terminal's shell.
  { key: 'Ctrl-g', run: openGoToLine, preventDefault: true },
  { key: 'Mod-Alt-f', run: openReplace, preventDefault: true },
  // Menu accelerators too; bound here for when the key reaches the page first.
  { key: 'Mod-Alt-]', run: (view) => moveToNote(view, 1), preventDefault: true },
  { key: 'Mod-Alt-[', run: (view) => moveToNote(view, -1), preventDefault: true },
  // Editor-only, and only with a selection; Option+Enter types nothing on a Mac.
  { key: 'Alt-Enter', run: focusSelectionActions },
  { key: 'Escape', run: (view) => hideSelectionActions(view) || closeNotes(view) },
  ...closeBracketsKeymap,
  // CodeMirror deletes the line on Shift+Cmd+K, which is the menu's Look Up; the menu keeps it.
  ...defaultKeymap.filter((binding) => binding.key !== 'Shift-Mod-k'),
  // CodeMirror's own go-to-line prompt is replaced by ours on Ctrl+G.
  ...searchKeymap.filter((binding) => binding.key !== 'Mod-Alt-g'),
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  indentWithTab,
];

// A notebook cell's keys: the editor's own editing keys, without what belongs to a whole file
// (find, go to line, notes, folding, the selection actions).
const cellKeymap = [
  ...closeBracketsKeymap,
  ...defaultKeymap.filter((binding) => binding.key !== 'Shift-Mod-k'),
  ...historyKeymap,
  ...completionKeymap,
  indentWithTab,
];

/**
 * A state for a code or Markdown cell in a notebook: the same highlighting, indentation, theme
 * and editing keys as a file of that `language` ('python', 'markdown' or 'text'). `keys` (a CodeMirror
 * keymap) come first, so the notebook can take Shift+Enter and the like; `onUpdate(update)`
 * runs after every change.
 */
export function createCellState(text, { language, keys = [], onUpdate }) {
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      Prec.highest(keymap.of(keys)),
      keymap.of(cellKeymap),
      languageSupport({ python: 'cell.py', markdown: 'cell.md' }[language] || 'cell.txt', text),
      themeMode.of(currentThemeMode()),
      editorTheme,
      EditorView.updateListener.of(onUpdate),
    ],
  });
}

/** Brings a cell's view up to date with the colour theme, after theme:changed. */
export function refreshCellTheme(view) {
  if (isStale(view.state)) view.dispatch({ effects: themeMode.reconfigure(currentThemeMode()) });
}

/**
 * A fresh editor state for the file at `doc.path` (read again whenever it is needed, since a
 * rename changes it). `endings` are the file's line endings (see line-endings.js);
 * `onUpdate(update)` runs after every change to the view.
 */
export function createEditorState(doc, text, { selection, endings, onUpdate }) {
  return EditorState.create({
    doc: text,
    selection,
    extensions: [
      lineEndingsFor(endings),
      lineNumbers(),
      notesFor(doc.path),
      foldGutter({ markerDOM: (open) => Object.assign(document.createElement('span'), { className: 'cm-fold-mark', textContent: open ? '⌄' : '›' }) }),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true, createPanel: createSearchPanel }),
      goToLinePanel,
      selectionActions(() => doc.path),
      keymap.of(editorKeymap),
      languageSlot.of(languageSupport(doc.path, text)),
      fileExtensionSlot.of(fileExtensions(doc.path)),
      themeMode.of(currentThemeMode()),
      editorTheme,
      EditorView.updateListener.of(onUpdate),
    ],
  });
}
