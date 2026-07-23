// Dynamic surface state - the part of the Divinity layer that changes over the
// course of play. Fire starts on ignitable props (trash cans) or flammable
// surfaces (paper), spreads cell by cell, then dies down into smoke that blocks
// line of sight before clearing. Printers it reaches detonate. Pure state
// machine: the scene hooks passed in handle all visuals, `onExplosion` handles
// gameplay.
//
// LIFECYCLE, in TURNS (combat drives one per round; out of combat main.js does
// on a real-time clock): paper burns for FIRE_TURNS, and on its LAST burning
// turn it starts smoking (the OVERLAP) - smoke then lingers SMOKE_TURNS total,
// so a sheet's whole arc is FIRE_TURNS + SMOKE_TURNS - OVERLAP turns.
import { SURFACES } from './data/surfaces.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FIRE_TURNS = 3;       // paper burns for three turns
const PROP_FIRE_TURNS = 4;  // a trash can smoulders a little longer (no smoke)
const SMOKE_TURNS = 2;      // smoke lingers two turns
const OVERLAP = 1;          // smoke begins one turn before the fire dies
const PRINTER_FUSE_TURNS = 1;

export function createSurfaceRuntime({ grid, hooks, onExplosion }) {
  // hooks: { addFlame(x,z,lift), hideSurfaceVisual(x,z), addSmoke(x,z), removeSmoke(x,z) }
  const key = (x, z) => x + ',' + z;
  const burning = new Map(); // key -> { x, z, fireLeft, spread, prop, flame }
  const smoking = new Map(); // key -> { x, z, smokeLeft }
  const burned = new Set();  // consumed paper cells - the surface is gone
  const fuses = new Map();   // key -> { x, z, turnsLeft } - explosives counting down
  const exploded = new Set();

  const baseSurface = (x, z) => grid.surfaceAt(x, z);
  const isBurning = (x, z) => burning.has(key(x, z));
  const isSmoke = (x, z) => smoking.has(key(x, z));
  const surfaceAt = (x, z) => {
    const k = key(x, z);
    if (burning.has(k)) return 'fire';
    if (burned.has(k)) return null;
    return baseSurface(x, z);
  };
  const flammable = (x, z) =>
    !burned.has(key(x, z)) && !burning.has(key(x, z)) && !!SURFACES[baseSurface(x, z)]?.flammable;
  const ignitable = (x, z) => grid.defAt(x, z).ignitable && !burning.has(key(x, z));

  function startSmoke(x, z) {
    const k = key(x, z);
    if (smoking.has(k)) return;
    smoking.set(k, { x, z, smokeLeft: SMOKE_TURNS });
    hooks.addSmoke?.(x, z);
  }

  function ignite(x, z) {
    const k = key(x, z);
    if (burning.has(k)) return false;
    const isProp = !!grid.defAt(x, z).ignitable;
    if (!isProp && !flammable(x, z)) return false;
    burning.set(k, {
      x, z, fireLeft: isProp ? PROP_FIRE_TURNS : FIRE_TURNS,
      spread: false, prop: isProp,
      flame: hooks.addFlame(x, z, isProp ? 0.62 : 0.16),
    });
    if (!isProp) hooks.hideSurfaceVisual(x, z); // the paper is the fuel
    return true;
  }

  // Advance the whole fire/smoke lifecycle by one turn. Snapshot the fires that
  // exist NOW so cells ignited by this turn's spread don't also age this turn.
  function advanceTurn() {
    const active = [...burning.values()];
    // Snapshot smoke too, so a cell that STARTS smoking this turn (step 2) isn't
    // also aged this turn (step 3) - that would rob it of its first turn.
    const activeSmoke = [...smoking.values()];
    // 1) Spread once per cell: ignite flammable neighbours, fuse explosives.
    for (const b of active) {
      if (b.spread) continue;
      b.spread = true;
      for (const [dx, dz] of N4) {
        const nx = b.x + dx;
        const nz = b.z + dz;
        if (!grid.edgeOpen(b.x, b.z, nx, nz)) continue; // partitions stop fire
        if (flammable(nx, nz)) ignite(nx, nz);
        const nk = key(nx, nz);
        if (grid.defAt(nx, nz).explosive && !exploded.has(nk) && !fuses.has(nk)) {
          fuses.set(nk, { x: nx, z: nz, turnsLeft: PRINTER_FUSE_TURNS });
        }
      }
    }
    // 2) Age the fires: paper starts smoking on its last burning turn (overlap),
    //    then burns out; the trash can just goes out.
    for (const b of active) {
      b.fireLeft -= 1;
      if (!b.prop && b.fireLeft === OVERLAP) startSmoke(b.x, b.z);
      if (b.fireLeft <= 0) {
        if (b.flame) b.flame.destroy();
        burning.delete(key(b.x, b.z));
        if (!b.prop) burned.add(key(b.x, b.z)); // paper is spent; the can survives
      }
    }
    // 3) Age smoke that existed at the start of this turn, clearing it at zero.
    for (const s of activeSmoke) {
      s.smokeLeft -= 1;
      if (s.smokeLeft <= 0) {
        smoking.delete(key(s.x, s.z));
        hooks.removeSmoke?.(s.x, s.z);
      }
    }
    // 4) Tick explosive fuses.
    for (const [k, f] of [...fuses]) {
      f.turnsLeft -= 1;
      if (f.turnsLeft <= 0) {
        fuses.delete(k);
        exploded.add(k);
        onExplosion(f.x, f.z);
        for (const [dx, dz] of N4) {
          if (flammable(f.x + dx, f.z + dz)) ignite(f.x + dx, f.z + dz);
        }
      }
    }
  }

  return {
    surfaceAt,
    isBurning,
    isSmoke,
    ignite,
    ignitable,
    advanceTurn,
    get burningCount() { return burning.size; },
    get smokingCount() { return smoking.size; },
  };
}
