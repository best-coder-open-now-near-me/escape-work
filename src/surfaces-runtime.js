// Dynamic surface state - the part of the Divinity layer that changes at
// runtime. Fire starts on ignitable props (trash cans), spreads through
// `flammable` surfaces (paper) cell by cell, burns out to nothing, and
// detonates explosive props (printers) it reaches. Pure state machine: the
// scene hooks passed in handle all visuals, `onExplosion` handles gameplay.
import { SURFACES } from './data/surfaces.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SPREAD_DELAY = 0.7; // seconds before a burning cell ignites neighbours
const FUSE = 0.8; // seconds between fire reaching a printer and the boom
const BURN_TIME = 6;
const TRASH_BURN_TIME = 9;

export function createSurfaceRuntime({ grid, hooks, onExplosion }) {
  // hooks: { addFlame(x, z, lift), hideSurfaceVisual(x, z) }
  const key = (x, z) => x + ',' + z;
  const burning = new Map(); // key -> { x, z, t, spread, flame }
  const burned = new Set();
  const fuses = new Map(); // key -> { x, z, t }
  const exploded = new Set();

  const baseSurface = (x, z) => grid.surfaceAt(x, z);
  const isBurning = (x, z) => burning.has(key(x, z));
  const surfaceAt = (x, z) => {
    const k = key(x, z);
    if (burning.has(k)) return 'fire';
    if (burned.has(k)) return null;
    return baseSurface(x, z);
  };
  const flammable = (x, z) =>
    !burned.has(key(x, z)) && !burning.has(key(x, z)) && !!SURFACES[baseSurface(x, z)]?.flammable;
  const ignitable = (x, z) => grid.defAt(x, z).ignitable && !burning.has(key(x, z));

  function ignite(x, z) {
    const k = key(x, z);
    if (burning.has(k)) return false;
    const isProp = !!grid.defAt(x, z).ignitable;
    if (!isProp && !flammable(x, z)) return false;
    burning.set(k, {
      x, z, t: 0, spread: false, prop: isProp,
      flame: hooks.addFlame(x, z, isProp ? 0.62 : 0.16),
    });
    if (!isProp) hooks.hideSurfaceVisual(x, z); // the paper is the fuel
    return true;
  }

  function tick(dt) {
    for (const [k, b] of [...burning]) {
      b.t += dt;
      if (!b.spread && b.t > SPREAD_DELAY) {
        b.spread = true;
        for (const [dx, dz] of N4) {
          const nx = b.x + dx;
          const nz = b.z + dz;
          if (flammable(nx, nz)) ignite(nx, nz);
          const nk = key(nx, nz);
          if (grid.defAt(nx, nz).explosive && !exploded.has(nk) && !fuses.has(nk)) {
            fuses.set(nk, { x: nx, z: nz, t: FUSE });
          }
        }
      }
      if (b.t > (b.prop ? TRASH_BURN_TIME : BURN_TIME)) {
        if (b.flame) b.flame.destroy();
        burning.delete(k);
        if (!b.prop) burned.add(k); // burnt paper is gone; the can survives
      }
    }
    for (const [k, f] of [...fuses]) {
      f.t -= dt;
      if (f.t <= 0) {
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
    ignite,
    ignitable,
    tick,
    get burningCount() { return burning.size; },
  };
}
