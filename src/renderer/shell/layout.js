// The layout: which panels are open, their sizes, and fitting them into the window.
//
// The student's choices (open or closed, and size) are remembered across launches. What is shown
// can differ: when the window is too small for every open panel at its minimum beside an editor
// of usable size, panels fold away, the tutor first and then the files, and come back when the
// window grows. Showing a folded panel explicitly makes it the last to fold. Before a folder is
// open there is nothing for the panels to show, so only the welcome screen is shown.

import { invoke } from '../backend.js';
import { emit, on } from '../state.js';
import { registerCommand } from './commands.js';
import { setupSplitter } from './splitter.js';

const PANELS = ['files', 'bottom', 'tutor'];
export const DEFAULT_SIZES = { files: 220, bottom: 240, tutor: 400 };
export const MIN_SIZES = { files: 160, bottom: 100, tutor: 280 };
export const MAX_SIZES = { files: 640, bottom: 1200, tutor: 640 };
const EDITOR_MIN_WIDTH = 360;
const EDITOR_MIN_HEIGHT = 140;
const SAVE_DELAY = 400;

/** The student's choices: { files: { open, size }, bottom: …, tutor: … }. */
const layout = Object.fromEntries(PANELS.map((id) => [id, { open: true, size: DEFAULT_SIZES[id] }]));
/** The side panels in the order they fold when space runs out. */
let foldOrder = ['tutor', 'files'];
let saveTimer;
let folderOpen = false;

const panel = (id) => document.getElementById(id);
const splitterFor = (id) => document.querySelector(`[data-target="${id}"]`);

/** Whether the panel `id` is on screen now. */
export const isPanelShown = (id) => !panel(id).hidden;

function show(id, visible, size) {
  const element = panel(id);
  element.style[id === 'bottom' ? 'height' : 'width'] = `${Math.round(size)}px`;
  splitterFor(id).hidden = !visible;
  splitterFor(id).setAttribute('aria-valuenow', String(Math.round(size)));
  if (element.hidden === !visible) return;
  element.hidden = !visible;
  emit('panel:toggled', { id, visible });
}

/** Works out what fits in the window and shows it. */
export function fitLayout() {
  const app = document.getElementById('app');
  const width = app.clientWidth;
  const height = app.clientHeight;

  const shown = { files: folderOpen && layout.files.open, tutor: folderOpen && layout.tutor.open };
  const needed = () => EDITOR_MIN_WIDTH + (shown.files ? MIN_SIZES.files : 0) + (shown.tutor ? MIN_SIZES.tutor : 0);
  for (const id of foldOrder) if (needed() > width) shown[id] = false;

  // Shown panels give up width in proportion to how far each is above its minimum.
  const sides = ['files', 'tutor'].filter((id) => shown[id]);
  const sizes = Object.fromEntries(sides.map((id) => [id, layout[id].size]));
  const over = EDITOR_MIN_WIDTH + sides.reduce((sum, id) => sum + sizes[id], 0) - width;
  const slack = sides.reduce((sum, id) => sum + sizes[id] - MIN_SIZES[id], 0);
  if (over > 0 && slack > 0) for (const id of sides) sizes[id] -= (over * (sizes[id] - MIN_SIZES[id])) / slack;
  for (const id of ['files', 'tutor']) show(id, shown[id], sizes[id] ?? layout[id].size);

  const room = height - EDITOR_MIN_HEIGHT;
  show('bottom', folderOpen && layout.bottom.open && room >= MIN_SIZES.bottom, Math.min(layout.bottom.size, room));
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('layout_save', { layout: { panels: layout, foldOrder } }).catch(() => {}), SAVE_DELAY);
}

/** Opens or closes a panel by the student's choice, and remembers it. */
function setOpen(id, open) {
  layout[id].open = open;
  if (open && foldOrder.includes(id)) foldOrder = [...foldOrder.filter((other) => other !== id), id];
  fitLayout();
  save();
}

/** Opens the panel with this id ('files', 'bottom' or 'tutor'). */
export const showPanel = (id) => isPanelShown(id) || setOpen(id, true);
const togglePanel = (id) => folderOpen && setOpen(id, !isPanelShown(id));

/** The largest size panel `id` can take now while the editor keeps its minimum. */
function maxSize(id) {
  const app = document.getElementById('app');
  if (id === 'bottom') return Math.min(MAX_SIZES.bottom, app.clientHeight - EDITOR_MIN_HEIGHT);
  const other = id === 'files' ? 'tutor' : 'files';
  const otherWidth = isPanelShown(other) ? panel(other).offsetWidth : 0;
  return Math.min(MAX_SIZES[id], app.clientWidth - EDITOR_MIN_WIDTH - otherWidth);
}

/** Sets the size of panel `id`, kept between its minimum and what fits; null resets it. */
function resize(id, size) {
  const wanted = size ?? DEFAULT_SIZES[id];
  layout[id].size = Math.round(Math.max(MIN_SIZES[id], Math.min(wanted, maxSize(id))));
  fitLayout();
  save();
  return layout[id].size;
}

/** Applies the layout saved at the last launch, ignoring anything malformed in it. */
export function restoreLayout(saved) {
  for (const id of PANELS) {
    const choice = saved?.panels?.[id];
    if (typeof choice?.open === 'boolean') layout[id].open = choice.open;
    if (Number.isFinite(choice?.size)) layout[id].size = Math.round(Math.min(MAX_SIZES[id], Math.max(MIN_SIZES[id], choice.size)));
  }
  const order = saved?.foldOrder;
  if (Array.isArray(order) && order.length === 2 && order.includes('files') && order.includes('tutor')) foldOrder = [...order];
  fitLayout();
}

export function mountLayout() {
  for (const id of PANELS) {
    const limits = { min: MIN_SIZES[id], max: MAX_SIZES[id] };
    setupSplitter(splitterFor(id), { id, limits, size: () => panel(id)[id === 'bottom' ? 'offsetHeight' : 'offsetWidth'], resize });
  }
  let frame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitLayout);
  });
  on('workspace:opened', () => {
    folderOpen = true;
    fitLayout();
  });
  registerCommand('toggle-files', () => togglePanel('files'));
  registerCommand('toggle-bottom', () => togglePanel('bottom'));
  registerCommand('toggle-tutor', () => togglePanel('tutor'));
  fitLayout();
}
