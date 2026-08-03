// Build the game from source into build/web/ (a static site the CI pushes to
// itch.io). Bundles src/main.js — level JSON is imported and bundled in — then
// copies the HTML shell alongside it. No PlayCanvas cloud involved: everything
// that makes the game is in this repo.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { sep } from 'node:path';

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

// Ship the assets the game can actually reach. `assets/` holds far more than
// the registries reference - a whole furniture kit was converted at once, and
// most of it is not placed by any tile type - so copying the directory wholesale
// shipped several MB of .glb nothing points at.
//
// Reachability is derived from the registries rather than from a hand-kept
// list, so "drop a file in assets/ and it deploys" still holds the moment
// something references it. Anything that is NOT a .glb (textures, audio,
// sprites) is copied as before: those are small and referenced by string in
// ways this sweep cannot see.
const referencedModels = new Set();
{
  const { TILE_TYPES } = await import('./src/data/tiles.js');
  const { CLASSES } = await import('./src/data/classes.js');
  const { ACTOR_REGISTRIES } = await import('./src/data/actor-registries.js');
  const { LOOKS } = await import('./src/data/looks.js');
  for (const def of Object.values(TILE_TYPES)) if (def.model) referencedModels.add(`${def.model}.glb`);
  for (const reg of [CLASSES, ...ACTOR_REGISTRIES]) {
    for (const def of Object.values(reg)) if (def.model) referencedModels.add(`characters/${def.model}.glb`);
  }
  // A look can swap the body a character wears.
  for (const look of Object.values(LOOKS || {})) {
    if (look?.model) referencedModels.add(`characters/${look.model}.glb`);
  }
}
let shipped = 0;
let skipped = 0;
if (existsSync('assets')) {
  cpSync('assets', `${OUT}/assets`, {
    recursive: true,
    filter: (src) => {
      if (!src.endsWith('.glb')) return true;
      const rel = src.replace(/^assets[\\/]/, '').split(sep).join('/');
      const keep = referencedModels.has(rel);
      if (keep) shipped += 1; else skipped += 1;
      return keep;
    },
  });
}

// If the sweep names a model that is not on disk, the build has just shipped a
// guaranteed 404 - fail here rather than at someone's first playthrough. (The
// unit suite checks the same relation from the other side: every registry model
// must exist. This catches a path-shape mistake in the sweep itself.)
if (shipped !== referencedModels.size) {
  const found = new Set();
  for (const m of referencedModels) if (existsSync(`${OUT}/assets/${m}`)) found.add(m);
  const lost = [...referencedModels].filter((m) => !found.has(m));
  throw new Error(
    `Build would ship ${lost.length} missing model(s): ${lost.join(', ')}\n`
    + 'Either the file is absent from assets/ or the reachability sweep in build.mjs derives its path wrongly.');
}

console.log(`Build complete -> ${OUT}/  (${shipped} models shipped, ${skipped} unreferenced skipped)`);
