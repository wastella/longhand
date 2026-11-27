// The resizable layout: showing and hiding the side and bottom panels, and dragging the splitters
// between them. The panels are the root regions in index.html.

import { emit } from '../state.js';
import { registerCommand } from './commands.js';

/** Shows or hides the panel with this id ('files', 'bottom' or 'tutor'). */
function setPanelVisible(id, visible) {
  const panel = document.getElementById(id);
  if (panel.hidden === !visible) return;
  panel.hidden = !visible;
  emit('panel:toggled', { id, visible });
}

export const showPanel = (id) => setPanelVisible(id, true);
const togglePanel = (id) => setPanelVisible(id, document.getElementById(id).hidden);

function setupSplitter(splitter) {
  const target = document.getElementById(splitter.dataset.target);
  const horizontal = splitter.classList.contains('split-h');
  // Panes to the right of or below their splitter grow when it is dragged the other way.
  const sign = splitter.dataset.target === 'files' ? 1 : -1;
  splitter.addEventListener('mousedown', (down) => {
    down.preventDefault();
    const start = horizontal ? down.clientY : down.clientX;
    const size = horizontal ? target.offsetHeight : target.offsetWidth;
    const move = (e) => {
      const delta = ((horizontal ? e.clientY : e.clientX) - start) * sign;
      const next = Math.max(horizontal ? 80 : 160, Math.min(size + delta, horizontal ? window.innerHeight - 200 : 700));
      target.style[horizontal ? 'height' : 'width'] = next + 'px';
    };
    const up = () => (window.removeEventListener('mousemove', move), window.removeEventListener('mouseup', up));
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

export function mountLayout() {
  for (const splitter of document.querySelectorAll('.split-v, .split-h')) setupSplitter(splitter);
  registerCommand('toggle-files', () => togglePanel('files'));
  registerCommand('toggle-bottom', () => togglePanel('bottom'));
  registerCommand('toggle-tutor', () => togglePanel('tutor'));
}
