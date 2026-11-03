// Builds the Figma plugin: figma-plugin/dist/code.js (sandbox, ES2017) and dist/ui.html.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('figma-plugin/dist', { recursive: true });
await build({
  entryPoints: ['figma-plugin/src/code.ts'],
  bundle: true,
  outfile: 'figma-plugin/dist/code.js',
  target: 'es2017', // Figma's sandbox
  format: 'iife',
  logLevel: 'info',
});
await copyFile('figma-plugin/src/ui.html', 'figma-plugin/dist/ui.html');
