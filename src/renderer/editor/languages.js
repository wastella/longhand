// What each kind of file gets: syntax, indentation, line wrapping and word completion.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { completeAnyWord } from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { detectIndent } from './indentation.js';

const extensionOf = (path) => {
  const name = path.split('/').pop();
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
};

const PROSE = new Set(['md', 'markdown', 'txt', 'rst', '']);
const C_FAMILY = new Set(['c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx']);
const JAVASCRIPT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx']);
const TWO_SPACES = new Set(['json', 'jsonl', 'ipynb', 'yaml', 'yml', 'toml', ...JAVASCRIPT]);
// gofmt indents with tabs, and the Go tools rewrite anything else.
const TABS = new Set(['go']);

function syntaxFor(ext) {
  if (ext === 'py' || ext === 'pyi') return python();
  if (C_FAMILY.has(ext)) return cpp();
  if (ext === 'java') return java();
  if (JAVASCRIPT.has(ext)) return javascript({ jsx: ext.endsWith('x'), typescript: ext.includes('ts') });
  if (ext === 'rs') return rust();
  if (ext === 'go') return go();
  if (ext === 'md' || ext === 'markdown') return markdown();
  if (ext === 'json' || ext === 'jsonl' || ext === 'ipynb') return json();
  if (ext === 'yaml' || ext === 'yml') return yaml();
  return [];
}

/**
 * Everything that depends on the kind of file. Python, JavaScript and Go bring their own
 * completion of keywords and the names in the file; other code completes words already in the
 * file; prose completes nothing. A running language server's completion replaces these (language/).
 * Indentation follows the file's existing style, or 4 spaces (2 for data formats, JavaScript and
 * TypeScript; a tab for Go) when it has none.
 */
export function languageSupport(path, text) {
  const ext = extensionOf(path);
  const prose = PROSE.has(ext);
  // These complete their keywords and the names in the file themselves.
  const ownCompletion = ext === 'py' || ext === 'pyi' || ext === 'go' || JAVASCRIPT.has(ext);
  return [
    syntaxFor(ext),
    indentUnit.of(detectIndent(text, TABS.has(ext) ? '\t' : TWO_SPACES.has(ext) ? '  ' : '    ')),
    EditorState.tabSize.of(4),
    prose ? EditorView.lineWrapping : [],
    prose || ownCompletion ? [] : EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
  ];
}
