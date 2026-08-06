// CHANGING THE FLOOR, grid and mesh together.
//
// Two edits, and the rule for both is the pairing: a tile's TYPE lives in the
// grid and its look lives in the scene, so changing one without the other
// leaves a partition you can walk through but still see, or a floor that
// blocks. Every caller has always known to do both - which is exactly why it
// was written out three times (combat's world facade, the out-of-combat shove,
// and the AI's), and why a fourth caller would have written it a fourth.
//
// It takes `grid` and `scene` rather than a world facade, because the
// out-of-combat half has no facade: outside a fight there is no `world`, just
// the level. That is the whole reason the copies existed.
export function createWorldEdits(grid, scene) {
  return {
    // A tile becomes something else - a toppled partition becomes floor.
    setType: (x, z, type) => {
      grid.setType(x, z, type);
      scene.refreshTile?.(x, z);
    },
    // Knock a plain wall edge out of the world. Doors never appear in the wall
    // sets, so they are untoppleable by construction. True if one was there.
    toppleEdge: (x, z, nx, nz) => {
      const e = grid.removeEdgeBetween(x, z, nx, nz);
      if (e) scene.removeEdgeWall?.(e.o, e.k);
      return !!e;
    },
  };
}
