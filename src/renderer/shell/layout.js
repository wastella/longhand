// The layout: which panels are open, their sizes, and fitting them into the window.
//
// The student's choices (open or closed, and size) are remembered across launches. What is shown
// can differ: when the window is too small for every open panel at its minimum beside an editor
// of usable size, panels fold away, the tutor first and then the files, and come back when the
// window grows. Showing a folded panel explicitly makes it the last to fold. Before a folder is
// open there is nothing for the panels to show, so only the welcome screen is shown.
//
// The handout (viewer/) sits between the editor and the tutor. Whether it is open, and its width,
// belong to the folder, so the viewer area sets them (setPanel) and they are not saved here. The
// handout and the tutor both need room to read, and the code room to write: with both shown, the
// editor keeps a comfortable width and the handout gives up width first, down to its minimum;
// only when that is not enough does the one earlier in the fold order fold.

import { invoke } from '../backend.js';
import { emit, on } from '../state.js';
import { registerCommand } from './commands.js';
import { setupSplitter } from './splitter.js';

const PANELS = ['files', 'bottom', 'handout', 'tutor'];
const SIDES = ['files', 'handout', 'tutor'];
/** Panels whose choices are kept per folder by another area, not in the saved layout. */
const PER_FOLDER = ['handout'];
export const DEFAULT_SIZES = { files: 220, bottom: 240, handout: 420, tutor: 400 };
export const MIN_SIZES = { files: 160, bottom: 100, handout: 300, tutor: 280 };
export const MAX_SIZES = { files: 640, bottom: 1200, handout: 960, tutor: 640 };
const EDITOR_MIN_WIDTH = 360;
const EDITOR_COMFORT_WIDTH = 480;
const EDITOR_MIN_HEIGHT = 140;
const SPLITTER_WIDTH = 1;
const SAVE_DELAY = 400;

/** The student's choices: { files: { open, size }, bottom: …, tutor: … }. */
const layout = Object.fromEntries(PANELS.map((id) => [id, { open: !PER_FOLDER.includes(id), size: DEFAULT_SIZES[id] }]));
/** The side panels in the order they fold when space runs out. */
let foldOrder = ['tutor', 'files', 'handout'];
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
  // Room for the editor and the side panels, less a splitter beside each side panel.
  const width = app.clientWidth - SIDES.length * SPLITTER_WIDTH;
  const height = app.clientHeight;

  const shown = Object.fromEntries(SIDES.map((id) => [id, folderOpen && layout[id].open]));
  const total = (sizes) => SIDES.reduce((sum, id) => sum + (shown[id] ? sizes[id] : 0), 0);
  const wanted = Object.fromEntries(SIDES.map((id) => [id, layout[id].size]));
  if (shown.handout && shown.tutor && EDITOR_COMFORT_WIDTH + total({ ...wanted, handout: MIN_SIZES.handout }) > width)
    shown[foldOrder.find((id) => id === 'handout' || id === 'tutor')] = false;
  for (const id of foldOrder) if (EDITOR_MIN_WIDTH + total(MIN_SIZES) > width) shown[id] = false;

  const sides = SIDES.filter((id) => shown[id]);
  const sizes = Object.fromEntries(sides.map((id) => [id, layout[id].size]));
  const both = shown.handout && shown.tutor;
  let over = (both ? EDITOR_COMFORT_WIDTH : EDITOR_MIN_WIDTH) + sides.reduce((sum, id) => sum + sizes[id], 0) - width;
  // Beside the tutor, the handout gives up width first; then shown panels give up width in
  // proportion to how far each is above its minimum.
  if (both && over > 0) {
    const given = Math.min(over, sizes.handout - MIN_SIZES.handout);
    sizes.handout -= given;
    over -= given;
  }
  const slack = sides.reduce((sum, id) => sum + sizes[id] - MIN_SIZES[id], 0);
  if (over > 0 && slack > 0) for (const id of sides) sizes[id] -= (over * (sizes[id] - MIN_SIZES[id])) / slack;
  for (const id of SIDES) show(id, shown[id], sizes[id] ?? layout[id].size);

  const room = height - EDITOR_MIN_HEIGHT;
  show('bottom', folderOpen && layout.bottom.open && room >= MIN_SIZES.bottom, Math.min(layout.bottom.size, room));
}

function save() {
  clearTimeout(saveTimer);
  const panels = Object.fromEntries(PANELS.filter((id) => !PER_FOLDER.includes(id)).map((id) => [id, layout[id]]));
  saveTimer = setTimeout(() => invoke('layout_save', { layout: { panels, foldOrder } }).catch(() => {}), SAVE_DELAY);
}

/** Opens or closes a panel by the student's choice, and remembers it. */
function setOpen(id, open) {
  layout[id].open = open;
  if (open && foldOrder.includes(id)) foldOrder = [...foldOrder.filter((other) => other !== id), id];
  fitLayout();
  save();
}

/** Opens the panel with this id ('files', 'bottom', 'handout' or 'tutor'). */
export const showPanel = (id) => isPanelShown(id) || setOpen(id, true);
/** Closes the panel with this id, by the student's choice. */
export const hidePanel = (id) => setOpen(id, false);
const togglePanel = (id) => folderOpen && setOpen(id, !isPanelShown(id));

/**
 * Applies choices another area keeps for a panel (the handout's, per folder): { open, size }.
 * They are not saved with the layout.
 */
export function setPanel(id, { open, size }) {
  layout[id].open = open;
  if (Number.isFinite(size)) layout[id].size = Math.round(Math.min(MAX_SIZES[id], Math.max(MIN_SIZES[id], size)));
  fitLayout();
}

/** The largest size panel `id` can take now while the editor keeps its minimum. */
function maxSize(id) {
  const app = document.getElementById('app');
  if (id === 'bottom') return Math.min(MAX_SIZES.bottom, app.clientHeight - EDITOR_MIN_HEIGHT);
  const others = SIDES.filter((other) => other !== id && isPanelShown(other)).reduce((sum, other) => sum + panel(other).offsetWidth, 0);
  return Math.min(MAX_SIZES[id], app.clientWidth - EDITOR_MIN_WIDTH - others);
}

/** Sets the size of panel `id`, kept between its minimum and what fits; null resets it. */
function resize(id, size) {
  const wanted = size ?? DEFAULT_SIZES[id];
  layout[id].size = Math.round(Math.max(MIN_SIZES[id], Math.min(wanted, maxSize(id))));
  fitLayout();
  save();
  emit('panel:resized', { id, size: layout[id].size });
  return layout[id].size;
}

/** Applies the layout saved at the last launch, ignoring anything malformed in it. */
export function restoreLayout(saved) {
  for (const id of PANELS.filter((id) => !PER_FOLDER.includes(id))) {
    const choice = saved?.panels?.[id];
    if (typeof choice?.open === 'boolean') layout[id].open = choice.open;
    if (Number.isFinite(choice?.size)) layout[id].size = Math.round(Math.min(MAX_SIZES[id], Math.max(MIN_SIZES[id], choice.size)));
  }
  // Layouts saved before the handout existed name only the files and the tutor.
  const order = saved?.foldOrder;
  const known = Array.isArray(order) && order.every((id) => SIDES.includes(id)) && new Set(order).size === order.length;
  if (known && order.includes('files') && order.includes('tutor')) foldOrder = order.includes('handout') ? [...order] : [...order, 'handout'];
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
