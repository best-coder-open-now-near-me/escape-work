// The marks a verb leaves on the FLOOR - rings and face bars, drawn in
// immediate mode, one frame at a time, plus the palette that says what a mark
// MEANS.
//
// Pure drawing: no game rules and no opinion about what should be ringed.
// Callers decide what to mark and in which state; this module only knows how
// to put a circle and an edge bar on the ground.
//
// It exists because there were two copies. `combat.js`'s `drawRing` and
// `hover.js`'s `ring` were byte-for-byte identical, and the two face drawers
// computed the same perpendicular in two spellings (`px = oz; pz = ox;
// mx - px * H` against `mx - oz * H`) - the same maths today, and exactly the
// drift that ends with the aim ring and the hover ring disagreeing about where
// a tile's edge is. The palette was duplicated too, under two sets of names
// (`PREVIEW_OK`/`RING_OK`) with identical values, so a re-theme had to be done
// twice or not at all.
//
// A FACTORY rather than module-scope constants, because `new pc.Color(...)` at
// import time is what keeps a module out of node - the same trap actors.js
// documents at its own `pcRuntime`. Nothing here touches the engine until a
// caller asks, so this file imports cleanly under a bare node process and the
// geometry below can be unit-tested.

const pcRuntime = () => globalThis.window?.pc;

const SEGS = 18; // a circle at floor scale; more segments buy nothing visible
const FACE_H = 0.42; // half a face bar's length - a little short of the full edge

// The two endpoints of the bar drawn along one shielded face of a tile.
// Split out from the drawing so the geometry is testable without an engine:
// the bar sits at its edge's midpoint and runs ALONG that edge, i.e.
// perpendicular to the face normal - swapping the offset's components IS the
// perpendicular.
export function faceBar(cx, cz, ox, oz, h = FACE_H) {
  const mx = cx + ox * 0.5;
  const mz = cz + oz * 0.5;
  return [[mx - oz * h, mz - ox * h], [mx + oz * h, mz + ox * h]];
}

// One point on a ring, by segment index. Same reason as above.
export function ringPoint(cx, cz, r, i, segs = SEGS) {
  const a = (i / segs) * Math.PI * 2;
  return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
}

// Build the marks for an engine app. The palette is one name per STATE, not
// per colour, so a mark's meaning survives a re-theme.
export function createGroundMarks(app, pc = pcRuntime()) {
  const palette = {
    // "this verb will act here" / "it refuses from here"
    OK: new pc.Color(0.42, 0.78, 0.35),
    FAR: new pc.Color(0.85, 0.28, 0.24),
    // Yellow, the reserved cover colour (TACTICS_PLAN M7's mapping): the ring
    // on a hovered take-cover shield, in a fight or out of one.
    COVER: new pc.Color(0.95, 0.8, 0.3),
    // Dim and cool, so it reads as information about YOU rather than a
    // judgement about a target (TACTICS_PLAN revision M5).
    REACH: new pc.Color(0.55, 0.62, 0.78),
  };

  // A ring on the floor, centred on a world point. `y` lifts it clear of the
  // tile so it does not z-fight the carpet.
  function ring(cx, cz, r, color, y = 0.14) {
    let prev = null;
    for (let i = 0; i <= SEGS; i++) {
      const [px, pz] = ringPoint(cx, cz, r, i);
      const p = new pc.Vec3(px, y, pz);
      if (prev) app.drawLine(prev, p, color);
      prev = p;
    }
  }

  // A tile's shielded faces, as bars along the tile's own edges.
  //
  // This is the affordance the crouch never had: the rule always knew which
  // sides were covered and the player never did, so tucking into a corner said
  // "In Cover" and left you to guess which way was open (designer, 2026-07-31:
  // "i have no indication of which partition is my actual cover").
  //
  // `list` is the face list the cover rule produced, so a bar can never point
  // somewhere `shieldedFaces` would not honour.
  function faces(cx, cz, list, color, y = 0.15) {
    for (const [ox, oz] of list || []) {
      const [a, b] = faceBar(cx, cz, ox, oz);
      app.drawLine(new pc.Vec3(a[0], y, a[1]), new pc.Vec3(b[0], y, b[1]), color);
    }
  }

  return { ...palette, ring, faces };
}
