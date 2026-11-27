// What the editor says when something needs the student: a banner above the code when a file
// needs a decision (it changed on disk, it was deleted, it could not be saved), and a notice in
// place of the code for a file the editor will not open (binary, too large, not UTF-8).

import { h } from '../dom.js';

const nameOf = (path) => path.split('/').pop();

/** "1.4 GB", "820 KB": a file size the way Finder shows it. */
export function formatSize(bytes) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) ((size /= 1000), unit++);
  return unit === 0 ? `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}` : `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

/**
 * The banner for `doc.banner`, one of:
 *   { kind: 'changed' }            the file changed on disk while it had unsaved edits
 *   { kind: 'deleted' }            the file was deleted on disk while it had unsaved edits
 *   { kind: 'save-failed', message }
 * `actions` holds the handlers: keepMine, loadTheirs, saveAgain, discard, retry, dismiss.
 */
export function renderBanner(host, doc, actions) {
  host.hidden = !doc?.banner;
  if (!doc?.banner) return host.replaceChildren();
  const name = nameOf(doc.path);
  const button = (label, run) => h('button', { type: 'button', onclick: run }, label);
  const content = {
    changed: [
      [h('strong', {}, `${name} changed on disk`), ' while you had unsaved changes here.'],
      [button('Keep my version', actions.keepMine), button('Load the disk version', actions.loadTheirs)],
    ],
    deleted: [
      [h('strong', {}, `${name} was deleted on disk.`), ' Your unsaved version is still open here.'],
      [button('Save it again', actions.saveAgain), button('Close without saving', actions.discard)],
    ],
    'save-failed': [
      [h('strong', {}, `${name} was not saved.`), ` ${doc.banner.message} Your changes are still here.`],
      [button('Try again', actions.retry), button('Dismiss', actions.dismiss)],
    ],
  }[doc.banner.kind];
  host.replaceChildren(
    h('span', { class: 'banner-mark', 'aria-hidden': 'true' }),
    h('p', { class: 'banner-text' }, content[0]),
    h('div', { class: 'banner-actions' }, content[1]),
  );
}

/** The notice shown instead of the editor for `doc.notice`: { kind, size?, message? }. */
export function renderFileNotice(host, doc, { onClose }) {
  const name = nameOf(doc.path);
  const { kind, size } = doc.notice;
  const [title, detail] = {
    binary: [
      `${name} is not a text file`,
      `It holds ${formatSize(size)} of binary data, such as a dataset or a model checkpoint. Load it from Python instead.`,
    ],
    tooLarge: [
      `${name} is too large to edit here`,
      `It is ${formatSize(size)}. Longhand opens text files up to 3 MB so the editor stays responsive. To look inside, try head or less in the terminal.`,
    ],
    notText: [`${name} is not UTF-8 text`, 'Saving it from here could change its contents, so Longhand leaves it alone.'],
    error: [`${name} could not be opened`, doc.notice.message],
  }[kind];
  host.replaceChildren(
    h('h2', {}, title),
    h('p', {}, detail),
    h('p', { class: 'notice-path' }, doc.path),
    h('button', { type: 'button', onclick: onClose }, 'Close tab'),
  );
}
