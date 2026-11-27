// The inline field that names new and renamed items, in the tree where the item will appear.
// It checks the name as the student types and keeps any error from the backend in view.

import { h } from '../dom.js';
import { showPanel } from '../shell/index.js';
import { cachedListing } from './listing.js';
import { showView, treeView } from './panel.js';
import { focusRow, holdPainting, indent, renderTree, rowElement, setExpanded } from './tree.js';

/**
 * What is wrong with `value` as a path inside a folder holding `siblings`, or null.
 * `original` is the path being renamed, which may keep its name or change only its case.
 */
export function problemWith(value, siblings, original) {
  if (!value) return 'Type a name.';
  if (/^\s|\s$/.test(value)) return 'Names cannot start or end with a space.';
  if (/[\\:]/.test(value)) return 'Names cannot contain \\ or :.';
  if (/[\x00-\x1f\x7f]/.test(value)) return 'Names cannot contain control characters.';
  if (value.startsWith('/')) return 'Names cannot start with /.';
  if (value.endsWith('/')) return 'Names cannot end with /.';
  const parts = value.split('/');
  if (parts.includes('')) return 'Two slashes in a row leave a name empty.';
  if (parts.some((p) => p === '.' || p === '..')) return '“.” and “..” cannot be used as names.';
  if (parts.some((p) => p.length > 255)) return 'That name is too long.';
  const first = parts[0].toLowerCase();
  const clash = siblings.find((e) => e.name.toLowerCase() === first && e.path !== original);
  // "pkg/new.py" is fine when pkg is a folder: the new file goes inside it.
  if (clash && (parts.length === 1 || !clash.dir)) return `${clash.dir ? 'A folder' : 'A file'} named “${clash.name}” is already here.`;
  return null;
}

let cancelOpen = null;

/**
 * Asks for a name inside `dir` (at tree depth `depth`), starting from `initial` with
 * `[start, end]` selected. A rename passes `replacing`, the path whose row the field takes over.
 * Enter calls `commit(path)`, where path is `dir/name`; if it throws, the field stays open with
 * the message. Resolves with the committed path, or null if the student cancelled.
 */
export async function askForName({ dir, depth, initial = '', select = [0, 0], replacing = null, placeholder = 'name', commit }) {
  cancelOpen?.();
  showPanel('files');
  showView('tree');
  if (dir) setExpanded(dir, true);
  await renderTree();
  holdPainting(true);

  const input = h('input', { class: 'new-name text-input', placeholder, spellcheck: 'false', 'aria-label': placeholder });
  const message = h('div', { class: 'name-problem', role: 'alert' });
  const row = h('div', { class: 'naming-row' }, input, message);
  row.style.paddingLeft = `calc(${indent(depth)} + var(--space-7))`;
  input.value = initial;

  const replaced = replacing && rowElement(replacing);
  const parentRow = dir && rowElement(dir);
  if (replaced) replaced.replaceWith(row);
  else if (parentRow) parentRow.after(row);
  else if (treeView.querySelector('.tree-empty')) treeView.replaceChildren(row);
  else treeView.prepend(row);
  input.focus();
  input.setSelectionRange(...select);
  row.scrollIntoView({ block: 'nearest' });

  const pathFor = (name) => (dir ? `${dir}/${name}` : name);
  const check = () => problemWith(input.value, cachedListing(dir) || [], replacing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (path) => {
      if (settled) return;
      settled = true;
      cancelOpen = null;
      row.remove();
      holdPainting(false);
      if (replacing) focusRow(path || replacing);
      treeView.focus();
      resolve(path);
    };
    cancelOpen = () => finish(null);
    const show = (text) => {
      message.textContent = text || '';
      row.classList.toggle('invalid', !!text);
    };

    const submit = async () => {
      if (settled || input.readOnly) return;
      if (replacing && input.value === initial) return finish(null);
      const problem = check();
      if (problem) return show(problem);
      const path = pathFor(input.value);
      input.readOnly = true;
      try {
        await commit(path);
        finish(path);
      } catch (e) {
        input.readOnly = false;
        show(String(e));
      }
    };

    input.oninput = () => show(input.value ? check() : '');
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // Otherwise the Enter would carry on into the file this opens, as a stray new line.
      e.preventDefault();
      if (e.key === 'Enter') submit();
      else finish(null);
    };
    input.onblur = () => {
      // Switching to another app keeps the field; clicking elsewhere in Longhand settles it.
      if (settled || input.readOnly || !document.hasFocus()) return;
      if (!input.value || (replacing && input.value === initial) || check()) finish(null);
      else submit();
    };
  });
}
