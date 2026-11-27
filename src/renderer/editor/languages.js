import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';

/** The CodeMirror language support for a file, chosen by its extension; none for unknown types. */
export function languageFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'py' || ext === 'pyi') return python();
  if (ext === 'md' || ext === 'markdown') return markdown();
  if (ext === 'json' || ext === 'jsonl' || ext === 'ipynb') return json();
  if (ext === 'yaml' || ext === 'yml') return yaml();
  return [];
}
