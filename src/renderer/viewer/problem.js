// The calm state shown in place of a file the viewer cannot show: what happened, in a sentence,
// and a way to look at the file in the Finder instead.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { notify } from '../shell/index.js';
import { formatSize } from '../editor/index.js';
import { nameOf } from './files.js';

const isMac = navigator.platform.startsWith('Mac');

async function reveal(path) {
  try {
    await invoke('fs_reveal', { rel: path });
  } catch (error) {
    notify({ kind: 'error', message: `Could not show ${path} in the Finder: ${error}` });
  }
}

/** The sentence for a problem from readBytes, or for a file that would not draw ({ code: 'unreadable' }). */
function explain(path, { code, size, message }) {
  const name = nameOf(path);
  switch (code) {
    case 'missing':
      return `${name} is no longer in this folder.`;
    case 'tooLarge':
      return `${name} is ${formatSize(size)}, too large to show here. Open it in another app from the Finder.`;
    case 'notFile':
      return `${name} is not a regular file (it may be a pipe or a device), so Longhand leaves it alone.`;
    case 'unreadable':
      return `${name} looks damaged or is in a format Longhand cannot draw.`;
    default:
      return message || `${name} could not be read.`;
  }
}

/** A node saying Longhand cannot show `path`, with Reveal in Finder (unless the file is gone). */
export function problemView(path, problem) {
  return h(
    'div',
    { class: 'viewer-problem', role: 'status' },
    h('h2', {}, 'Longhand cannot show this file'),
    h('p', {}, explain(path, problem)),
    h('p', { class: 'viewer-problem-path' }, path),
    problem.code !== 'missing' &&
      h('button', { type: 'button', class: 'button', onclick: () => reveal(path) }, isMac ? 'Reveal in Finder' : 'Show in File Manager'),
  );
}
