// The single source of tile visuals, used by both the game (scene.js
// buildLevel) and the level editor - they draw from the same data registries
// through the same code, so they cannot drift apart. renderFloor/renderMarker
// cover every tile type the registries define; animate() drives the shared
// pulsing materials (electrified water, fire).
import { TILE_TYPES } from './data/tiles.js';
import { SURFACES, ELECTRIFIED, FIRE } from './data/surfaces.js';
import { makeMaterial, makeSpriteMaterial } from './shading.js';
import { placeModel } from './models.js';
import { burst } from './fx.js';

const pc = window.pc;

// `root` (default app.root) parents everything drawn, so a layered level can
// show/hide a whole storey by toggling one entity; `baseY` lifts every world
// Y by the storey's base height. Flat levels pass neither and are untouched.
export function createTileRenderer(app, { root = null, baseY = 0 } = {}) {
  const parent = root || app.root;
  const floorDef = TILE_TYPES.floor;
  const surfaceTop = floorDef.height / 2 + 0.02;

  const tileMats = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) tileMats[id] = makeMaterial(def.color);
  // The exit glows a little - it should read as "the way out" from anywhere.
  tileMats.exit.emissive = new pc.Color(0.4, 0.31, 0.06);
  tileMats.exit.update();
  const wallGhost = makeMaterial(TILE_TYPES.wall.color, { opacity: 0.25 });
  // Full-size slabs with a few near-identical tints: surfaces read as
  // continuous carpet with subtle variation instead of a grid of tiles.
  // One set of tints per carpet color - tiles with a `carpet` field get
  // their own set, everything else shares the base floor's.
  const carpetMats = new Map();
  function floorMatsFor(type) {
    const def = TILE_TYPES[type];
    const key = def?.carpet ? type : 'floor';
    if (!carpetMats.has(key)) {
      const base = def?.carpet || TILE_TYPES.floor.color;
      carpetMats.set(key, [-1, 0, 1].map((i) =>
        makeMaterial(base.map((v) => Math.min(1, v + i * 0.018)))));
    }
    return carpetMats.get(key);
  }

  const surfaceMats = {};
  const ringMats = {}; // the darker damp edge under each liquid pool
  for (const [id, def] of Object.entries(SURFACES)) {
    surfaceMats[id] = makeMaterial(def.color, { gloss: 0.85, opacity: 0.88 });
    ringMats[id] = makeMaterial(def.color.map((v) => v * 0.5), { gloss: 0.25, opacity: 0.5 });
  }
  // A few near-identical paper tints so scattered sheets don't read as one flat
  // mass - some catch a little more light than others.
  const paperTints = [-0.04, 0, 0.035].map((d) =>
    makeMaterial(SURFACES.paper.color.map((v) => Math.min(1, v + d)), { gloss: 0.18 }));
  const electricMat = makeMaterial(ELECTRIFIED.color, { opacity: 0.92, gloss: 0.85, emissive: [0.25, 0.5, 0.65] });
  const fireMat = makeMaterial(FIRE.color, { opacity: 0.92, emissive: [0.9, 0.35, 0.05] });
  const fireCore = makeMaterial([1, 0.8, 0.3], { opacity: 0.95, emissive: [0.95, 0.7, 0.2] });
  // Smoke: a low, translucent grey cloud over a burnt-out tile. It blocks line
  // of sight for a couple of turns (the runtime owns that rule); here it's just
  // a few drifting lobes.
  const smokeMat = makeMaterial([0.36, 0.36, 0.4], { opacity: 0.4, gloss: 0.05 });
  const smokeVisuals = new Map(); // "x,z" -> { holder, puffs }
  const trashMat = makeMaterial(TILE_TYPES.trash.color, { gloss: 0.4 });
  const printerMat = makeMaterial(TILE_TYPES.printer.color, { gloss: 0.5 });
  const printerDark = makeMaterial([0.2, 0.2, 0.24], { gloss: 0.3 });
  const printerLight = makeMaterial([0.3, 0.9, 0.4], { gloss: 0.6, emissive: [0.1, 0.5, 0.15] });

  const addBox = (material, x, y, z, sx, sy, sz) => {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y + baseY, z);
    parent.addChild(e);
    return e;
  };

  // --- organic liquid pools ----------------------------------------------------
  // Spills used to be three stacked disks per tile, so multi-tile pools read
  // as a row of separate splats. Instead, every 'puddle' tile renders ITS
  // clip of a shared metaball field: each same-surface cell contributes a
  // blob, marching squares extracts the iso-contour inside this tile, and
  // because adjacent tiles evaluate the same field over the same sources,
  // patches meet exactly at tile borders - a multi-tile spill is one
  // continuous liquid shape, while hide/electrify/repaint stay per-tile.
  // Two layers per pool: a darker damp ring under the glossy liquid.
  // Per-cell hashes wobble radii and lobes so no two spills repeat. Pools
  // stay inside their painted tiles (the hazard is tile-keyed - the visual
  // must not overpromise) and merge orthogonally, like conduction pools.
  const POOL_SIGMA2 = 0.3; // blob falloff: w * exp(-d^2 / (SIGMA2 * wobble))
  const POOL_ISO_LIQUID = 0.587; // lone-cell liquid radius ~0.40
  const POOL_ISO_RING = 0.509; // lone-cell damp-ring radius ~0.45
  const POOL_STEPS = 12; // marching-squares resolution per tile

  const hash01 = (x, z, salt) => {
    const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };

  // Every same-surface cell near (x, z) that can shape this tile's patch.
  // The 5x5 window plus the distance cutoff in poolFieldAt guarantee two
  // adjacent tiles agree on every source that matters at their shared edge.
  function poolSources(x, z, surfId, surfaceAt) {
    const sources = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const sx = x + dx;
        const sz = z + dz;
        if (!(dx === 0 && dz === 0) && (!surfaceAt || surfaceAt(sx, sz) !== surfId)) continue;
        sources.push({
          x: sx,
          z: sz,
          w: 0.92 + 0.22 * hash01(sx, sz, 1),
          p1: hash01(sx, sz, 2) * Math.PI * 2,
          p2: hash01(sx, sz, 3) * Math.PI * 2,
        });
      }
    }
    return sources;
  }

  function poolFieldAt(sources, px, pz) {
    let f = 0;
    for (const s of sources) {
      const dx = px - s.x;
      const dz = pz - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 2.6) continue;
      const a = Math.atan2(dz, dx);
      const wobble = 1 + 0.1 * Math.sin(3 * a + s.p1) + 0.05 * Math.sin(5 * a + s.p2);
      f += s.w * Math.exp(-d2 / (POOL_SIGMA2 * wobble));
    }
    return f;
  }

  // Marching squares over this tile's unit square. Returns { positions,
  // indices } in tile-local coordinates, or null if the contour misses the
  // tile. Cells are walked around their perimeter keeping inside corners and
  // interpolated crossings, then fan-triangulated - handles all 16 cases.
  function poolPatchGeometry(x, z, sources, iso) {
    const N = POOL_STEPS;
    const F = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        F[j * (N + 1) + i] = poolFieldAt(sources, x - 0.5 + i / N, z - 0.5 + j / N);
      }
    }
    const positions = [];
    const indices = [];
    const vcache = new Map(); // shared vertices keep the sheet watertight
    const vert = (px, pz) => {
      const k = Math.round(px * 8192) + ',' + Math.round(pz * 8192);
      let idx = vcache.get(k);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(px, 0, pz);
        vcache.set(k, idx);
      }
      return idx;
    };
    const step = 1 / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([ci, cj]) => ({
          x: -0.5 + ci * step,
          z: -0.5 + cj * step,
          f: F[cj * (N + 1) + ci],
        }));
        const poly = [];
        for (let k = 0; k < 4; k++) {
          const a = corners[k];
          const b = corners[(k + 1) % 4];
          if (a.f >= iso) poly.push([a.x, a.z]);
          if ((a.f >= iso) !== (b.f >= iso)) {
            const t = (iso - a.f) / (b.f - a.f);
            poly.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
          }
        }
        for (let k = 2; k < poly.length; k++) {
          // reversed fan so the face normal points up (+y)
          indices.push(vert(...poly[0]), vert(...poly[k]), vert(...poly[k - 1]));
        }
      }
    }
    return indices.length ? { positions, indices } : null;
  }

  function addPoolLayer(parent, geo, material, y) {
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(geo.positions);
    const normals = new Array(geo.positions.length).fill(0);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    mesh.setNormals(normals);
    mesh.setIndices(geo.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const e = new pc.Entity();
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)] });
    e.render.castShadows = false;
    e.setLocalPosition(0, y, 0);
    parent.addChild(e);
  }

  function addPool(x, z, surfId, electrified, surfaceAt) {
    const sources = poolSources(x, z, surfId, surfaceAt);
    const holder = new pc.Entity();
    const ring = poolPatchGeometry(x, z, sources, POOL_ISO_RING);
    if (ring) addPoolLayer(holder, ring, ringMats[surfId], -0.01);
    const liquid = poolPatchGeometry(x, z, sources, POOL_ISO_LIQUID);
    if (liquid) addPoolLayer(holder, liquid, electrified ? electricMat : surfaceMats[surfId], 0);
    holder.setPosition(x, surfaceTop + baseY, z);
    parent.addChild(holder);
    return holder;
  }
  // A trodden gum wad: small pink blobs, mine-sized - easy to not notice.
  const gumMat = makeMaterial(SURFACES.gum.color, { gloss: 0.6 });
  function addGumWad(x, z) {
    const holder = new pc.Entity();
    for (const [ox, oz, s] of [[0, 0, 0.34], [0.14, 0.1, 0.2], [-0.13, 0.08, 0.16]]) {
      const b = new pc.Entity();
      b.addComponent('render', { type: 'sphere', material: gumMat });
      b.setLocalScale(s, s * 0.35, s);
      b.setLocalPosition(ox, 0, oz);
      holder.addChild(b);
    }
    holder.setEulerAngles(0, ((x * 47 + z * 113) % 8) * 45, 0);
    holder.setPosition(x, surfaceTop + baseY, z);
    parent.addChild(holder);
    return holder;
  }

  // Loose sheets, scattered. The old look stamped the SAME little stack on
  // every tile, so a multi-tile drift read as a row of identical clusters.
  // Instead each sheet gets its own hashed position (spread across the whole
  // tile and reaching the edges, so neighbouring paper tiles intermingle into
  // one spread), rotation, size and tint, and the count varies per tile - a
  // continuous mess of paper rather than repeated clusters. A per-tile base
  // height plus a tiny per-sheet rise keeps overlapping sheets from z-fighting.
  function addPaper(x, z) {
    const holder = new pc.Entity();
    const baseY = hash01(x, z, 50) * 0.014;
    const n = 6 + Math.floor(hash01(x, z, 99) * 3); // 6-8 sheets
    for (let i = 0; i < n; i++) {
      const ox = (hash01(x, z, i * 4 + 1) - 0.5) * 0.86;
      const oz = (hash01(x, z, i * 4 + 2) - 0.5) * 0.86;
      const ry = hash01(x, z, i * 4 + 3) * 360;
      const s = 0.24 + hash01(x, z, i * 4 + 4) * 0.15; // 0.24-0.39
      const e = new pc.Entity();
      e.addComponent('render', { type: 'box', material: paperTints[i % paperTints.length] });
      e.setLocalScale(s, 0.02, s * 0.74);
      e.setLocalPosition(ox, baseY + 0.006 * i, oz);
      e.setLocalEulerAngles(0, ry, 0);
      holder.addChild(e);
    }
    holder.setPosition(x, surfaceTop + baseY, z);
    parent.addChild(holder);
    return holder;
  }
  // A frayed power strip: dark bar plus a glowing live end.
  function addCable(x, z) {
    const holder = new pc.Entity();
    const bar = new pc.Entity();
    bar.addComponent('render', { type: 'box', material: surfaceMats.cable });
    bar.setLocalScale(0.85, 0.07, 0.2);
    holder.addChild(bar);
    const tip = new pc.Entity();
    tip.addComponent('render', { type: 'box', material: electricMat });
    tip.setLocalScale(0.14, 0.09, 0.14);
    tip.setLocalPosition(0.38, 0.01, 0);
    holder.addChild(tip);
    holder.setEulerAngles(0, ((x * 53 + z * 97) % 4) * 45 + 20, 0);
    holder.setPosition(x, surfaceTop + baseY, z);
    parent.addChild(holder);
    return holder;
  }
  function addTrash(x, z) {
    const holder = new pc.Entity();
    const can = new pc.Entity();
    can.addComponent('render', { type: 'cylinder', material: trashMat });
    can.setLocalScale(0.44, 0.5, 0.44);
    can.setLocalPosition(0, 0.25, 0);
    holder.addChild(can);
    const rim = new pc.Entity();
    rim.addComponent('render', { type: 'cylinder', material: trashMat });
    rim.setLocalScale(0.5, 0.05, 0.5);
    rim.setLocalPosition(0, 0.5, 0);
    holder.addChild(rim);
    holder.setPosition(x, floorDef.height / 2 + baseY, z);
    parent.addChild(holder);
    return holder;
  }
  function addPrinter(x, z) {
    const holder = new pc.Entity();
    const body = new pc.Entity();
    body.addComponent('render', { type: 'box', material: printerMat });
    body.setLocalScale(0.66, 0.4, 0.52);
    body.setLocalPosition(0, 0.2, 0);
    holder.addChild(body);
    const tray = new pc.Entity();
    tray.addComponent('render', { type: 'box', material: printerDark });
    tray.setLocalScale(0.5, 0.06, 0.3);
    tray.setLocalPosition(0, 0.44, -0.05);
    holder.addChild(tray);
    const light = new pc.Entity();
    light.addComponent('render', { type: 'box', material: printerLight });
    light.setLocalScale(0.07, 0.05, 0.05);
    light.setLocalPosition(0.24, 0.34, 0.27);
    holder.addChild(light);
    holder.setEulerAngles(0, ((x * 37 + z * 71) % 4) * 90, 0);
    holder.setPosition(x, floorDef.height / 2 + baseY, z);
    parent.addChild(holder);
    return holder;
  }

  // --- foliage cards -----------------------------------------------------------
  // Crossed sprite quads standing in a pot: the cheapest honest way to give a
  // plant volume, and the one the flat look can absorb (shading.makeSpriteMaterial
  // takes shape from the alpha and colour from the palette).
  //
  // Deliberately NOT run through placeModel's outline pass: the ink is an
  // inverted hull, and a hull around a rectangular card is a black rectangle
  // around the leaves rather than a line around the silhouette. Tiles and
  // props already skip the ink for their own reasons - this one has a sharper
  // one.
  //
  // `spec` is the tile def's `foliage` block:
  //   sprites  - one or more PNG names under assets/foliage/
  //   cards    - how many crossed quads (3 reads as a bush from any angle)
  //   size     - card width in tiles
  //   lift     - height of the card's CENTRE above the floor top
  //   tint     - flat colour the alpha is filled with
  //   spread   - how far off the tile centre the cards lean
  //   splay    - degrees each card leans out from vertical (see below)
  function addFoliage(x, z, spec) {
    const {
      sprites = ['bush'], cards = 3, size = 0.7, lift = 0.42,
      tint = [0.34, 0.6, 0.32], spread = 0.1, splay = 30,
    } = spec;
    const holder = new pc.Entity('foliage');
    for (let i = 0; i < cards; i++) {
      const name = sprites[i % sprites.length];
      const mat = makeSpriteMaterial(app, `assets/foliage/${name}.png`, tint);
      const e = new pc.Entity();
      e.addComponent('render', { type: 'plane', material: mat });
      e.render.castShadows = false;
      // A plane lies flat by default: stand it up, then fan the cards around
      // the stem. Per-cell hash keeps a row of shrubs from looking stamped
      // while staying identical between two renders of the same tile.
      //
      // SPLAYED, not upright: the camera looks down at 55 degrees (controls.js
      // CAM.pitch), so a dead-vertical card shows barely half its face and a
      // bush of them reads as flat sheets standing in a pot. Leaning each card
      // outward from the stem - the way leaves actually sit - turns the fan
      // into a cone that presents a face to a high camera from any yaw, and
      // costs nothing but this angle. The lean follows each card's own spin,
      // so the cone is even rather than one-sided.
      const spin = (i * 180) / cards + hash01(x, z, 30 + i) * 24;
      const lean = splay * (0.75 + hash01(x, z, 80 + i) * 0.5);
      e.setLocalEulerAngles(90 - lean, spin, 0);
      const a = (spin * Math.PI) / 180;
      e.setLocalPosition(
        Math.cos(a) * spread * (hash01(x, z, 40 + i) - 0.5) * 2,
        lift + (hash01(x, z, 50 + i) - 0.5) * 0.06,
        Math.sin(a) * spread * (hash01(x, z, 60 + i) - 0.5) * 2,
      );
      const s = size * (0.88 + hash01(x, z, 70 + i) * 0.24);
      e.setLocalScale(s, 1, s);
      holder.addChild(e);
    }
    holder.setPosition(x, floorDef.height / 2, z);
    app.root.addChild(holder);
    return holder;
  }

  function renderFloor(x, z, type = 'floor') {
    return addBox(floorMatsFor(type)[(x * 31 + z * 17) % 3], x, 0, z, 1, floorDef.height, 1);
  }

  // One cell's slice of a generated staircase (layered levels): solid steps
  // rising through this tile's share of the climb toward (dx, dz). `idx` of
  // `run` places the slice within the whole flight, so a 3-cell run reads as
  // one continuous stair from its entry's floor to the landing's. Solid
  // boxes from the ground up - a flight you can't see under, like poured
  // concrete, which also hides the joint where it meets the upper slab.
  const STAIR_STEPS = 4;
  function renderStair(x, z, dx, dz, rise, idx = 0, run = 1) {
    const out = [];
    for (let s = 0; s < STAIR_STEPS; s++) {
      const frac = (idx * STAIR_STEPS + s + 1) / (run * STAIR_STEPS);
      const top = floorDef.height / 2 + rise * frac;
      const along = -0.5 + (s + 0.5) / STAIR_STEPS;
      out.push(addBox(tileMats.stairway, x + dx * along, top / 2, z + dz * along,
        dx ? 1 / STAIR_STEPS + 0.02 : 0.98, top, dz ? 1 / STAIR_STEPS + 0.02 : 0.98));
    }
    return out;
  }

  // Edge walls: thin partitions BETWEEN tiles (see grid.js). 'h' sits on the
  // north edge of (x, z), 'v' on the west edge. Slightly overlong so runs and
  // corners merge into continuous walls.
  const EDGE_HEIGHT = 0.72;
  const EDGE_THICK = 0.12;
  function renderEdgeWall(x, z, orient) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material: tileMats.wall });
    if (orient === 'h') {
      e.setLocalScale(1 + EDGE_THICK, EDGE_HEIGHT, EDGE_THICK);
      e.setPosition(x, EDGE_HEIGHT / 2 + baseY, z - 0.5);
    } else {
      e.setLocalScale(EDGE_THICK, EDGE_HEIGHT, 1 + EDGE_THICK);
      e.setPosition(x - 0.5, EDGE_HEIGHT / 2 + baseY, z);
    }
    parent.addChild(e);
    return e;
  }

  // Doors: office-wood panels on an edge, hinged at one end. Closed spans the
  // doorway; open swings 100 degrees clear of it. Returns { holder, panel } -
  // the panel is the single render entity the fade system swaps materials on.
  const doorMat = makeMaterial([0.52, 0.35, 0.2], { gloss: 0.35 });
  const doorGhost = makeMaterial([0.52, 0.35, 0.2], { gloss: 0.35, opacity: 0.25 });
  const knobMat = makeMaterial([0.85, 0.72, 0.35], { gloss: 0.8 });
  const DOOR_HEIGHT = 0.8;
  function renderDoor(x, z, orient, open) {
    const holder = new pc.Entity(); // sits at the hinge end of the edge
    const panel = new pc.Entity();
    panel.addComponent('render', { type: 'box', material: doorMat });
    panel.setLocalScale(0.92, DOOR_HEIGHT, 0.09);
    panel.setLocalPosition(0.48, DOOR_HEIGHT / 2, 0);
    holder.addChild(panel);
    const knob = new pc.Entity();
    knob.addComponent('render', { type: 'sphere', material: knobMat });
    knob.setLocalScale(0.07, 0.07, 0.07);
    knob.setLocalPosition(0.82, DOOR_HEIGHT * 0.55, 0.06);
    holder.addChild(knob);
    // Hinge at the west/north end of the edge; open swings into the room.
    if (orient === 'h') {
      holder.setPosition(x - 0.5, baseY, z - 0.5);
      holder.setEulerAngles(0, open ? 100 : 0, 0);
    } else {
      holder.setPosition(x - 0.5, baseY, z - 0.5);
      holder.setEulerAngles(0, open ? -10 : -90, 0);
    }
    parent.addChild(holder);
    return { holder, panel };
  }

  // Draw whatever sits on top of the floor for a non-floor tile type.
  // Returns { kind, entities }; model props arrive via onAsync(holder).
  // `surfaceAt(x, z)` (optional) reports the surface id of any cell so
  // liquid pools can merge with their same-surface neighbours.
  function renderMarker(x, z, type, { electrified = false, onAsync = null, surfaceAt = null, rotY = null } = {}) {
    const def = TILE_TYPES[type];
    if (!def) return { kind: 'none', entities: [] };
    // Carpet variants ARE the floor - renderFloor already drew them recolored.
    if (def.carpet) return { kind: 'none', entities: [] };
    if (def.model) {
      placeModel(app, `assets/${def.model}.glb`, x, z, {
        // Models parent to app.root inside placeModel, so they sit outside a
        // storey's show/hide root - keep model props off upper storeys until
        // the layered builder owns their parenting.
        // A per-PLACEMENT rotation wins over the type's own (grid.rotAt).
        scale: def.scale || 1, rotY: rotY ?? def.rotY ?? 0, lift: floorDef.height / 2 + baseY,
        // A toppled prop lies over (POWERS_PLAN M6). Data, so a new fallen
        // twin is a registry entry rather than a renderer change.
        tiltX: def.tiltX || 0, tiltZ: def.tiltZ || 0,
        onReady: (holder) => onAsync && onAsync(holder),
      });
      // A prop can wear FOLIAGE on top of its model (`def.foliage`) - sprite
      // cards that bulk a small pot into something a person can duck behind.
      // Registry data, so a new shrub is an entry rather than a renderer
      // change, and it composes with any model.
      const leaves = def.foliage ? addFoliage(x, z, def.foliage) : null;
      return { kind: 'model', entities: leaves ? [leaves] : [] };
    }
    if (def.primitive) {
      const builder = { trash: addTrash, printer: addPrinter }[def.primitive];
      return { kind: 'prop', entities: builder ? [builder(x, z)] : [] };
    }
    if (def.surface) {
      const surf = SURFACES[def.surface];
      let vis;
      if (surf.style === 'cable') vis = addCable(x, z);
      else if (surf.style === 'paper') vis = addPaper(x, z);
      else if (surf.style === 'gum') vis = addGumWad(x, z);
      else vis = addPool(x, z, def.surface, electrified, surfaceAt);
      return { kind: 'surface', entities: [vis] };
    }
    if (def.solid) {
      // Full-size so adjacent walls merge into continuous surfaces.
      return { kind: 'wall', entities: [addBox(tileMats[type], x, def.height / 2, z, 1, def.height, 1)] };
    }
    // A flat runtime remnant (the toppled partition): a thin slab laid ON the
    // floor's top face. The plain marker box below draws from GROUND level
    // up, so anything thinner than the floor slab would top out inside the
    // carpet and render invisible.
    if (def.onFloor) {
      return {
        kind: 'marker',
        entities: [addBox(tileMats[type], x, floorDef.height / 2 + def.height / 2, z, 0.94, def.height, 0.94)],
      };
    }
    return { kind: 'marker', entities: [addBox(tileMats[type], x, def.height / 2, z, 1, def.height, 1)] };
  }

  // The way out gets a beacon: the exit tile already glows a little (its
  // emissive tint, above), and a slow column of motes off the stairwell is
  // what makes it findable across a dim floor plate - the one piece of
  // information the whole game is about. Registered by the level builder
  // (scene.js), not by renderMarker: the EDITOR repaints cells constantly, and
  // a per-render registration would stack an emitter per repaint and keep one
  // burning over an exit that had been erased.
  const exits = [];
  const addExitBeacon = (x, z) => exits.push({ x, z });
  let exitClock = 0;
  const EXIT_INTERVAL = 0.4;
  function shedExitMotes(dt) {
    if (!exits.length) return;
    exitClock += dt;
    if (exitClock < EXIT_INTERVAL) return;
    exitClock = 0;
    for (const e of exits) {
      burst(app, { x: e.x, y: floorDef.height / 2 + 0.1 + baseY, z: e.z }, {
        count: 1, color: [1, 0.85, 0.35], speed: 0.16, up: 0.9, upVar: 0.3,
        size: 0.09, life: 1.7, lifeVar: 0.2, gravity: 0, drag: 0.2,
        jitter: 0.34, floor: false,
      });
    }
  }

  // Every live flame is registered so animate() can shed embers from it. The
  // cones alone read as a decal at this camera distance; what says "fire" is
  // the ash going up. Entries prune themselves when the runtime destroys the
  // holder (a destroyed entity has no parent).
  const flames = [];
  let emberClock = 0;

  function addFlame(x, z, lift = 0.16) {
    const holder = new pc.Entity();
    const outer = new pc.Entity();
    outer.addComponent('render', { type: 'cone', material: fireMat });
    outer.setLocalScale(0.5, 0.62, 0.5);
    outer.setLocalPosition(0, 0.3, 0);
    holder.addChild(outer);
    const inner = new pc.Entity();
    inner.addComponent('render', { type: 'cone', material: fireCore });
    inner.setLocalScale(0.26, 0.42, 0.26);
    inner.setLocalPosition(0.04, 0.24, 0.03);
    holder.addChild(inner);
    holder.setPosition(x, floorDef.height / 2 + lift + baseY, z);
    parent.addChild(holder);
    flames.push({ x, z, lift, holder });
    return holder;
  }

  // A drifting smoke puff over a burnt tile - a few translucent lobes that bob
  // (animate() drives the bob). Keyed by cell so the runtime can clear it.
  function addSmoke(x, z) {
    const k = x + ',' + z;
    if (smokeVisuals.has(k)) return smokeVisuals.get(k).holder;
    const holder = new pc.Entity();
    const puffs = [];
    const lobes = [[0, 0.55, 0, 0.52], [0.24, 0.66, 0.12, 0.36], [-0.22, 0.62, -0.12, 0.32], [0.06, 0.82, -0.16, 0.28]];
    for (const [ox, oy, oz, s] of lobes) {
      const p = new pc.Entity();
      p.addComponent('render', { type: 'sphere', material: smokeMat });
      p.render.castShadows = false;
      p.setLocalScale(s, s * 0.8, s);
      p.setLocalPosition(ox, oy, oz);
      holder.addChild(p);
      puffs.push({ e: p, baseY: oy, phase: x * 12.9 + z * 7.7 + puffs.length * 2.1 });
    }
    holder.setPosition(x, floorDef.height / 2 + baseY, z);
    parent.addChild(holder);
    smokeVisuals.set(k, { holder, puffs });
    return holder;
  }
  function removeSmoke(x, z) {
    const k = x + ',' + z;
    const s = smokeVisuals.get(k);
    if (s) { s.holder.destroy(); smokeVisuals.delete(k); }
  }

  // Embers and soot off every burning cell. Deliberately sparse (a couple of
  // motes a cell per emission at ~7Hz): a room-wide fire is a dozen cells, and
  // the point is drifting light, not a smoke machine.
  const EMBER_INTERVAL = 0.14;
  function shedEmbers(dt) {
    if (!flames.length) return;
    emberClock += dt;
    if (emberClock < EMBER_INTERVAL) return;
    emberClock = 0;
    for (let i = flames.length - 1; i >= 0; i--) {
      const f = flames[i];
      if (!f.holder.parent) { flames.splice(i, 1); continue; }
      const y = floorDef.height / 2 + f.lift + 0.35 + baseY;
      burst(app, { x: f.x, y, z: f.z }, {
        count: 1, color: [1, 0.6, 0.18], speed: 0.35, up: 1.5, upVar: 0.5,
        size: 0.09, life: 1, lifeVar: 0.3, gravity: 0.9, drag: 1.1,
        jitter: 0.22, floor: false,
      });
      if (Math.random() < 0.4) {
        burst(app, { x: f.x, y: y + 0.2, z: f.z }, {
          count: 1, color: [0.3, 0.29, 0.3], additive: false, speed: 0.3,
          up: 1.2, size: 0.16, life: 1.3, gravity: 0.7, drag: 1.3, grow: 1.5,
          jitter: 0.25, floor: false,
        });
      }
    }
  }

  // A brief expanding toner-cloud boom.
  function explosionFlash(x, z) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'sphere', material: fireCore });
    e.setPosition(x, 0.5 + baseY, z);
    parent.addChild(e);
    burst(app, { x, y: 0.5 + baseY, z }, {
      count: 10, color: [1, 0.7, 0.25], speed: 5.5, up: 2.4, size: 0.14,
      life: 0.45, gravity: -7, drag: 0.8,
    });
    let t = 0;
    const anim = (dt) => {
      t += dt;
      const s = 0.4 + t * 6;
      e.setLocalScale(s, s, s);
      if (t > 0.45) {
        app.off('update', anim);
        e.destroy();
      }
    };
    app.on('update', anim);
  }

  // Live water crackles and fire flickers: pulse the shared materials.
  let clock = 0;
  function animate(dt) {
    clock += dt;
    const pulse = 0.45 + 0.35 * Math.sin(clock * 7) + 0.12 * Math.sin(clock * 23);
    electricMat.emissiveIntensity = Math.max(0.15, pulse);
    fireMat.emissiveIntensity = 0.75 + 0.3 * Math.sin(clock * 11) + 0.15 * Math.sin(clock * 29);
    fireCore.emissiveIntensity = 0.85 + 0.25 * Math.sin(clock * 17 + 1);
    for (const { puffs } of smokeVisuals.values()) {
      for (const pf of puffs) {
        const p = pf.e.getLocalPosition();
        pf.e.setLocalPosition(p.x, pf.baseY + 0.05 * Math.sin(clock * 1.4 + pf.phase), p.z);
      }
    }
    shedEmbers(dt);
    shedExitMotes(dt);
  }

  return {
    renderFloor, renderMarker, renderEdgeWall, renderDoor, renderStair, addFlame, explosionFlash, animate,
    addExitBeacon,
    addSmoke, removeSmoke,
    tileMats, wallGhost, doorMat, doorGhost, floorHeight: floorDef.height,
    // World Y of the top face of an edge wall / a door panel. The occlusion
    // fade needs these to tell whether the sightline clears the thing.
    edgeWallTop: EDGE_HEIGHT, doorTop: DOOR_HEIGHT,
  };
}

