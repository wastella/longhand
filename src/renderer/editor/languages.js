// What each kind of file gets: syntax, indentation, line wrapping and word completion.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { completeAnyWord } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { detectIndent } from './indentation.js';

const extensionOf = (path) => {
  const name = path.split('/').pop();
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
};

const PROSE = new Set(['md', 'markdown', 'txt', 'rst', '']);
const TWO_SPACES = new Set(['json', 'jsonl', 'ipynb', 'yaml', 'yml', 'toml']);

function syntaxFor(ext) {
  if (ext === 'py' || ext === 'pyi') return python();
  if (ext === 'md' || ext === 'markdown') return markdown();
  if (ext === 'json' || ext === 'jsonl' || ext === 'ipynb') return json();
  if (ext === 'yaml' || ext === 'yml') return yaml();
  return [];
}

/**
 * Everything that depends on the kind of file. Python brings its own completion of keywords and
 * the names in the file; other code completes words already in the file; prose completes nothing.
 * Indentation follows the file's existing style, or 4 spaces (2 for data formats) when it has none.
 */
export function languageSupport(path, text) {
  const ext = extensionOf(path);
  const prose = PROSE.has(ext);
  const isPython = ext === 'py' || ext === 'pyi';
  return [
    syntaxFor(ext),
    indentUnit.of(detectIndent(text, TWO_SPACES.has(ext) ? '  ' : '    ')),
    EditorState.tabSize.of(4),
    prose ? EditorView.lineWrapping : [],
    prose || isPython ? [] : EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
  ];
}
