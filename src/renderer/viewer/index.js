// The viewer: read-only views of files the editor does not edit (PDFs and pictures, in editor
// tabs), Markdown rendered for reading, and the handout pane that shows an assignment's handout
// beside the code. Other areas import from this file only.

import { mountHandout } from './handout.js';

export { canBeHandout, isMarkdown, viewKind } from './files.js';
export { openAsHandout, currentHandout } from './handout.js';
export { showFile } from './view.js';

export function mount(region) {
  mountHandout(region);
}
