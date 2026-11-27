// Which files the viewer shows, and reading them. Bytes come from the backend's view_read, which
// keeps to the open folder and refuses files larger than it will show.

import { invoke } from '../backend.js';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

const extension = (path) => (path.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || '';

/** 'pdf' or 'image' for a file the viewer shows instead of the editor; null for anything else. */
export function viewKind(path) {
  const ext = extension(path);
  if (ext === 'pdf') return 'pdf';
  return IMAGE_TYPES[ext] ? 'image' : null;
}

export const isMarkdown = (path) => /\.(md|markdown)$/i.test(path);

/** Whether `path` can be shown as the handout. */
export const canBeHandout = (path) => isMarkdown(path) || viewKind(path) === 'pdf';

export const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Why a file could not be read: { code, message, size? }, where code is 'missing', 'tooLarge',
 * 'notFile' or 'failed'. The backend sends this shape; anything else becomes 'failed'.
 */
function problemOf(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') return error;
  return { code: 'failed', message: String(error?.message || error) };
}

/** The file's bytes as a Uint8Array; throws a problem (see problemOf). */
export async function readBytes(path) {
  try {
    const data = await invoke('view_read', { rel: path });
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  } catch (error) {
    throw problemOf(error);
  }
}

/** A data: URL for an image in the folder, typed by its extension (an SVG is only ever an image). */
export async function imageUrl(path) {
  const bytes = await readBytes(path);
  const type = IMAGE_TYPES[extension(path)];
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(problemOf('The file could not be read.'));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
}

/**
 * The folder-relative path a link or image in `from` (a file in the folder) points to, or null
 * when it leaves the folder. A leading / means the folder itself.
 */
export function resolvePath(from, target) {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}
