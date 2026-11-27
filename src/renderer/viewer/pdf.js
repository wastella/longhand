// A PDF, drawn with pdf.js: the pages one under another, with a toolbar for the page and the
// zoom. Only the pages near the visible ones are drawn, and pages that scroll far away give
// their canvas back, so a long handout costs no more than a short one. Each drawn page carries
// pdf.js's text layer, so text can be selected and copied.
//
// pdf.js is loaded the first time a PDF opens (dist/pdfjs/, copied there by build.mjs), and runs
// with eval and WebAssembly off, inside the app's content security policy. It parses the file
// in its worker; the bytes come from the backend, so it never fetches anything.

import { h, spacer } from '../dom.js';
import { icon } from '../shell/index.js';
import { readBytes } from './files.js';
import { problemView } from './problem.js';

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** pdf.js measures pages in points; 1 at 100% zoom means a point is drawn as 96/72 CSS pixels. */
const CSS_PER_POINT = 96 / 72;
const GAP = 12;
const PLACE_DELAY = 250;

let library = null;

/** pdf.js, loaded once. The URL is built at run time so the bundler leaves the import alone. */
function pdfjs() {
  library ??= import(new URL('pdfjs/pdf.js', document.baseURI).href).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.js', document.baseURI).href;
    return lib;
  });
  return library;
}

function problemFor(error) {
  if (error?.code) return error;
  if (error?.name === 'PasswordException') return { code: 'failed', message: 'This PDF is protected by a password, which Longhand cannot open.' };
  return { code: 'unreadable' };
}

/**
 * Shows the PDF at `path` in `host`. `place` is where to start ({ page, zoom }; zoom null fits
 * the width); `onPlace(place)` hears where the student is, a moment after they stop moving.
 * Returns { destroy }.
 */
