// The folder listings behind the file tree, fetched once and kept until something changes them.

import { invoke } from '../backend.js';

/** folder path ('' for the root) -> [{ path, name, dir, ignored }] */
const listings = new Map();
const loading = new Map();
let generation = 0;

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** The listing of `dir` if it is loaded. */
export const cachedListing = (dir) => listings.get(dir);

/** Loads the listing of `dir`. A folder that vanished or cannot be read lists as empty. */
export function loadListing(dir) {
  if (listings.has(dir)) return Promise.resolve(listings.get(dir));
  if (!loading.has(dir)) {
    const started = generation;
    const done = (entries) => {
      loading.delete(dir);
      // A change that arrived while this was loading may have made it stale.
      if (started === generation) listings.set(dir, entries);
      return entries;
    };
    loading.set(
      dir,
      invoke('fs_list', { rel: dir }).then(done, () => done([])),
    );
  }
  return loading.get(dir);
}

/** Forgets the listings that changes at `paths` affect; '' forgets everything. */
export function forgetListings(paths) {
  generation++;
  loading.clear();
  for (const path of paths) {
    if (path === '') return listings.clear();
    listings.delete(parentOf(path));
    for (const dir of listings.keys()) if (dir === path || dir.startsWith(path + '/')) listings.delete(dir);
  }
}

export const forgetAllListings = () => forgetListings(['']);
