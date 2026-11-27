// Syntax colours for Python code blocks in tutor answers, from the same parser the editor uses
// and the same tag groups as its theme (editor/theme.js), drawn with the editor's --color-code-*
// tokens (tutor.css), so code looks the same in both places. The text is rebuilt as text nodes,
// so highlighting cannot introduce markup.

import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';
import { pythonLanguage } from '@codemirror/lang-python';

const PYTHON = new Set(['python', 'py', 'python3']);

// Kept in step with the HighlightStyle in editor/theme.js.
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], class: 'code-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'code-string' },
  { tag: [t.number, t.bool, t.null, t.atom, t.self], class: 'code-number' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], class: 'code-function' },
  { tag: [t.className, t.typeName, t.definition(t.className), t.namespace], class: 'code-type' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'code-comment' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.meta, t.annotation, t.processingInstruction], class: 'code-punctuation' },
]);

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
      highlighter,
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
