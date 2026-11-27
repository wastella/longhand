// The folder listings behind the file tree, fetched once and kept until something changes them.

import { invoke } from '../backend.js';

/** folder path ('' for the root) -> [{ path, name, dir, ignored }] */
const listings = new Map();
/** folder path -> { token, promise } for the request in flight */
const loading = new Map();
let tokens = 0;

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** The listing of `dir` if it is loaded. */
export const cachedListing = (dir) => listings.get(dir);

/** Loads the listing of `dir`. A folder that vanished or cannot be read lists as empty. */
export function loadListing(dir) {
  if (listings.has(dir)) return Promise.resolve(listings.get(dir));
  if (loading.has(dir)) return loading.get(dir).promise;
  const token = ++tokens;
  const done = (entries) => {
    // Only the latest request for a folder may fill it; a change since then made older ones stale.
    if (loading.get(dir)?.token === token) {
      loading.delete(dir);
      listings.set(dir, entries);
    }
    return entries;
  };
  const promise = invoke('fs_list', { rel: dir }).then(done, () => done([]));
  loading.set(dir, { token, promise });
  return promise;
}

function forget(dir) {
  listings.delete(dir);
  loading.delete(dir);
}

/** Forgets the listings that changes at `paths` affect; '' forgets everything. */
export function forgetListings(paths) {
  if (paths.includes('')) {
    listings.clear();
    loading.clear();
    return;
  }
  for (const path of paths) {
    forget(parentOf(path));
    for (const dir of [...listings.keys(), ...loading.keys()]) if (dir === path || dir.startsWith(path + '/')) forget(dir);
  }
}

export const forgetAllListings = () => forgetListings(['']);
