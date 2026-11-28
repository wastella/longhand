// A splitter between two regions: drag it, double-click it to reset the panel's size, or focus it
// with Tab and use the arrow keys. Its line is 1px; the area that catches the pointer is wider
// (--splitter-hit in shell.css). The drag captures the pointer, so it keeps going over the
// terminal or the editor and ends even if the button is released outside the window. Screen
// readers hear the panel's size in pixels (aria-valuenow, kept current by layout.js).

const KEY_STEP = 16;

/**
 * Makes `element` resize panel `id`. `size()` reads the panel's current size; `resize(id, size)`
 * sets one (null resets it) and returns the size it settled on. `limits` is { min, max }.
 */
export function setupSplitter(element, { id, size, resize, limits }) {
  const vertical = id === 'bottom';
  // Panels right of or below their splitter grow as it moves left or up.
  const sign = id === 'files' ? 1 : -1;
  const label = { files: 'Resize files', bottom: 'Resize terminal and tests', handout: 'Resize handout', tutor: 'Resize tutor' }[id];
  Object.assign(element, { tabIndex: 0, role: 'separator' });
  element.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-valuemin', String(limits.min));
  element.setAttribute('aria-valuemax', String(limits.max));
  element.dataset.tip = `${label}. Double-click to reset.`;

  element.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const start = vertical ? down.clientY : down.clientX;
    const from = size();
    element.setPointerCapture(down.pointerId);
    document.body.classList.add(vertical ? 'resizing-rows' : 'resizing-columns');
    element.classList.add('dragging');
    const move = (e) => resize(id, from + ((vertical ? e.clientY : e.clientX) - start) * sign);
    const end = () => {
      document.body.classList.remove('resizing-rows', 'resizing-columns');
      element.classList.remove('dragging');
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('lostpointercapture', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('lostpointercapture', end);
  });
  element.addEventListener('dblclick', () => resize(id, null));
  element.addEventListener('keydown', (e) => {
    const keys = vertical ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key === 'Enter') resize(id, null);
    else if (keys[e.key]) resize(id, size() + keys[e.key] * KEY_STEP * sign);
    else return;
    e.preventDefault();
  });
}
