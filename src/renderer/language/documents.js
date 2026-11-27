// What one language server knows of the editor's open files. The server is told about every
// open file of its languages, on screen or not, and always sees the text as the editor holds
// it, unsaved edits included.
//
// The client library expects one editor per file, each with its own plugin that tracks changes.
// Longhand has one editor showing whichever tab is in front, so its plugin comes and goes with
// the tab. A file's changes are therefore found by comparing the text the server last got with
// the text the editor has now; the plugin's own record is used when it covers the same ground.

import { ChangeSet } from '@codemirror/state';
import { LSPPlugin, Workspace } from '@codemirror/lsp-client';
import { fileState, fileView } from '../editor/index.js';

/** The file: URI of an absolute path. */
export const fileUri = (absolute) => 'file://' + absolute.split('/').map(encodeURIComponent).join('/');

/** The file: URI of `path`, which is relative to the folder at `root`. */
export const uriOf = (root, path) => fileUri(`${root}/${path}`);

/** The path inside the folder at `root` that `uri` names, or null when it is somewhere else. */
export function pathOf(root, uri) {
  const file = filePathOf(uri);
  return file?.startsWith(root + '/') ? file.slice(root.length + 1) : null;
}

/** The absolute path a file: URI names, or null. Servers escape characters differently, so URIs are compared as paths. */
export function filePathOf(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}

/** The single replacement that turns `before` into `after`. */
function difference(before, after) {
  const a = before.toString();
  const b = after.toString();
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return ChangeSet.of({ from: start, to: a.length - end, insert: b.slice(start, b.length - end) }, a.length);
}

/** An open file as the server knows it: `doc` is the text it was last sent, as `version`. */
class OpenFile {
  constructor(path, uri, languageId, doc) {
    Object.assign(this, { path, uri, languageId, doc, version: 1 });
  }

  getView() {
    return fileView(this.path);
  }

  /** The changes the editor has made that the server has not been sent, or null when there are none. */
  unsent() {
    const now = fileState(this.path)?.doc;
    return !now || now === this.doc || now.eq(this.doc) ? null : difference(this.doc, now);
  }
}

export class Documents extends Workspace {
  files = [];
  /** Whether the server has answered its start-up, and so can be told about files. */
  ready = false;

  /** `root` is the open folder; `files` are the open ones this server reads: [{ path, languageId }]. */
  constructor(client, root, files) {
    super(client);
    this.root = root;
    for (const file of files) this.add(file.path, file.languageId);
  }

  add(path, languageId) {
    const state = fileState(path);
    if (!state || this.fileAt(path)) return null;
    const file = new OpenFile(path, uriOf(this.root, path), languageId, state.doc);
    this.files.push(file);
    return file;
  }

  fileAt(path) {
    return this.files.find((file) => file.path === path) || null;
  }

  getFile(uri) {
    const path = pathOf(this.root, uri);
    return path == null ? null : this.fileAt(path);
  }

  // The library would open the files as soon as it connects, queued behind a start-up that may
  // never finish. The server is told once it has answered instead (servers.js calls `announce`).
  connected() {}

  /** The server is ready: opens every file for it. */
  announce() {
    this.ready = true;
    for (const file of this.files) this.client.didOpen(file);
  }

  /** A file of this server's languages was opened in a tab. */
  opened(path, languageId) {
    const file = this.add(path, languageId);
    if (file && this.ready) this.client.didOpen(file);
  }

  /** Its tab closed. */
  closed(path) {
    const file = this.fileAt(path);
    if (!file) return;
    this.files = this.files.filter((other) => other !== file);
    if (this.ready) this.client.didClose(file.uri);
  }

  syncFiles() {
    const updates = [];
    for (const file of this.files) {
      const now = fileState(file.path)?.doc;
      if (!now || now === file.doc || now.eq(file.doc)) continue;
      const view = file.getView();
      const plugin = view && LSPPlugin.get(view);
      const tracked = plugin?.uri === file.uri && plugin.syncedDoc === file.doc;
      updates.push({ file, prevDoc: file.doc, changes: tracked ? plugin.unsyncedChanges : difference(file.doc, now) });
      file.doc = now;
      file.version += 1;
      if (plugin?.uri === file.uri) plugin.clear();
    }
    return updates;
  }

  // The library calls these two as the editor's plugin comes and goes with the tab in front;
  // files are opened and closed for the server by `opened` and `closed` instead.
  openFile() {}
  closeFile() {}
}
