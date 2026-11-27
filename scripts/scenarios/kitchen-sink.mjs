// Every shared component from base.css, side by side in the dark and light themes. Use it to
// check a change to tokens.css or base.css, and as the catalogue when building new interface.
import { iconNames, iconShapes } from '../../src/renderer/shell/icons.js';

export const description = 'Every shared component (base.css) in both themes';

const svg = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${iconShapes[name]
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')}></${tag}>`,
    )
    .join('')}</svg>`;

const section = (title, body) => `<section class="ks-section"><h3 class="section-label">${title}</h3>${body}</section>`;

const column = (theme) => `
<div class="ks-column" data-theme="${theme}">
  <h2 class="ks-title">${theme === 'dark' ? 'Dark' : 'Light'}</h2>
  ${section(
    'Buttons',
    `<div class="row ks-wrap">
      <button class="button primary">Primary</button><button class="button">Default</button><button class="button ghost">Ghost</button>
      <button class="button danger">Delete</button><button class="button" disabled>Disabled</button>
    </div>
    <div class="row ks-wrap">
      <button class="button small">Small</button><button class="button primary large">Large primary</button>
      <button class="button ghost icon-button" aria-label="New file">${svg('plus')}</button>
      <button class="button ghost icon-button" aria-pressed="true" aria-label="Files">${svg('panel-left')}</button>
      <button class="button ghost icon-button small" aria-label="Close">${svg('x', 'small')}</button>
    </div>`,
  )}
  ${section(
    'Fields',
    `<div class="row ks-wrap">
      <input class="text-input" placeholder="Search this folder" />
      <input class="text-input invalid" value="bad/name?" />
      <select><option>Strict: no code</option></select>
      <input type="checkbox" class="switch" role="switch" checked aria-label="On" />
      <input type="checkbox" class="switch" role="switch" aria-label="Off" />
    </div>`,
  )}
  ${section(
    'Pane header, list rows, empty state',
    `<div class="ks-pane">
      <div class="pane-head"><span>Files</span><span class="spacer"></span><button class="button ghost">Find</button></div>
      <div class="list-row ks-row">${svg('file', 'small')} running.py</div>
      <div class="list-row ks-row active">${svg('file', 'small')} test_running.py <span class="spacer"></span><span class="badge danger">1 failing</span></div>
      <div class="list-row ks-row" aria-selected="true">${svg('folder', 'small')} stats</div>
      <p class="empty-state">No matches.</p>
    </div>`,
  )}
  ${section(
    'Badges, dots, keys, progress',
    `<div class="row ks-wrap">
      <span class="badge">12</span><span class="badge accent">New</span><span class="badge success">passing</span><span class="badge danger">2 failing</span>
      <span class="status-dot success"></span><span class="status-dot danger"></span><span class="status-dot warning"></span><span class="status-dot accent"></span>
      <kbd class="kbd">⌘B</kbd><kbd class="kbd">⇧⌘F</kbd><span class="spinner"></span>
    </div>
    <div class="ks-progress"><div class="progress"><span style="width: 60%"></span></div><div class="progress indeterminate"><span></span></div></div>`,
  )}
  ${section(
    'Menu and tooltip',
    `<div class="row ks-top">
      <div class="popover ks-static" role="menu">
        <div class="menu-item">New File… <span class="kbd-text">⌘N</span></div>
        <div class="menu-item" aria-selected="true">Rename… <span class="kbd-text">↩</span></div>
        <hr class="menu-separator" />
        <div class="menu-item" aria-disabled="true">Move to Trash</div>
      </div>
      <div class="tooltip ks-static"><span>Hide files</span><span class="kbd-text">⌘B</span></div>
    </div>`,
  )}
  ${section(
    'Notifications',
    `<div class="ks-notices">
      <div class="notice info">${svg('info', 'notice-icon')}<div class="notice-body"><p class="notice-message">Started a new conversation.</p></div></div>
      <div class="notice success">${svg('check', 'notice-icon')}<div class="notice-body"><p class="notice-message">All 12 tests pass.</p></div></div>
      <div class="notice error">${svg('alert', 'notice-icon')}<div class="notice-body"><p class="notice-message">~/cs336/a1 no longer exists.</p><button class="button small">Remove from Recent</button></div><button class="button ghost icon-button small">${svg('x', 'small')}</button></div>
    </div>`,
  )}
  ${section(
    'Palette',
    `<div class="palette ks-static">
      <input class="palette-input" value="run" />
      <div class="palette-list">
        <div class="palette-row active"><span><span class="palette-match">run</span>ning.py</span><span class="palette-detail">stats</span></div>
        <div class="palette-row"><span>test_<span class="palette-match">run</span>ning.py</span><span class="palette-detail">tests</span></div>
      </div>
      <div class="palette-foot"><kbd class="kbd">↩</kbd> open <kbd class="kbd">Esc</kbd> close</div>
    </div>`,
  )}
  ${section(
    'Sheet',
    `<div class="sheet ks-static"><header class="sheet-head"><h2>Settings</h2><span class="spacer"></span><button class="button ghost icon-button">${svg('x')}</button></header>
      <div class="sheet-body"><div class="setting-row"><div class="setting-text"><label>Appearance</label><p>Dark, light, or as the system is set.</p></div><select><option>Match System</option></select></div></div>
      <footer class="sheet-foot"><span>Longhand 0.1.0</span></footer></div>`,
  )}
  ${section('Icons', `<div class="row ks-wrap ks-icons">${iconNames.map((name) => `<span data-tip="${name}">${svg(name)}</span>`).join('')}</div>`)}
</div>`;

const styles = `
.ks { position: fixed; inset: 0; z-index: 100; display: grid; grid-template-columns: 1fr 1fr; overflow: auto; }
.ks-column { background: var(--color-surface); color: var(--color-text); padding: var(--space-8) var(--space-12); display: flex; flex-direction: column; gap: var(--space-6); }
.ks-title { margin: 0; font-size: var(--text-lg); }
.ks-section { display: flex; flex-direction: column; gap: var(--space-4); }
.ks-wrap { flex-wrap: wrap; }
.ks-top { align-items: flex-start; gap: var(--space-8); }
.ks-pane { background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-lg); width: 320px; }
.ks-row { gap: var(--space-4); height: var(--row-height); padding: 0 var(--space-6); }
.ks-progress { display: grid; gap: var(--space-4); width: 240px; }
.ks-static { position: static; margin: 0; animation: none; }
.ks-notices { display: grid; gap: var(--space-4); width: var(--notice-width); }
.ks-notices .notice { animation: none; }
.ks-icons { gap: var(--space-6); color: var(--color-text-muted); }
`;

export default async function (page) {
  await page.setViewport({ width: 1440, height: 1500, deviceScaleFactor: 2 });
  await page.evaluate(
    (html, css) => {
      const style = document.createElement('style');
      style.textContent = css;
      const sink = document.createElement('div');
      sink.className = 'ks';
      sink.innerHTML = html;
      document.body.append(style, sink);
    },
    column('dark') + column('light'),
    styles,
  );
}
