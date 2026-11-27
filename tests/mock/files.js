// File access over the fixture folder in fixture.js. Folders exist only as path prefixes.
//
// Options: `gitignored` lists paths the mock treats as git-ignored (quiet in the tree, left out
// of quick open and search) and `treeMemory` is what the tree remembered about the folder.
// window.__treeMemory holds the last memory saved, window.__revealed the paths shown in Finder.
// A test fakes a change on disk by editing window.__files and emitting `files:changed` with
// { root: '/demo/running-stats', paths }.

const mock = window.__mock;
const files = mock.files;
const isWithin = (path, prefix) => path === prefix || path.startsWith(prefix + '/');
const GENERATED = ['.venv', 'venv', '__pycache__', 'node_modules', '.pytest_cache'];

// Like the backend, a folder's own entry is marked, not everything inside it.
const ignoredEntry = (path) => GENERATED.includes(path.split('/').pop()) || (mock.options.gitignored || []).includes(path);
const ignored = (path) => path.split('/').some((part) => GENERATED.includes(part)) || (mock.options.gitignored || []).some((prefix) => isWithin(path, prefix));

function list(rel) {
  const prefix = rel ? rel + '/' : '';
  const seen = new Map();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length).split('/');
    // A folder created empty holds a placeholder that is not listed.
    if (rest[0] === '.keep') continue;
    seen.set(rest[0], rest.length > 1);
  }
  return [...seen]
    .map(([name, dir]) => ({ name, dir, path: prefix + name, ignored: ignoredEntry(prefix + name) }))
    .sort((a, b) => b.dir - a.dir || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

const searchable = () =>
  Object.keys(files)
    .filter((path) => !ignored(path) && !path.endsWith('/.keep'))
    .sort();

const isWord = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);

function search({ query, caseSensitive, wholeWord }) {
  const hits = [];
  const fold = (s) => (caseSensitive ? s : s.toLowerCase());
  const needle = fold(query);
  let matchedFiles = 0;
  for (const path of searchable()) {
    const before = hits.length;
    files[path].split('\n').forEach((line, i) => {
      const text = line.trim();
      const hay = fold(text);
      const ranges = [];
      for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
        const bounded = !isWord(hay[at - 1]) && !isWord(hay[at + needle.length]);
        if (!wholeWord || bounded) ranges.push([at, at + needle.length]);
      }
      if (ranges.length) hits.push({ path, line: i + 1, text, ranges });
    });
    if (hits.length > before) matchedFiles++;
  }
  return { hits, files: matchedFiles, truncated: false, skipped: 0 };
}

Object.assign(mock.commands, {
  fs_list: ({ rel }) => list(rel),
  fs_read: ({ rel }) => ({ text: files[rel], mtime: 1 }),
  fs_write: ({ rel, text }) => ((files[rel] = text), { mtime: 1 }),
  fs_mtime: () => 1,
  fs_create: ({ rel, dir }) => {
    if (Object.keys(files).some((path) => isWithin(path, rel))) throw 'Something with that name already exists';
    files[dir ? rel + '/.keep' : rel] = '';
  },
  fs_rename: ({ from, to }) => {
    for (const path of Object.keys(files)) {
      if (!isWithin(path, from)) continue;
      files[to + path.slice(from.length)] = files[path];
      delete files[path];
    }
  },
  fs_trash: ({ rel }) => {
    for (const path of Object.keys(files)) if (isWithin(path, rel)) delete files[path];
  },
  fs_search: search,
  fs_files: () => ({ files: searchable(), truncated: false }),
  fs_watch: () => {},
  fs_reveal: ({ rel }) => void (window.__revealed = [...(window.__revealed || []), rel]),
  files_memory_load: () => mock.options.treeMemory || null,
  files_memory_save: ({ memory }) => void (window.__treeMemory = memory),
});
