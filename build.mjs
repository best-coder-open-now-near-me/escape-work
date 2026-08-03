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

// Ship the props the game can actually place. `assets/` holds far more than the
// registries reference - a whole furniture kit was converted at once, and most
// of it is not placed by any tile type - so copying the directory wholesale
// shipped several MB of .glb nothing points at.
//
// The sweep prunes ONLY what it can prove: prop models, which are referenced
// exactly one way (`TILE_TYPES[x].model`). Character rigs are deliberately
// exempt. They are named by string interpolation from sheet, def and wardrobe
// data in eight places, plus CUSTOM_RIGS, and an earlier version of this sweep
// that tried to enumerate those sources got it wrong and silently dropped four
// rigs - a build that ships a broken game to save 200KB is a bad trade. There
// are twelve of them; they all ship.
//
// Everything that is not a .glb (textures, audio, sprites) is copied as before.
const referencedProps = new Set();
{
  const { TILE_TYPES } = await import('./src/data/tiles.js');
  for (const def of Object.values(TILE_TYPES)) if (def.model) referencedProps.add(`${def.model}.glb`);
}
let shipped = 0;
let skipped = 0;
const CHARACTERS = `characters${sep}`;
if (existsSync('assets')) {
  cpSync('assets', `${OUT}/assets`, {
    recursive: true,
    filter: (src) => {
      if (!src.endsWith('.glb')) return true;
      const rel = src.replace(/^assets[\\/]/, '');
      if (rel.startsWith(CHARACTERS) || rel.startsWith('characters/')) return true; // rigs always ship
      const keep = referencedProps.has(rel.split(sep).join('/'));
      if (keep) shipped += 1; else skipped += 1;
      return keep;
    },
  });
}

// If the sweep drops a prop a tile type names, the build has just shipped a
// guaranteed 404 - fail here rather than at someone's first playthrough. (The
// unit suite checks the same relation from the other side: every registry model
// must exist on disk. This catches a path-shape mistake in the sweep itself.)
{
  const lost = [...referencedProps].filter((m) => !existsSync(`${OUT}/assets/${m}`));
  if (lost.length) {
    throw new Error(
      `Build would ship ${lost.length} missing prop model(s): ${lost.join(', ')}\n`
      + 'Either the file is absent from assets/ or the sweep in build.mjs derives its path wrongly.');
  }
}

console.log(`Build complete -> ${OUT}/  (${shipped} prop models + all character rigs shipped, ${skipped} unreferenced props skipped)`);
