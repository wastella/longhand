import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/renderer/renderer.js'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'warning',
});
cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/styles.css', 'dist/styles.css');
cpSync('node_modules/@xterm/xterm/css/xterm.css', 'dist/xterm.css');
