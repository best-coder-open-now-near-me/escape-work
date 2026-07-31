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
// A whisker under full tile size, so the wash reads as tiles of reach rather
// than one amorphous puddle - the seams are the grid the aim thinks in.
const QUAD = 0.94;

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
    e.setLocalPosition(x, PAINT_Y, z);
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
