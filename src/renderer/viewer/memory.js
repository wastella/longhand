// What the viewer remembers per folder, in the webview's local storage (like the editor's open
// tabs): which file is the handout, whether its pane is open and how wide, whether the handout
// was already offered, and where the student was in each file it showed (a PDF's page and zoom,
// a Markdown file's scroll). Losing it loses nothing but those places.

const key = (folder) => `longhand.viewer:${folder}`;
const MAX_PLACES = 50;

let folder = null;
let memory = null;

function blank() {
  return { handout: null, open: false, size: null, offered: false, places: {} };
}

/** Loads the memory of `path`, the folder just opened. Anything malformed in it is dropped. */
export function loadMemory(path) {
  folder = path;
  memory = blank();
  try {
    const saved = JSON.parse(localStorage.getItem(key(path)));
    if (typeof saved?.handout === 'string') memory.handout = saved.handout;
    if (typeof saved?.open === 'boolean') memory.open = saved.open;
    if (Number.isFinite(saved?.size)) memory.size = saved.size;
    if (typeof saved?.offered === 'boolean') memory.offered = saved.offered;
    if (saved?.places && typeof saved.places === 'object') memory.places = saved.places;
  } catch {
    // Unreadable: start afresh.
  }
  return memory;
}

/** The open folder's memory, as loaded by loadMemory. */
export const recall = () => memory || blank();

/** Changes the open folder's memory with `patch` and writes it. */
export function remember(patch) {
  if (!folder) return;
  Object.assign(memory, patch);
  try {
    localStorage.setItem(key(folder), JSON.stringify(memory));
  } catch {
    // Storage full or unavailable: the places simply will not come back.
  }
}

/** Where the student was in `path`, or {}. */
export const placeIn = (path) => {
  const place = memory?.places[path];
  return place && typeof place === 'object' ? place : {};
};

/** Remembers where the student is in `path`, keeping the most recent places only. */
export function rememberPlace(path, place) {
  if (!memory) return;
  const places = { ...memory.places };
  delete places[path];
  places[path] = place;
  const paths = Object.keys(places);
  for (const old of paths.slice(0, Math.max(0, paths.length - MAX_PLACES))) delete places[old];
  remember({ places });
}
