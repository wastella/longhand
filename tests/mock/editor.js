// The editor's documents (documents.rs) over the fixture folder. Files read as LF text
// modified at time 1 unless a test says otherwise:
//   options.disk: { path: result }   what doc_read returns for a path, e.g. { kind: 'binary', size: 2e9 }
//   options.readOnly: [path]          saving these fails as it would without write permission
// window.__changeOnDisk(path, text) plays another program changing a file (text null deletes it),
// and window.__saves counts the writes per path.

const mock = window.__mock;

// Every page starts with no remembered tabs, so one test's open files do not reappear in the next.
for (const key of Object.keys(localStorage)) if (key.startsWith('longhand.openFiles:')) localStorage.removeItem(key);
const files = mock.files;
const mtimes = {};
let clock = 1;
window.__saves = {};

const mtimeOf = (path) => mtimes[path] || 1;

window.__changeOnDisk = (path, text) => {
  if (text == null) delete files[path];
  else files[path] = text;
  mtimes[path] = clock += 1000;
};

Object.assign(mock.commands, {
  doc_read: ({ rel }) => {
    const special = mock.options.disk?.[rel];
    if (special) return special;
    if (!(rel in files)) return { kind: 'missing' };
    return { kind: 'text', text: files[rel], mtime: mtimeOf(rel), format: { lineEnding: 'lf', bom: false } };
  },
  doc_write: ({ rel, text, expectedMtime }) => {
    if (mock.options.readOnly?.includes(rel)) throw `You don't have permission to save ${rel}. Check who owns it and whether it is read-only.`;
    if (expectedMtime != null) {
      if (!(rel in files)) return { status: 'deleted' };
      if (mtimeOf(rel) !== expectedMtime) return { status: 'changed' };
    }
    files[rel] = text;
    mtimes[rel] = clock += 1000;
    window.__saves[rel] = (window.__saves[rel] || 0) + 1;
    return { status: 'saved', mtime: mtimes[rel] };
  },
  doc_stat: ({ paths }) => paths.map((rel) => (rel in files ? { mtime: mtimeOf(rel) } : { missing: true })),
});
