// Build the game from source into build/web/ (a static site the CI pushes to
// itch.io). Bundles src/main.js — level JSON is imported and bundled in — then
// copies the HTML shell alongside it. No PlayCanvas cloud involved: everything
// that makes the game is in this repo.
import * as esbuild from 'esbuild';
import { cpSync, copyFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const OUT = 'build/web';
const ASSET_SOURCE = process.env.ESCAPE_WORK_ASSET_SOURCE || 'assets';
const ASSET_MANIFEST = process.env.ESCAPE_WORK_ASSET_MANIFEST || 'assets.runtime.json';
const profileArg = process.argv.find((arg) => arg.startsWith('--profile='));
const ART_PROFILE = profileArg?.slice('--profile='.length)
  || process.env.ESCAPE_WORK_ART_PROFILE
  || 'default';
const { ART_PROFILES } = await import('./src/data/art-profiles.js');
const artProfile = ART_PROFILES[ART_PROFILE];
if (!artProfile) {
  throw new Error(`Unknown art profile "${ART_PROFILE}". Expected one of: ${Object.keys(ART_PROFILES).join(', ')}`);
}
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
  define: { __ESCAPE_WORK_ART_PROFILE__: JSON.stringify(ART_PROFILE) },
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
// Only manifest-approved roots are considered. This boundary is deliberately
// data-driven: local licensed source packs may sit beside runtime exports, and
// a private repository checkout can be injected with ESCAPE_WORK_ASSET_SOURCE,
// but neither is permission to publish every file it contains.
const manifest = JSON.parse(readFileSync(ASSET_MANIFEST, 'utf8'));
if (!Array.isArray(manifest.include) || !manifest.include.length) {
  throw new Error(`${ASSET_MANIFEST} must contain a non-empty "include" array.`);
}
const runtimeIncludes = manifest.include.map((entry) => {
  const clean = String(entry).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean || clean.startsWith('/') || clean.split('/').includes('..')) {
    throw new Error(`${ASSET_MANIFEST} contains an unsafe asset path: ${entry}`);
  }
  return clean;
});
const approvedRuntimeAsset = (rel) => runtimeIncludes.some(
  (entry) => rel === entry || rel.startsWith(`${entry}/`),
);

// Everything approved that is not a .glb (textures, audio, sprites) is copied
// as before.
const referencedProps = new Set();
{
  const { TILE_TYPES } = await import('./src/data/tiles.js');
  for (const def of Object.values(TILE_TYPES)) if (def.model) referencedProps.add(`${def.model}.glb`);
}
let shipped = 0;
let skipped = 0;
const excludedRoots = new Set();
if (!existsSync(ASSET_SOURCE)) {
  throw new Error(`Asset source does not exist: ${ASSET_SOURCE}`);
}
cpSync(ASSET_SOURCE, `${OUT}/assets`, {
  recursive: true,
  filter: (src) => {
    const rel = relative(ASSET_SOURCE, src).split(sep).join('/');
    if (!rel) return true;
    if (!approvedRuntimeAsset(rel)) {
      excludedRoots.add(rel.split('/')[0]);
      return false;
    }
    if (!src.endsWith('.glb')) return true;
    if (rel.startsWith('characters/')) return true; // rigs always ship
    const keep = referencedProps.has(rel);
    if (keep) shipped += 1; else skipped += 1;
    return keep;
  },
});

const cleanRelativeAssetPath = (value, label) => {
  const clean = String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) {
    throw new Error(`${label} contains an unsafe asset path: ${value}`);
  }
  return clean;
};

// An opt-in profile overlays only its explicit runtime allowlist. The raw pack
// remains outside build/web, and the default/public build never reads it.
let profileAssets = 0;
if (artProfile.assets.length) {
  const profileSource = process.env[artProfile.sourceEnv] || artProfile.defaultSource;
  if (!profileSource || !existsSync(profileSource)) {
    throw new Error(
      `Art profile "${ART_PROFILE}" needs its private asset source at ${profileSource || '(unset)'}.`,
    );
  }
  const targets = new Set();
  for (const mapping of artProfile.assets) {
    const from = cleanRelativeAssetPath(mapping.from, `${ART_PROFILE}.assets.from`);
    const to = cleanRelativeAssetPath(mapping.to, `${ART_PROFILE}.assets.to`);
    if (targets.has(to)) throw new Error(`Art profile "${ART_PROFILE}" writes ${to} more than once.`);
    targets.add(to);
    const sourceFile = join(profileSource, ...from.split('/'));
    if (!existsSync(sourceFile)) throw new Error(`Art profile source asset is missing: ${sourceFile}`);
    const targetFile = join(OUT, 'assets', ...to.split('/'));
    mkdirSync(dirname(targetFile), { recursive: true });
    copyFileSync(sourceFile, targetFile);
    profileAssets += 1;
  }
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

console.log(
  `Build complete -> ${OUT}/ [art=${ART_PROFILE}]  (${shipped} prop models + all character rigs shipped, `
  + `${profileAssets} profile asset(s), ${skipped} unreferenced props skipped, `
  + `${excludedRoots.size} unapproved asset root(s) excluded)`,
);
