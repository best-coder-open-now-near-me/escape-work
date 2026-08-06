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
import { CARDINAL_DIRS } from './directions.js';
const FIRE_TURNS = 3;       // paper burns for three turns
const PROP_FIRE_TURNS = 4;  // a trash can smoulders a little longer (no smoke)
const SMOKE_TURNS = 2;      // smoke lingers two turns
const OVERLAP = 1;          // smoke begins one turn before the fire dies
const PRINTER_FUSE_TURNS = 1;

export function createSurfaceRuntime({ grid, hooks, onExplosion }) {
  // hooks: { addFlame(x,z,lift), spendFuel(x,z), addSmoke(x,z), removeSmoke(x,z) }
  const fine = grid.surfaceField || null;
  const coarseKey = (x, z) => `t:${x},${z}`;
  const surfaceKeyAt = (x, z) => {
    if (!fine) return coarseKey(x, z);
    const cell = fine.pointToCell(x, z);
    return cell ? `s:${cell.ix},${cell.iz}` : null;
  };
  const propPoint = (x, z) => ({ x: Math.round(x), z: Math.round(z) });
  const propKeyAt = (x, z) => {
    const p = propPoint(x, z);
    return `p:${p.x},${p.z}`;
  };
  const burning = new Map(); // key -> { x, z, fireLeft, spread, prop, flame }
  const smoking = new Map(); // key -> { x, z, smokeLeft }
  // No `burned` set. Consumed paper is reported to the world through
  // `hooks.spendFuel`, which clears the tile at its source, so the surface is
  // gone from every reader at once rather than being masked here. Keeping a
  // private "actually it's gone" set beside a grid that still said 'paper' was
  // two truths about one tile: the visual vanished while the grid kept a drift
  // that could never be re-laid on, never burn again, and would be redrawn by
  // any repaint of that tile.
  const fuses = new Map();   // prop key -> { x, z, turnsLeft } - explosives counting down
  const exploded = new Set();

  const baseSurface = (x, z) => grid.surfaceAt(x, z);
  const isBurning = (x, z) => {
    const surfaceKey = surfaceKeyAt(x, z);
    return (surfaceKey && burning.has(surfaceKey)) || burning.has(propKeyAt(x, z));
  };
  const isSmoke = (x, z) => {
    const surfaceKey = surfaceKeyAt(x, z);
    return (surfaceKey && smoking.has(surfaceKey)) || smoking.has(propKeyAt(x, z));
  };
  const surfaceAt = (x, z) => {
    if (isBurning(x, z)) return 'fire';
    return baseSurface(x, z);
  };
  // Spent fuel needs no bookkeeping here: the tile is bare floor now, and bare
  // floor is not flammable. A FRESH drift laid on it later is - which is the
  // point, and was the bug when this consulted a set that was never emptied.
  const flammable = (x, z) =>
    !burning.has(surfaceKeyAt(x, z)) && !!SURFACES[baseSurface(x, z)]?.flammable;
  const ignitable = (x, z) => {
    const p = propPoint(x, z);
    return (!!grid.defAt(p.x, p.z).ignitable && !burning.has(propKeyAt(p.x, p.z)))
      || flammable(x, z);
  };

  function startSmoke(x, z, k) {
    if (smoking.has(k)) return;
    smoking.set(k, { key: k, x, z, smokeLeft: SMOKE_TURNS });
    hooks.addSmoke?.(x, z);
  }

  function ignite(x, z) {
    const p = propPoint(x, z);
    const isProp = !!grid.defAt(p.x, p.z).ignitable;
    const cell = fine?.pointToCell(x, z) || null;
    const k = isProp ? propKeyAt(p.x, p.z) : surfaceKeyAt(x, z);
    if (!k) return false;
    if (burning.has(k)) return false;
    if (!isProp && !flammable(x, z)) return false;
    const centre = !isProp && cell ? fine.cellCenter(cell.ix, cell.iz) : p;
    burning.set(k, {
      key: k, x: centre.x, z: centre.z, tx: p.x, tz: p.z,
      ix: cell?.ix, iz: cell?.iz,
      fireLeft: isProp ? PROP_FIRE_TURNS : FIRE_TURNS,
      spread: false, prop: isProp,
      flame: hooks.addFlame(centre.x, centre.z, isProp ? 0.62 : 0.16),
    });
    // The paper IS the fuel: it is consumed the moment it catches, which is why
    // the visual has always been dropped here. Spend it in the grid at the same
    // instant, so no reader is left believing there is still a drift on a tile
    // that visibly has none. A can survives its own fire, so props are exempt.
    if (!isProp) hooks.spendFuel(centre.x, centre.z);
    return true;
  }

  const armFuse = (x, z) => {
    const k = propKeyAt(x, z);
    if (grid.defAt(x, z).explosive && !exploded.has(k) && !fuses.has(k)) {
      fuses.set(k, { x, z, turnsLeft: PRINTER_FUSE_TURNS });
    }
  };

  function spreadFine(b) {
    if (b.prop) {
      // A prop occupies one movement tile. Every fine surface cell across one
      // of its four open faces is a physical neighbour that can catch.
      for (const cell of fine.entries()) {
        const tx = Math.floor(cell.ix / fine.cellsPerTile);
        const tz = Math.floor(cell.iz / fine.cellsPerTile);
        if (Math.abs(tx - b.tx) + Math.abs(tz - b.tz) !== 1) continue;
        if (!grid.edgeOpen(b.tx, b.tz, tx, tz)) continue;
        if (flammable(cell.x, cell.z)) ignite(cell.x, cell.z);
      }
      for (const [dx, dz] of CARDINAL_DIRS) armFuse(b.tx + dx, b.tz + dz);
      return;
    }
    for (const [dx, dz] of CARDINAL_DIRS) {
      const nix = b.ix + dx;
      const niz = b.iz + dz;
      if (!fine.inBoundsCell(nix, niz)
        || !grid.surfaceCellEdgeOpen(b.ix, b.iz, nix, niz)) continue;
      const centre = fine.cellCenter(nix, niz);
      if (flammable(centre.x, centre.z)) ignite(centre.x, centre.z);
      armFuse(
        Math.floor(nix / fine.cellsPerTile),
        Math.floor(niz / fine.cellsPerTile),
      );
    }
  }

  // Advance the whole fire/smoke lifecycle by one turn. Snapshot the fires that
  // exist NOW so cells ignited by this turn's spread don't also age this turn.
  function advanceTurn() {
    const active = [...burning.values()];
    // Snapshot smoke too, so a cell that STARTS smoking this turn (step 2) isn't
    // also aged this turn (step 3) - that would rob it of its first turn.
    const activeSmoke = [...smoking.values()];
    // Snapshot the fuses for the same reason - step 1 below arms new ones.
    const activeFuses = [...fuses];
    // 1) Spread once per cell: ignite flammable neighbours, fuse explosives.
    for (const b of active) {
      if (b.spread) continue;
      b.spread = true;
      if (fine) {
        spreadFine(b);
        continue;
      }
      for (const [dx, dz] of CARDINAL_DIRS) {
        const nx = b.x + dx;
        const nz = b.z + dz;
        if (!grid.edgeOpen(b.x, b.z, nx, nz)) continue; // partitions stop fire
        if (flammable(nx, nz)) ignite(nx, nz);
        armFuse(nx, nz);
      }
    }
    // 2) Age the fires: paper starts smoking on its last burning turn (overlap),
    //    then burns out; the trash can just goes out.
    for (const b of active) {
      b.fireLeft -= 1;
      if (!b.prop && b.fireLeft === OVERLAP) startSmoke(b.x, b.z, b.key);
      if (b.fireLeft <= 0) {
        if (b.flame) b.flame.destroy();
        burning.delete(b.key);
        // Paper was already spent at ignition (see ignite); nothing to retire.
      }
    }
    // 3) Age smoke that existed at the start of this turn, clearing it at zero.
    for (const s of activeSmoke) {
      s.smokeLeft -= 1;
      if (s.smokeLeft <= 0) {
        smoking.delete(s.key);
        hooks.removeSmoke?.(s.x, s.z);
      }
    }
    // 4) Tick the fuses that were already burning at the START of this turn.
    //    A fuse ARMED by step 1's spread must not also age here, or it would
    //    detonate on the very turn the fire reached it - PRINTER_FUSE_TURNS = 1
    //    behaved as a zero-turn fuse and nobody ever got the telegraphed turn
    //    to step clear. Same snapshot rule as the fires and the smoke above.
    for (const [k, f] of activeFuses) {
      f.turnsLeft -= 1;
      if (f.turnsLeft <= 0) {
        fuses.delete(k);
        exploded.add(k);
        onExplosion(f.x, f.z);
        if (fine) {
          for (const cell of fine.entries()) {
            const tx = Math.floor(cell.ix / fine.cellsPerTile);
            const tz = Math.floor(cell.iz / fine.cellsPerTile);
            if (Math.abs(tx - f.x) + Math.abs(tz - f.z) !== 1) continue;
            if (!grid.edgeOpen(f.x, f.z, tx, tz)) continue;
            if (flammable(cell.x, cell.z)) ignite(cell.x, cell.z);
          }
          continue;
        }
        for (const [dx, dz] of CARDINAL_DIRS) {
          const nx = f.x + dx;
          const nz = f.z + dz;
          // Partitions stop fire - the blast's ignition included. Spread checks
          // this edge, and so does arming a fuse (a printer behind a partition
          // cannot be lit by the flame beside it), so lighting the paper drift
          // through that same sealed partition when the printer finally went up
          // contradicted the module's own rule twice over.
          if (!grid.edgeOpen(f.x, f.z, nx, nz)) continue;
          if (flammable(nx, nz)) ignite(nx, nz);
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
