// The ground read while aiming (TACTICS_PLAN M7): every tile the armed verb
// could legally land on RIGHT NOW, painted as a translucent wash on the floor.
// DOS2 answers "can I use this here?" by greying the ground out of range and
// interrupting the aim line (looked up 2026-07-29 - it greys, it does not
// shadow); the designer asked for the stronger read - paint what IS mine,
// with line of sight already factored in - so a blocker visibly bites a
// shadow out of the wash and barriers explain themselves.
//
// This module only owns the QUADS: which tiles to paint, and when, is
// combat's call (drawTargets computes the list from powers.rangeTiles with
// the world's own sight rules). Pooled plane entities rather than a rebuilt
// mesh, the same shape tile-renderer gives surface decals: the pool grows to
// the largest aim ever shown and then re-shows for free, and a keyed show()
// means an unchanged aim costs nothing per frame.
import { makeMaterial } from './shading.js';

// Lazy, like shading.js: nothing here runs outside a browser, but the import
// chain must stay loadable under node for the unit suite.
const pc = new Proxy({}, { get: (_, k) => window.pc[k] });

// Above the floor top (0.1) and the surface decals (0.12), below the preview
// lines and rings (0.14): the wash sits under every affordance drawn on it.
const PAINT_Y = 0.13;
// A whisker under full tile size. The seams used to be justified as "the
// grid the aim thinks in" - but since DEGRID M5 the aim thinks in a circle
// from the body, so the chips are jittered (below) to read as a scattered
// wash rather than graph paper. Look is `[proposed]` pending designer eyes
// (DEGRID_PLAN M6).
const QUAD = 0.94;

// Deterministic per-cell hash (tile-renderer's house pattern): the jitter
// must not swim between frames or differ between two shows of the same aim.
const hash01 = (x, z, salt) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

export function createAimPaint(app) {
  const holder = new pc.Entity('aim-paint');
  app.root.addChild(holder);
  // The aiming blue: kin to the reach ring's steel (combat.js REACH_RING),
  // washed thin - it must tint the carpet, not hide the surface decals under
  // it. Emissive so the toon lighting can't band it into stripes. First
  // screenshot shipped at 0.17 and read as fog rather than an affordance;
  // 0.3 is the low end of legible. A playtest knob, like every magnitude.
  const mat = makeMaterial([0.3, 0.52, 0.92], { opacity: 0.3, emissive: [0.16, 0.3, 0.6] });
  const pool = [];
  let used = 0;
  let key = null;

  function quadAt(x, z) {
    let e = pool[used];
    if (!e) {
      e = new pc.Entity();
      e.addComponent('render', { type: 'plane', material: mat });
      e.render.castShadows = false;
      e.setLocalScale(QUAD, 1, QUAD);
      holder.addChild(e);
      pool.push(e);
    }
    e.enabled = true;
    // Nudged, turned and sized a hair per cell so the wash's edge stops
    // tracing the grid. Small enough that the e2e debug read (Math.round of
    // the position) still names the right tile.
    e.setLocalPosition(
      x + (hash01(x, z, 1) - 0.5) * 0.06,
      PAINT_Y,
      z + (hash01(x, z, 2) - 0.5) * 0.06);
    e.setLocalEulerAngles(0, (hash01(x, z, 3) - 0.5) * 18, 0);
    const s = QUAD * (0.9 + hash01(x, z, 4) * 0.08);
    e.setLocalScale(s, 1, s);
    used += 1;
  }

  return {
    // Paint `tilesFn()`'s [x, z] list. `newKey` names the aim this list is
    // for (verb + origin + world epoch); a repeat key skips the recompute
    // entirely, which is what makes calling this every frame affordable.
    show(newKey, tilesFn) {
      if (newKey === key) return;
      key = newKey;
      used = 0;
      for (const [x, z] of tilesFn()) quadAt(x, z);
      for (let i = used; i < pool.length; i++) pool[i].enabled = false;
    },
    hide() {
      if (key === null) return;
      key = null;
      used = 0;
      for (const e of pool) e.enabled = false;
    },
    destroy() { holder.destroy(); },
    // For the e2e suite: how many tiles the wash covers, for which aim, and
    // WHICH tiles - a spec asserting the wash does not over-promise has to
    // name the tile it expects left out, which a count cannot express.
    get debug() {
      const tiles = [];
      for (let i = 0; i < used; i++) {
        const p = pool[i].getLocalPosition();
        tiles.push([Math.round(p.x), Math.round(p.z)]);
      }
      return { key, count: used, tiles };
    },
  };
}
