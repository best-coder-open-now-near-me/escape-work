// Build the game from source into build/web/ (a static site the CI pushes to
// itch.io). Bundles src/main.js — level JSON is imported and bundled in — then
// copies the HTML shell alongside it. No PlayCanvas cloud involved: everything
// that makes the game is in this repo.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const OUT = 'build/web';
// PlayCanvas's prebuilt UMD engine build. We ship it as-is (a <script> tag in
// index.html loads it and exposes a global `pc`) rather than bundling it - its
// internals reference Node worker modules that a browser bundler can't resolve.
const ENGINE = 'node_modules/playcanvas/build/playcanvas.min.js';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: process.env.NO_MINIFY ? false : true,
  sourcemap: process.env.NO_MINIFY ? "inline" : false,
  format: 'iife',
  target: 'es2020',
  outfile: `${OUT}/bundle.js`,
  // (No `loader` entry for '.json': esbuild bundles JSON with the json loader
  // by default, so spelling it out only looked like it was load-bearing. The
  // level JSON imported by data/levels.js rides that default.)
});

cpSync('src/index.html', `${OUT}/index.html`);
cpSync(ENGINE, `${OUT}/playcanvas.min.js`);

// Ship everything in assets/ (models, textures, audio) as static files. Drop a
// file in assets/ and it deploys automatically - no build change needed.
if (existsSync('assets')) {
  cpSync('assets', `${OUT}/assets`, { recursive: true });
}

console.log(`Build complete -> ${OUT}/`);
