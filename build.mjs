// Builds the interface into dist/: the bundled script, the page, and one stylesheet.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/renderer/main.js'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'warning',
});

// Tokens first, then the shared components, then every area's stylesheet. Area stylesheets
// do not depend on each other's order, so a new one is picked up without editing this list.
const styles = 'src/renderer/styles';
const first = ['tokens.css', 'base.css'];
const areas = readdirSync(styles)
  .filter((name) => name.endsWith('.css') && !first.includes(name))
  .sort();
writeFileSync('dist/styles.css', [...first, ...areas].map((name) => `/* ${name} */\n${readFileSync(`${styles}/${name}`, 'utf8')}`).join('\n'));

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('node_modules/@xterm/xterm/css/xterm.css', 'dist/xterm.css');
