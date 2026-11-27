// The editor's look, built from the design tokens in styles/tokens.css. Every colour is a var(),
// so a theme that redefines the tokens restyles the editor without rebuilding anything; only
// CodeMirror's own light/dark switch (which picks its defaults for anything not set here) has to
// be reconfigured when the theme changes.

import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const v = (name) => `var(--${name})`;
const selection = { backgroundColor: v('color-selection') };

const chrome = EditorView.theme({
  '&': { height: '100%', color: v('color-text'), backgroundColor: v('color-surface'), fontSize: v('code-size') },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: v('font-mono'), lineHeight: v('leading-reading') },
  '.cm-content': { caretColor: v('color-text') },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: v('color-text') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': selection,
  '.cm-selectionBackground, .cm-content ::selection': selection,
  '.cm-activeLine': { backgroundColor: v('color-code-active-line') },
  '.cm-gutters': { backgroundColor: v('color-surface'), color: v('color-code-line-number'), border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: `0 ${v('space-2')} 0 ${v('space-6')}` },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('color-text-muted') },
  '.cm-foldGutter .cm-gutterElement': { color: v('color-text-muted'), padding: `0 ${v('space-1')}` },
  '.cm-foldPlaceholder': { backgroundColor: v('color-surface-hover'), border: 'none', color: v('color-text-muted'), padding: `0 ${v('space-2')}` },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': { backgroundColor: v('color-code-bracket'), color: 'inherit' },
  '&.cm-focused .cm-nonmatchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'transparent', color: v('color-danger') },
  '.cm-selectionMatch': { backgroundColor: v('color-code-selection-match') },
  '.cm-searchMatch': { backgroundColor: v('color-code-match'), outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: v('color-code-match-current') },
  '.cm-panels': { backgroundColor: v('color-surface-raised'), color: v('color-text') },
  '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${v('color-border')}` },
  '.cm-tooltip': {
    backgroundColor: v('color-surface-raised'),
    color: v('color-text'),
    border: `1px solid ${v('color-border-overlay')}`,
    borderRadius: v('radius-lg'),
    boxShadow: v('shadow-overlay'),
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: v('font-mono'), maxHeight: '16em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: `${v('space-1')} ${v('space-4')}` },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: v('color-surface-hover'), color: v('color-text-strong') },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionDetail': { color: v('color-text-muted'), fontStyle: 'normal' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: v('color-accent') },
  '.cm-specialChar': { color: v('color-danger') },
});

const code = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: v('color-code-keyword') },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: v('color-code-string') },
  { tag: [t.number, t.bool, t.null, t.atom, t.self], color: v('color-code-number') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: v('color-code-function') },
  { tag: [t.className, t.typeName, t.definition(t.className), t.namespace], color: v('color-code-type') },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('color-code-comment'), fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.meta, t.annotation, t.processingInstruction], color: v('color-code-punctuation') },
  { tag: [t.propertyName, t.attributeName], color: v('color-text') },
  { tag: t.heading, color: v('color-text-strong'), fontWeight: v('weight-strong') },
  { tag: t.strong, fontWeight: v('weight-strong') },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: v('color-accent') },
  { tag: [t.monospace, t.quote], color: v('color-code-string') },
  { tag: t.invalid, color: v('color-danger') },
]);

/** The editor's chrome and syntax colours. */
export const editorTheme = [chrome, syntaxHighlighting(code)];

/** Holds CodeMirror's light/dark switch, reconfigured when the colour theme changes. */
export const themeMode = new Compartment();

let mode = 'dark';

/** The light/dark switch for the current theme. */
export const currentThemeMode = () => EditorView.darkTheme.of(mode !== 'light');

/** Records the new theme ('dark' or 'light'); returns false when nothing changed. */
export function setThemeMode(next) {
  if (next === mode) return false;
  mode = next;
  return true;
}

/** Whether `state` was created or last reconfigured for an older theme. */
export const isStale = (state) => state.facet(EditorView.darkTheme) !== (mode !== 'light');
