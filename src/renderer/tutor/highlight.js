// Syntax colours for Python code blocks in tutor answers, from the same parser the editor uses.
// The text is rebuilt as text nodes, so highlighting cannot introduce markup.

import { classHighlighter, highlightCode } from '@lezer/highlight';
import { pythonLanguage } from '@codemirror/lang-python';

const PYTHON = new Set(['python', 'py', 'python3']);

/** Colours every Python code block inside `node`. */
export function highlightBlocks(node) {
  for (const code of node.querySelectorAll('pre > code')) {
    const language = (code.className.match(/language-(\S+)/) || [])[1];
    if (!PYTHON.has(language)) continue;
    const source = code.textContent;
    const out = document.createDocumentFragment();
    highlightCode(
      source,
      pythonLanguage.parser.parse(source),
      classHighlighter,
      (text, classes) => {
        if (!classes) return out.append(text);
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = text;
        out.append(span);
      },
      () => out.append('\n'),
    );
    code.replaceChildren(out);
  }
}
