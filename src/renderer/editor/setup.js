// The CodeMirror configuration every open file gets.

import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { languageFor } from './languages.js';

// One Dark supplies the syntax colours; the surfaces come from the design tokens so the editor
// sits on the same background as the panes around it.
const surfaces = EditorView.theme(
  { '&': { backgroundColor: 'var(--color-surface)' }, '.cm-gutters': { backgroundColor: 'var(--color-surface)', border: 'none' } },
  { dark: true },
);

/** A fresh editor state for `path`. `onEdit` runs when the text changes, `onCursor` when the text or selection does. */
export function createEditorState(path, text, { onEdit, onCursor }) {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      languageFor(path),
      oneDark,
      surfaces,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onEdit();
        if (update.selectionSet || update.docChanged) onCursor();
      }),
    ],
  });
}
