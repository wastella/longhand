// The app's icons: a few drawings from Lucide (https://lucide.dev, ISC licence, which is
// compatible with MIT: "Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022
// as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors
// 2022."; the full notice is in THIRD_PARTY_NOTICES.md). Each is drawn on a 24-unit grid with round 2-unit strokes; CSS (.icon in base.css)
// sizes them and colours them with the text colour. Add one by copying its shapes from Lucide.

export const iconShapes = {
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
  'folder-open': [
    [
      'path',
      {
        d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
      },
    ],
  ],
  file: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      },
    ],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  alert: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 12, x2: 12, y1: 8, y2: 12 }],
    ['line', { x1: 12, x2: 12.01, y1: 16, y2: 16 }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M12 16v-4' }],
    ['path', { d: 'M12 8h.01' }],
  ],
  trash: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
    ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
  ],
  'panel-left': [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M9 3v18' }],
  ],
  'panel-bottom': [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M3 15h18' }],
  ],
  'panel-right': [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', { d: 'M15 3v18' }],
  ],
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  stop: [['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }]],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  external: [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  ],
};

const SVG = 'http://www.w3.org/2000/svg';

/** The names `icon()` accepts. */
export const iconNames = Object.keys(iconShapes);

/**
 * An inline SVG icon, hidden from screen readers (give its button a label or title instead).
 * `className` adds classes, such as 'small'.
 *
 *   h('button', { class: 'button ghost icon-button', 'aria-label': 'New file' }, icon('plus'))
 */
export function icon(name, className = '') {
  if (!iconShapes[name]) throw new Error(`No icon called "${name}"`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of iconShapes[name]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}
