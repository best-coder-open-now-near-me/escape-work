// Every module must import under a bare node process.
//
// Not a style rule - it is the gate on the whole unit suite. A single engine or
// DOM touch at MODULE SCOPE (`const pc = window.pc`, `new pc.Vec3()`,
// `window.addEventListener(...)`) runs at import time and throws, and the throw
// cascades to every importer: one line in ui/chrome.js locked 1,613 lines out,
// and one pair of scratch vectors in fx.js locked out tile-renderer, scene and
// editor with it. Nothing downstream can be tested until the import works, so
// this test is what keeps the door open.
//
// The fix is always the same shape: read the engine lazily
// (`globalThis.window?.pc`) and build engine objects on first USE, not at import.
// actors.js, models.js and shading.js carry the pattern.
import test from 'node:test';
import assert from 'node:assert';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

// main.js is the ENTRY POINT: it boots the engine, builds the scene and wires
// the DOM at import, which is its job. Nothing imports it, so nothing is
// blocked by it. Every other module is fair game.
const ENTRY = new Set(['main.js']);

function modules(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...modules(join(dir, e.name), `${prefix}${e.name}/`));
    else if (e.name.endsWith('.js')) out.push(prefix + e.name);
  }
  return out;
}

const all = modules(SRC).filter((m) => !ENTRY.has(m));

test('every module imports under bare node', async () => {
  const broken = [];
  for (const m of all) {
    try {
      await import(pathToFileURL(join(SRC, m)).href);
    } catch (e) {
      broken.push(`${m} — ${String(e.message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(broken, [],
    `these touch the engine or the DOM at import time:\n  ${broken.join('\n  ')}`);
});

test('the survey covers the whole tree, so a new folder cannot hide', () => {
  // Guard against the test silently measuring nothing.
  assert.ok(all.length > 50, `only found ${all.length} modules - is the walk right?`);
  assert.ok(all.includes('combat.js') && all.includes('ui/chrome.js') && all.includes('data/tiles.js'));
});
