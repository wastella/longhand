// Extensions other areas add to every open file, such as the language servers' underlines and
// hovers (language/). The editor only knows that they depend on the file's path.

import { Compartment } from '@codemirror/state';

const providers = [];

/** Holds the other areas' extensions, so they can be swapped without losing undo history. */
export const fileExtensionSlot = new Compartment();

/** Registers `provide(path)`, which returns the CodeMirror extension that file should have (or nothing). */
export function addFileExtension(provide) {
  providers.push(provide);
}

/** What the registered providers give the file at `path`. */
export const fileExtensions = (path) => providers.map((provide) => provide(path) || []);