export function showPdf(host, path, { place = {}, onPlace = () => {} } = {}) {
  let gone = false;
  let doc = null;
  /** pdf.js's loading task; destroying it ends the document and its worker. */
  let task = null;
  let zoom = Number.isFinite(place.zoom) ? place.zoom : null;
  let current = Math.max(1, Math.floor(place.page) || 1);
  let pages = [];
  let observer = null;
  let resizer = null;
  let placeTimer = 0;
  let layoutFrame = 0;

  const pageInput = h('input', { class: 'text-input pdf-page-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Page' });
  const pageCount = h('span', { class: 'pdf-page-count' });
  const previous = h(
    'button',
    { type: 'button', class: 'button ghost icon-button small', 'aria-label': 'Previous page', 'data-tip': 'Previous page' },
    icon('chevron-left', 'small'),
  );
  const next = h(
    'button',
    { type: 'button', class: 'button ghost icon-button small', 'aria-label': 'Next page', 'data-tip': 'Next page' },
    icon('chevron-right', 'small'),
  );
  const zoomOut = h(
    'button',
    { type: 'button', class: 'button ghost icon-button small', 'aria-label': 'Zoom out', 'data-tip': 'Zoom out' },
    icon('minus', 'small'),
  );
  const zoomIn = h(
    'button',
    { type: 'button', class: 'button ghost icon-button small', 'aria-label': 'Zoom in', 'data-tip': 'Zoom in' },
    icon('plus', 'small'),
  );
  const fit = h('button', { type: 'button', class: 'button ghost small pdf-fit', 'data-tip': 'Fit to width' });
  const toolbar = h(
    'div',
    { class: 'pdf-toolbar', role: 'toolbar', 'aria-label': 'Pages and zoom' },
    previous,
    pageInput,
    pageCount,
    next,
    spacer(),
    zoomOut,
    fit,
    zoomIn,
  );
  const scroller = h('div', { class: 'pdf-pages', tabindex: '0', 'aria-label': 'PDF pages' });
  const status = h('p', { class: 'viewer-loading' }, 'Opening the PDF…');
  for (const control of toolbar.querySelectorAll('button, input')) control.disabled = true;
  host.replaceChildren(h('div', { class: 'pdf-view' }, toolbar, scroller, status));

  const fail = (error) => !gone && host.replaceChildren(problemView(path, problemFor(error)));

  /** The scale pages are drawn at: the chosen zoom, or whatever fits the first page's width. */
  function scale() {
    if (zoom) return zoom * CSS_PER_POINT;
    const room = scroller.clientWidth - 2 * GAP;
    return Math.max(0.25, room / pages[0].width);
  }

  function showPlace() {
    pageInput.value = String(current);
    pageCount.textContent = `of ${pages.length}`;
    previous.disabled = current <= 1;
    next.disabled = current >= pages.length;
    const percent = Math.round((scale() / CSS_PER_POINT) * 100);
    fit.textContent = `${percent}%`;
    fit.setAttribute('aria-pressed', String(zoom === null));
    fit.setAttribute('aria-label', `Zoom ${percent}%. Fit to width`);
    zoomOut.disabled = zoom !== null && zoom <= ZOOMS[0];
    zoomIn.disabled = zoom !== null && zoom >= ZOOMS.at(-1);
  }

  function remember() {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => !gone && onPlace({ page: current, zoom }), PLACE_DELAY);
  }

  function release(entry) {
    entry.task?.cancel();
    entry.task = null;
    entry.textLayer?.cancel();
    entry.textLayer = null;
    entry.drawnAt = null;
    entry.node.replaceChildren();
  }

  async function draw(entry) {
    const at = scale();
    if (entry.drawnAt === at) return;
    release(entry);
    entry.drawnAt = at;
    const lib = await pdfjs();
    const page = await doc.getPage(entry.number);
    if (gone || entry.drawnAt !== at) return;
    const viewport = page.getViewport({ scale: at });
    const ratio = window.devicePixelRatio || 1;
    const canvas = h('canvas', { width: String(Math.floor(viewport.width * ratio)), height: String(Math.floor(viewport.height * ratio)) });
    const text = h('div', { class: 'textLayer' });
    entry.node.replaceChildren(canvas, text);
    entry.task = page.render({ canvas, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    entry.textLayer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
    try {
      await Promise.all([entry.task.promise, entry.textLayer.render()]);
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException')
        console.warn(`Page ${entry.number} of ${path} did not draw:`, error);
    }
  }

  /** Sizes every page for the current scale, keeping the page in view where it was. */
  function layout() {
    const top = pages[current - 1];
    const offset = top ? (scroller.scrollTop - top.node.offsetTop) / Math.max(1, top.node.offsetHeight) : 0;
    const at = scale();
    for (const entry of pages) {
      entry.node.style.width = `${Math.floor(entry.width * at)}px`;
      entry.node.style.height = `${Math.floor(entry.height * at)}px`;
      entry.node.style.setProperty('--scale-factor', String(at));
      entry.node.style.setProperty('--total-scale-factor', String(at));
      if (entry.drawnAt != null && entry.visible) draw(entry);
      else if (entry.drawnAt != null) release(entry);
    }
    if (top) scroller.scrollTop = top.node.offsetTop + offset * top.node.offsetHeight;
    showPlace();
  }

  function goTo(number) {
    const entry = pages[Math.min(pages.length, Math.max(1, number)) - 1];
    if (!entry) return;
    scroller.scrollTop = entry.node.offsetTop - GAP;
    current = entry.number;
    showPlace();
    remember();
  }

  function setZoom(next) {
    zoom = next;
    layout();
    remember();
  }

  function step(direction) {
    const now = scale() / CSS_PER_POINT;
    const options = direction > 0 ? ZOOMS.filter((z) => z > now + 0.001) : ZOOMS.filter((z) => z < now - 0.001).reverse();
    if (options.length) setZoom(options[0]);
  }

  /** The page the student is reading: the last one whose top is in the upper third of the view. */
  function trackPage() {
    const line = scroller.scrollTop + scroller.clientHeight / 3;
    let found = 1;
    for (const entry of pages) {
      if (entry.node.offsetTop > line) break;
      found = entry.number;
    }
    if (found === current) return;
    current = found;
    showPlace();
    remember();
  }

  previous.onclick = () => goTo(current - 1);
  next.onclick = () => goTo(current + 1);
  zoomIn.onclick = () => step(1);
  zoomOut.onclick = () => step(-1);
  fit.onclick = () => setZoom(null);
  pageInput.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const wanted = Number.parseInt(pageInput.value, 10);
    if (Number.isFinite(wanted)) goTo(wanted);
    else showPlace();
  };
  pageInput.onblur = showPlace;
  scroller.addEventListener('scroll', trackPage, { passive: true });

  (async () => {
    const [lib, bytes] = await Promise.all([pdfjs(), readBytes(path)]);
    if (gone) return;
    task = lib.getDocument({ data: bytes, isEvalSupported: false, useWasm: false, enableXfa: false, useSystemFonts: true });
    doc = await task.promise;
    if (gone) return task.destroy();
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    // Other pages take the first one's size until they are drawn; most handouts are all one size.
    pages = Array.from({ length: doc.numPages }, (_, i) => ({
      number: i + 1,
      width: first.width,
      height: first.height,
      node: h('div', { class: 'pdf-page', 'data-page': String(i + 1) }),
    }));
    scroller.replaceChildren(...pages.map((entry) => entry.node));
    status.remove();
    for (const control of toolbar.querySelectorAll('button, input')) control.disabled = false;
    current = Math.min(current, pages.length);
    layout();
    goTo(current);
    observer = new IntersectionObserver(
      (seen) => {
        for (const { target, isIntersecting } of seen) {
          const entry = pages[Number(target.dataset.page) - 1];
          entry.visible = isIntersecting;
          if (isIntersecting) draw(entry).then(() => sizeFromPage(entry));
          else release(entry);
        }
      },
      { root: scroller, rootMargin: '100% 0px' },
    );
    for (const entry of pages) observer.observe(entry.node);
    resizer = new ResizeObserver(() => {
      if (zoom !== null) return;
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => !gone && layout());
    });
    resizer.observe(scroller);
  })().catch(fail);

  /** A page of another size than the first takes its own size once it has been read. */
  async function sizeFromPage(entry) {
    if (gone || entry.sized) return;
    entry.sized = true;
    const { width, height } = (await doc.getPage(entry.number)).getViewport({ scale: 1 });
    if (width === entry.width && height === entry.height) return;
    Object.assign(entry, { width, height });
    layout();
  }

  return {
    destroy() {
      if (!gone && pages.length) onPlace({ page: current, zoom });
      gone = true;
      clearTimeout(placeTimer);
      observer?.disconnect();
      resizer?.disconnect();
      for (const entry of pages) release(entry);
      task?.destroy();
    },
  };
}
