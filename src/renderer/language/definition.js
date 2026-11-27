// Go to Definition (F12 or ⌘-click) and Go Back (Ctrl+-), which returns to where the last jump
// was made from. Definitions inside the open folder open in the editor like any other file;
// one in a library outside it is only named, because the editor reads nothing outside the folder.

import { EditorView } from '@codemirror/view';
import { LSPPlugin } from '@codemirror/lsp-client';
import { openFile } from '../editor/index.js';
import { showStatus } from '../shell/index.js';
import { filePathOf, pathOf } from './documents.js';

const isMac = /Mac/.test(navigator.platform);
const MAX_TRAIL = 50;
/** Where each jump was made from, oldest first: { path, line, column }, 1-based. */
const trail = [];

/** The first place a definition answer names: a Location, a list of them, or of LocationLinks. */
function firstTarget(answer) {
  const first = [answer].flat()[0];
  const uri = first?.uri ?? first?.targetUri;
  const range = first?.range ?? first?.targetSelectionRange;
  return uri && range ? { uri, line: range.start.line + 1, column: range.start.character + 1 } : null;
}

/**
 * Moves to the definition of the name at `pos` (the cursor by default) in the file on screen.
 * Resolves true if it went somewhere; otherwise the status bar says why not.
 */
export async function goToDefinition(view, pos = view.state.selection.main.head) {
  const plugin = LSPPlugin.get(view);
  if (!plugin || plugin.client.hasCapability('definitionProvider') === false) {
    showStatus('No language server is running for this file, so definitions cannot be looked up.');
    return false;
  }
  const { client, uri } = plugin;
  const { root } = client.workspace;
  const line = view.state.doc.lineAt(pos);
  const origin = { path: pathOf(root, uri), line: line.number, column: pos - line.from + 1 };
  client.sync();
  let target;
  try {
    target = firstTarget(await client.request('textDocument/definition', { textDocument: { uri }, position: plugin.toPosition(pos) }));
  } catch {
    showStatus('The language server did not answer. Try again in a moment.');
    return false;
  }
  if (!target) {
    showStatus('No definition found for this.');
    return false;
  }
  const path = pathOf(root, target.uri);
  if (path == null) {
    const name = filePathOf(target.uri)?.split('/').pop();
    showStatus(`That is defined outside this folder${name ? `, in ${name}` : ''}.`, 6000);
    return false;
  }
  if (path === origin.path && target.line === origin.line) {
    showStatus('This is where it is defined.');
    return false;
  }
  if (!(await openFile(path, target.line, target.column))) return false;
  trail.push(origin);
  if (trail.length > MAX_TRAIL) trail.shift();
  return true;
}

/** Returns to where the last jump was made from. */
export async function goBack() {
  while (trail.length) {
    const { path, line, column } = trail.pop();
    if (await openFile(path, line, column)) return true;
  }
  showStatus('Nowhere to go back to.');
  return false;
}

/** Keeps the way back pointing at a file that was renamed. */
export function trailRenamed(from, to) {
  for (const place of trail) if (place.path === from) place.path = to;
}

/** Forgets the way back, for a newly opened folder. */
export function clearTrail() {
  trail.length = 0;
}

/** ⌘-click (Ctrl-click off the Mac) on a name goes to its definition instead of adding a cursor. */
export const clickToDefinition = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(isMac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    goToDefinition(view, pos);
    return true;
  },
});
