// A picture in a viewer tab: fitted to the pane, or at its own size after a click (or Enter).
// Below it, its size in pixels. An SVG is drawn as an image, so its scripts never run and it
// loads nothing from elsewhere.

import { h } from '../dom.js';
import { imageUrl } from './files.js';
import { problemView } from './problem.js';

/** Shows the image at `path` in `host`. Returns { destroy }. */
export function showImage(host, path) {
  let gone = false;
  const status = h('p', { class: 'viewer-loading' }, 'Loading…');
  host.replaceChildren(status);

  imageUrl(path).then(
    (url) => {
      if (gone) return;
      const caption = h('p', { class: 'image-caption' });
      const img = h('img', { alt: path, draggable: 'false' });
      const frame = h('div', { class: 'image-frame fit', tabindex: '0', role: 'button', 'aria-pressed': 'false', 'aria-label': 'Show at actual size' }, img);
      const toggle = () => {
        const actual = frame.classList.toggle('fit') === false;
        frame.setAttribute('aria-pressed', String(actual));
        frame.setAttribute('aria-label', actual ? 'Fit to the pane' : 'Show at actual size');
      };
      frame.onclick = toggle;
      frame.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle()));
      img.onload = () => {
        caption.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        host.replaceChildren(h('div', { class: 'image-view' }, frame, caption));
      };
      img.onerror = () => !gone && host.replaceChildren(problemView(path, { code: 'unreadable' }));
      img.src = url;
    },
    (problem) => !gone && host.replaceChildren(problemView(path, problem)),
  );
  return { destroy: () => (gone = true) };
}