// Carpet flows under items: a desk inside the meeting room should sit on
// meeting-room carpet, not punch a gray hole in the zone. Seed from the
// carpet tiles themselves, then let every non-plain-floor tile inherit the
// most common carpet among its 4-neighbours for a few passes, so multi-tile
// furniture clusters resolve from their edges inward. Plain floor never
// inherits - zone borders stay where the level painted them. Shared by the
// game (buildLevel) and the editor, so both show the same floors.
// `typeAt(x, z)` -> tile type id or null for void; returns "x,z" -> type.
export function computeCarpetZones(typeAt, width, height) {
  const carpetAt = new Map();
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const t = typeAt(x, z);
      if (t && TILE_TYPES[t]?.carpet) carpetAt.set(x + ',' + z, t);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const found = [];
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const key = x + ',' + z;
        const t = typeAt(x, z);
        if (t === null || t === 'floor' || carpetAt.has(key)) continue;
        const counts = new Map();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = carpetAt.get((x + dx) + ',' + (z + dz));
          if (n) counts.set(n, (counts.get(n) || 0) + 1);
        }
        let best = null;
        for (const [n, c] of counts) if (!best || c > counts.get(best)) best = n;
        if (best) found.push([key, best]);
      }
    }
    if (!found.length) break;
    for (const [key, t] of found) carpetAt.set(key, t);
  }
  return carpetAt;
}

// A dropped/loose item on the floor: a little manila parcel, hash-rotated so
// piles don't align. The Alt loot overlay labels it; clicking picks it up.
let droppedMat = null;
export function placeDroppedItem(app, x, z) {
  if (!droppedMat) droppedMat = makeMaterial([0.85, 0.76, 0.55], { gloss: 0.3 });
  const e = new pc.Entity();
  e.addComponent('render', { type: 'box', material: droppedMat });
  e.setLocalScale(0.26, 0.14, 0.2);
  const h = Math.sin(x * 91.7 + z * 57.3) * 43758.5453;
  e.setEulerAngles(0, (h - Math.floor(h)) * 360, 0);
  e.setPosition(x, TILE_TYPES.floor.height / 2 + 0.07, z); // resting on the floor top
  app.root.addChild(e);
  return e;
}
