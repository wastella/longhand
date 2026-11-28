// Clone Repository: a sheet that takes a Git address and a place for it, runs the student's own
// git there (clone.rs, which checks the address again), shows its progress, and opens the folder
// it made. Errors stay in the sheet, beside the fields they are about, so the student can fix
// the address and try again. Closing the sheet cancels its clone; another sheet taking its place
// (Settings, say) does not: the clone carries on and says when it is done.

import { invoke, listen } from '../backend.js';
import { h, spacer } from '../dom.js';
import { registerCommand } from './commands.js';
import { openFolder } from './folders.js';
import { notify } from './notify.js';
import { openSheet } from './sheet.js';

const LOCATION_KEY = 'longhand.cloneLocation';

let sheet = null;
let nextId = 0;
const progressListeners = new Map();

/** The folder name a clone of `url` gets by default: its last part, without `.git`. */
export function folderNameFor(url) {
  const path = url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const last = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf(':')) + 1);
  return last.replace(/\.git$/i, '');
}

function storedLocation() {
  try {
    return localStorage.getItem(LOCATION_KEY);
  } catch {
    return null;
  }
}

function storeLocation(path) {
  try {
    localStorage.setItem(LOCATION_KEY, path);
  } catch {
    // Next time starts from the home folder again.
  }
}

function field(label, control, note) {
  return h('label', { class: 'clone-field' }, h('span', { class: 'clone-label' }, label), control, note);
}

/** Opens the Clone Repository sheet (one at a time). */
export async function openCloneSheet() {
  if (sheet) return;
  const url = h('input', {
    class: 'text-input',
    id: 'clone-url',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'https://github.com/user/assignment.git',
  });
  const name = h('input', { class: 'text-input', id: 'clone-name', type: 'text', spellcheck: 'false', autocomplete: 'off' });
  const where = h('span', { class: 'clone-where truncate', id: 'clone-where' });
  const choose = h('button', { type: 'button', class: 'button', id: 'clone-choose' }, 'Choose…');
  const error = h('p', { class: 'clone-error', id: 'clone-error', role: 'alert', hidden: true });
  const bar = h('span');
  const stage = h('span', { class: 'clone-stage', id: 'clone-stage' });
  const progress = h('div', { class: 'clone-progress', hidden: true }, h('div', { class: 'progress indeterminate' }, bar), stage);
  const cancel = h('button', { type: 'button', class: 'button', id: 'clone-cancel' }, 'Cancel');
  const start = h('button', { type: 'button', class: 'button primary', id: 'clone-start' }, 'Clone');
  let location = storedLocation() || (await invoke('clone_location').catch(() => '')) || '';
  let nameEdited = false;
  /** This sheet's clone while it runs (its id), and whether the sheet is still open. */
  let running = null;
  let open = true;

  const showLocation = () => {
    where.textContent = location || 'Choose a folder';
    where.dataset.tip = location;
  };
  /** Says what is wrong, marking and focusing the field it is about. */
  const showError = (message, on) => {
    error.textContent = message || '';
    error.hidden = !message;
    for (const input of [url, name]) input.classList.toggle('invalid', input === on);
    on?.focus();
  };
  const setBusy = (busy) => {
    for (const control of [url, name, choose, start]) control.disabled = busy;
    progress.hidden = !busy;
    start.textContent = busy ? 'Cloning…' : 'Clone';
  };

  url.oninput = () => {
    if (!nameEdited) name.value = folderNameFor(url.value);
    showError(null);
  };
  name.oninput = () => {
    nameEdited = name.value !== '';
    showError(null);
  };
  choose.onclick = async () => {
    const picked = await invoke('clone_choose').catch(() => null);
    if (picked) location = picked;
    showLocation();
  };
  cancel.onclick = () => (running ? invoke('clone_cancel', { id: running }) : sheet?.close());
  const submit = async () => {
    if (running) return;
    if (!url.value.trim()) return showError('Enter the repository’s address.', url);
    if (!name.value.trim()) return showError('Enter a name for the folder.', name);
    if (!location) return showError('Choose where to put the folder.');
    const id = `clone-${++nextId}`;
    running = id;
    showError(null);
    setBusy(true);
    stage.textContent = 'Starting git…';
    bar.parentElement.className = 'progress indeterminate';
    bar.style.width = '';
    progressListeners.set(id, ({ stage: what, percent }) => {
      stage.textContent = `${what}… ${percent}%`;
      bar.parentElement.className = 'progress';
      bar.style.width = `${percent}%`;
    });
    const offerToOpen = (path) => notify({ kind: 'success', message: `Cloned into ${path}`, action: { label: 'Open', run: () => openFolder(path) } });
    try {
      const { path } = await invoke('clone_start', { id, url: url.value.trim(), parent: location, name: name.value.trim() });
      storeLocation(location);
      running = null;
      // Only a clone whose sheet is still open opens its folder; one that carried on behind
      // another sheet says it is done instead.
      if (!open) return offerToOpen(path);
      close();
      if (!(await openFolder(path))) offerToOpen(path);
    } catch (problem) {
      running = null;
      if (open) setBusy(false);
      if (problem?.code === 'cancelled') return;
      if (!open) return notify({ kind: 'error', message: problem?.message || String(problem) });
      const on = { 'invalid-url': url, 'not-found': url, 'invalid-name': name, exists: name }[problem?.code];
      showError(problem?.message || String(problem), on);
    } finally {
      progressListeners.delete(id);
    }
  };
  start.onclick = submit;
  for (const input of [url, name]) input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), submit()));

  showLocation();
  const opened = openSheet({
    title: 'Clone Repository',
    className: 'clone-sheet',
    body: [
      h('p', { class: 'clone-lede' }, 'Copies a Git repository, such as an assignment’s starter code, to your computer with git, then opens it.'),
      field('Repository address', url),
      field('Folder name', name),
      h('div', { class: 'clone-field' }, h('span', { class: 'clone-label' }, 'Location'), h('div', { class: 'clone-location' }, where, choose)),
      error,
      progress,
    ],
    footer: [spacer(), cancel, start],
    onClose: (replaced) => {
      if (running && !replaced) invoke('clone_cancel', { id: running });
      open = false;
      if (sheet === opened) sheet = null;
    },
  });
  sheet = opened;
  const close = () => opened.close();
  url.focus();
}

export function mountClone() {
  registerCommand('clone-repository', openCloneSheet);
  listen('clone:progress', (event) => progressListeners.get(event.id)?.(event));
}
