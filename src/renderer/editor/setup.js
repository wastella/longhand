// The CodeMirror configuration every open file gets, and the editor's key bindings.

import { Compartment, EditorState } from '@codemirror/state';
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
import { languageSupport } from './languages.js';
import { currentThemeMode, editorTheme, themeMode } from './theme.js';
import { createSearchPanel, openReplace } from './search-panel.js';
import { goToLinePanel, openGoToLine } from './go-to-line.js';
import { closeNotes, moveToNote, notesFor } from './notes.js';
import { focusSelectionActions, hideSelectionActions, selectionActions } from './selection-actions.js';

/** Holds what depends on the file's name, so a rename can swap it without losing undo history. */
export const languageSlot = new Compartment();

const editorKeymap = [
  { key: 'Ctrl-g', run: openGoToLine, preventDefault: true },
  { key: 'Mod-Alt-f', run: openReplace, preventDefault: true },
  { key: 'Alt-]', run: (view) => moveToNote(view, 1), preventDefault: true },
  { key: 'Alt-[', run: (view) => moveToNote(view, -1), preventDefault: true },
  { key: 'Alt-Enter', run: focusSelectionActions },
  { key: 'Escape', run: (view) => hideSelectionActions(view) || closeNotes(view) },
  ...closeBracketsKeymap,
  ...defaultKeymap,
  // CodeMirror's own go-to-line prompt is replaced by ours on Ctrl+G.
  ...searchKeymap.filter((binding) => binding.key !== 'Mod-Alt-g'),
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  indentWithTab,
];

/**
 * A fresh editor state for the file at `doc.path` (read again whenever it is needed, since a
 * rename changes it). `onUpdate(update)` runs after every change to the view.
 */
export function createEditorState(doc, text, { selection, onUpdate }) {
  return EditorState.create({
    doc: text,
    selection,
    extensions: [
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
      themeMode.of(currentThemeMode()),
      editorTheme,
      EditorView.updateListener.of(onUpdate),
    ],
  });
}
