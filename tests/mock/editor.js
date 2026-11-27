// The editor's documents (documents.rs) over the fixture folder. Files are read as the text they
// hold (line endings included), modified at time 1 unless a test says otherwise:
//   options.disk: { path: result }   what doc_read returns for a path, e.g. { kind: 'binary', size: 2e9 }
//   options.readOnly: [path]          saving these fails as it would without write permission
//   options.delay: { command: ms }    answers that command this much later, as a slow disk would;
//                                     the answer describes the disk when the command was called
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
const stampOf = (path) => ({ mtime: mtimeOf(path), size: files[path].length });

window.__changeOnDisk = (path, text) => {
  if (text == null) delete files[path];
  else files[path] = text;
  mtimes[path] = clock += 1000;
};

/** The ending most lines use, as documents.rs decides it. */
function lineEnding(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const cr = (text.match(/\r/g) || []).length - crlf;
  const lf = (text.match(/\n/g) || []).length - crlf;
  if (crlf > lf && crlf >= cr) return 'crlf';
  return cr > lf && cr > crlf ? 'cr' : 'lf';
}

const commands = {
  doc_read: ({ rel }) => {
    const special = mock.options.disk?.[rel];
    if (special) return { mtime: rel in files ? mtimeOf(rel) : 1, ...special };
    if (!(rel in files)) return { kind: 'missing' };
    return { kind: 'text', text: files[rel], ...stampOf(rel), format: { lineEnding: lineEnding(files[rel]), bom: false } };
  },
  doc_write: ({ rel, text, expected }) => {
    if (mock.options.readOnly?.includes(rel)) throw `You don't have permission to save ${rel}. Check who owns it and whether it is read-only.`;
    if (expected != null) {
      if (!(rel in files)) return { status: 'deleted' };
      const now = stampOf(rel);
      if (now.mtime !== expected.mtime || now.size !== expected.size) return { status: 'changed' };
    }
    files[rel] = text;
    mtimes[rel] = clock += 1000;
    window.__saves[rel] = (window.__saves[rel] || 0) + 1;
    return { status: 'saved', ...stampOf(rel) };
  },
  doc_stat: ({ paths }) => paths.map((rel) => (rel in files ? stampOf(rel) : { missing: true })),
};

for (const [name, run] of Object.entries(commands)) {
  mock.commands[name] = (args) => {
    const ms = mock.options.delay?.[name];
    if (!ms) return run(args);
    // Worked out now, answered later.
    let answer;
    try {
      answer = { value: run(args) };
    } catch (error) {
      answer = { error };
    }
    return new Promise((resolve, reject) => setTimeout(() => ('error' in answer ? reject(answer.error) : resolve(answer.value)), ms));
  };
}
