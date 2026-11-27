// File access over the fixture folder in fixture.js. Folders exist only as path prefixes.

const mock = window.__mock;
const files = mock.files;
const isWithin = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

function list(rel) {
  const prefix = rel ? rel + '/' : '';
  const seen = new Map();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length).split('/');
    seen.set(rest[0], rest.length > 1);
  }
  return [...seen].map(([name, dir]) => ({ name, dir, path: prefix + name })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
}

function search(query) {
  const hits = [];
  for (const [path, text] of Object.entries(files))
    text.split('\n').forEach((line, i) => line.toLowerCase().includes(query.toLowerCase()) && hits.push({ path, line: i + 1, text: line.trim() }));
  return { hits, truncated: false };
}

Object.assign(mock.commands, {
  fs_list: ({ rel }) => list(rel),
  fs_read: ({ rel }) => ({ text: files[rel], mtime: 1 }),
  fs_write: ({ rel, text }) => ((files[rel] = text), { mtime: 1 }),
  fs_mtime: () => 1,
  fs_create: ({ rel, dir }) => void (files[dir ? rel + '/.keep' : rel] = ''),
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
  fs_search: ({ query }) => search(query),
});
