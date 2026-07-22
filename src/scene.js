// Everything that touches the PlayCanvas scene graph: engine boot, lighting,
// tile/surface/prop rendering, the occlusion fade, and model loading.
//
// All tile visuals go through ONE renderer (createTileRenderer) used by both
// the game (buildLevel) and the level editor - they draw from the same data
// registries through the same code, so they cannot drift apart.
import { TILE_TYPES } from './data/tiles.js';
import { SURFACES, ELECTRIFIED, FIRE } from './data/surfaces.js';

const pc = window.pc;

export function createApp(canvas) {
  const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { antialias: true, alpha: false },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  window.addEventListener('resize', () => app.resizeCanvas());

  // Office lighting, split across two directionals: an angled key light does
  // the shading (toon bands need side/top contrast) but casts NO shadows,
  // while a near-vertical "ceiling" light owns the shadows - overhead office
  // lights pool shadows at your feet, they don't rake them across the carpet
  // like a sunset. Ambient stays low and slightly cool for band contrast.
  app.scene.ambientLight = new pc.Color(0.44, 0.46, 0.56);
  const key = new pc.Entity('key-light');
  key.addComponent('light', { type: 'directional', intensity: 1.0, castShadows: false });
  key.setEulerAngles(55, 35, 0);
  app.root.addChild(key);
  const ceiling = new pc.Entity('ceiling-light');
  ceiling.addComponent('light', {
    type: 'directional',
    intensity: 0.5,
    castShadows: true,
    shadowResolution: 2048,
    shadowDistance: 70,
    shadowBias: 0.2,
    normalOffsetBias: 0.06,
  });
  ceiling.setEulerAngles(84, 35, 0);
  app.root.addChild(ceiling);
  return app;
}

// Cel shading: replace the lambert term so each light's contribution snaps to
// a few discrete bands (with a whisker of smoothstep so band edges don't
// shimmer, and a sliver of the raw term so faces inside one band keep a hint
// of modeling). The world is mostly flat-shaded boxes, so in practice every
// face lands cleanly on one band - a graphic, toon-flat look instead of soft
// gradients.
const TOON_CHUNK = `
float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
    float d = max(dot(worldNormal, -lightDirNorm), 0.0);
    float x = d * 3.0;
    float banded = min((floor(x) + smoothstep(0.42, 0.58, fract(x))) / 3.0, 1.0);
    return banded * 0.85 + d * 0.15;
}`;

const toonified = new WeakSet();
function toonifyMaterial(m) {
  if (toonified.has(m)) return;
  toonified.add(m);
  m.shaderChunks.glsl.set('lightDiffuseLambertPS', TOON_CHUNK);
  m.update();
}

// Apply the toon ramp to everything a loaded model renders with. Materials
// are shared per-asset, so the WeakSet keeps repeat placements from
// rebuilding shaders. Per-character damage-flash clones inherit the chunk
// through Material.copy.
function toonifyEntity(entity) {
  for (const rc of entity.findComponents('render')) {
    for (const mi of rc.meshInstances) toonifyMaterial(mi.material);
  }
}

// Ink outlines, inverted-hull style: every .glb model is drawn a second time
// with its vertices pushed out along their normals and front faces culled, in
// flat black - only the silhouette shell survives, reading as a drawn ink
// line. The copies share the originals' skin instances so they track skeletal
// animation for free. Tiles and walls stay clean (their SSAO edge does that
// work) - the ink belongs on characters and furniture.
//
// The custom transformVS chunk inflates in world space. It runs before the
// normal chunks in the assembled shader, so the normal helpers are forward-
// declared (their definitions arrive later from normalCoreVS/normalVS, which
// exist whenever NORMALS is defined - true for this lit material's forward
// pass; shadow/depth variants compile the un-inflated fallback).
const OUTLINE_TRANSFORM_CHUNK = `
#ifdef NORMALS
vec3 getLocalNormal(vec3 vertexNormal);
mat3 getNormalMatrix(mat4 modelMatrix);
#endif
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
    vec4 posW = modelMatrix * vec4(getLocalPosition(vertexPosition), 1.0);
#ifdef NORMALS
    vec3 worldN = normalize(getNormalMatrix(modelMatrix) * getLocalNormal(vec3(0.0)));
    posW.xyz += worldN * 0.012;
#endif
    return posW;
}
vec4 getPosition() {
    dModelMatrix = getModelMatrix();
    vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
    dPositionW = posW.xyz;
    return matrix_viewProjection * posW;
}
vec3 getWorldPosition() {
    return dPositionW;
}
`;

let outlineMat = null;
function getOutlineMat() {
  if (outlineMat) return outlineMat;
  outlineMat = new pc.StandardMaterial();
  outlineMat.diffuse = new pc.Color(0, 0, 0);
  outlineMat.specular = new pc.Color(0, 0, 0);
  outlineMat.gloss = 0;
  outlineMat.cull = pc.CULLFACE_FRONT;
  outlineMat.shaderChunks.glsl.set('transformVS', OUTLINE_TRANSFORM_CHUNK);
  outlineMat.update();
  return outlineMat;
}

function addOutlines(holder) {
  const mat = getOutlineMat();
  const copies = [];
  for (const rc of holder.findComponents('render')) {
    for (const mi of rc.meshInstances) {
      if (mi.material === mat) continue;
      const omi = new pc.MeshInstance(mi.mesh, mat, mi.node);
      if (mi.skinInstance) omi.skinInstance = mi.skinInstance;
      copies.push(omi);
    }
  }
  if (!copies.length) return;
  // A sibling render component, NOT appended to the original's meshInstances:
  // that setter destroys the instances it replaces.
  const shell = new pc.Entity('outlines');
  shell.addComponent('render', { meshInstances: copies, castShadows: false });
  holder.addChild(shell);
}

// The character .glbs ship with a full baked clip set (idle, walk, attacks,
// die, sit...). Wire the ones the game drives into an anim component with an
// auto-generated state graph - actors switch states via GridActor.setClip.
// First assignment ('idle') becomes the initial state.
const ACTOR_CLIPS = ['idle', 'walk', 'attack-melee-right'];
function setupAnim(inst, asset) {
  const tracks = {};
  for (const a of asset.resource.animations) {
    if (a.resource) tracks[a.resource.name] = a.resource;
  }
  if (!tracks.idle) return;
  inst.addComponent('anim', { activate: true });
  for (const name of ACTOR_CLIPS) {
    if (tracks[name]) inst.anim.assignAnimation(name, tracks[name]);
  }
}

// Post stack on the game camera (also used by the editor - controls.js calls
// this wherever the camera rig is built). SSAO grounds props and walls with
// contact shading the flat toon lighting can't provide, a whisper of bloom
// makes the emissives (exit, fire, sparks) glow, and the grade adds the
// saturation and warmth the toon bands need to read.
export function applyCameraPostFx(app, cameraEntity) {
  const frame = new pc.CameraFrame(app, cameraEntity.camera);
  frame.rendering.samples = 4; // keep MSAA through the post pipeline
  frame.ssao.type = pc.SSAOTYPE_COMBINE;
  frame.ssao.intensity = 0.4;
  frame.ssao.radius = 9;
  frame.ssao.power = 5;
  frame.bloom.intensity = 0.02;
  frame.grading.enabled = true;
  frame.grading.contrast = 1.06;
  frame.grading.saturation = 1.18;
  frame.vignette.intensity = 0.5;
  frame.vignette.inner = 0.55;
  frame.vignette.outer = 1.35;
  frame.vignette.curvature = 0.6;
  frame.update();
  return frame;
}

function makeMaterial(rgb, { opacity = 1, gloss = null, emissive = null } = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
  if (gloss !== null) m.gloss = gloss;
  if (opacity < 1) {
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (emissive) m.emissive = new pc.Color(emissive[0], emissive[1], emissive[2]);
  toonifyMaterial(m);
  return m;
}

// The single source of tile visuals. renderFloor/renderMarker cover every
// tile type the registries define; animate() drives the shared pulsing
// materials (electrified water, fire).
export function createTileRenderer(app) {
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
  const paperMat = makeMaterial(SURFACES.paper.color, { gloss: 0.2 });
  const electricMat = makeMaterial(ELECTRIFIED.color, { opacity: 0.92, gloss: 0.85, emissive: [0.25, 0.5, 0.65] });
  const fireMat = makeMaterial(FIRE.color, { opacity: 0.92, emissive: [0.9, 0.35, 0.05] });
  const fireCore = makeMaterial([1, 0.8, 0.3], { opacity: 0.95, emissive: [0.95, 0.7, 0.2] });
  const trashMat = makeMaterial(TILE_TYPES.trash.color, { gloss: 0.4 });
  const printerMat = makeMaterial(TILE_TYPES.printer.color, { gloss: 0.5 });
  const printerDark = makeMaterial([0.2, 0.2, 0.24], { gloss: 0.3 });
  const printerLight = makeMaterial([0.3, 0.9, 0.4], { gloss: 0.6, emissive: [0.1, 0.5, 0.15] });

  const addBox = (material, x, y, z, sx, sy, sz) => {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y, z);
    app.root.addChild(e);
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
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
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
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
    return holder;
  }

  // Scattered sheets: thin pale rectangles at odd angles.
  function addPaper(x, z) {
    const holder = new pc.Entity();
    for (const [ox, oz, ry, s] of [[0, 0, 15, 0.42], [0.2, 0.16, 70, 0.34], [-0.18, -0.1, 40, 0.3], [-0.05, 0.22, 110, 0.28]]) {
      const e = new pc.Entity();
      e.addComponent('render', { type: 'box', material: paperMat });
      e.setLocalScale(s, 0.02, s * 0.72);
      e.setLocalPosition(ox, 0, oz);
      e.setLocalEulerAngles(0, ry, 0);
      holder.addChild(e);
    }
    holder.setEulerAngles(0, ((x * 61 + z * 89) % 8) * 45, 0);
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
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
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
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
    holder.setPosition(x, floorDef.height / 2, z);
    app.root.addChild(holder);
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
    holder.setPosition(x, floorDef.height / 2, z);
    app.root.addChild(holder);
    return holder;
  }

  function renderFloor(x, z, type = 'floor') {
    return addBox(floorMatsFor(type)[(x * 31 + z * 17) % 3], x, 0, z, 1, floorDef.height, 1);
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
      e.setPosition(x, EDGE_HEIGHT / 2, z - 0.5);
    } else {
      e.setLocalScale(EDGE_THICK, EDGE_HEIGHT, 1 + EDGE_THICK);
      e.setPosition(x - 0.5, EDGE_HEIGHT / 2, z);
    }
    app.root.addChild(e);
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
      holder.setPosition(x - 0.5, 0, z - 0.5);
      holder.setEulerAngles(0, open ? 100 : 0, 0);
    } else {
      holder.setPosition(x - 0.5, 0, z - 0.5);
      holder.setEulerAngles(0, open ? -10 : -90, 0);
    }
    app.root.addChild(holder);
    return { holder, panel };
  }

  // Draw whatever sits on top of the floor for a non-floor tile type.
  // Returns { kind, entities }; model props arrive via onAsync(holder).
  // `surfaceAt(x, z)` (optional) reports the surface id of any cell so
  // liquid pools can merge with their same-surface neighbours.
  function renderMarker(x, z, type, { electrified = false, onAsync = null, surfaceAt = null } = {}) {
    const def = TILE_TYPES[type];
    if (!def) return { kind: 'none', entities: [] };
    // Carpet variants ARE the floor - renderFloor already drew them recolored.
    if (def.carpet) return { kind: 'none', entities: [] };
    if (def.model) {
      placeModel(app, `assets/${def.model}.glb`, x, z, {
        scale: def.scale || 1, rotY: def.rotY || 0, lift: floorDef.height / 2,
        onReady: (holder) => onAsync && onAsync(holder),
      });
      return { kind: 'model', entities: [] };
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
    return { kind: 'marker', entities: [addBox(tileMats[type], x, def.height / 2, z, 1, def.height, 1)] };
  }

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
    holder.setPosition(x, floorDef.height / 2 + lift, z);
    app.root.addChild(holder);
    return holder;
  }

  // A brief expanding toner-cloud boom.
  function explosionFlash(x, z) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'sphere', material: fireCore });
    e.setPosition(x, 0.5, z);
    app.root.addChild(e);
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
  }

  return {
    renderFloor, renderMarker, renderEdgeWall, renderDoor, addFlame, explosionFlash, animate,
    tileMats, wallGhost, doorMat, doorGhost, floorHeight: floorDef.height,
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

// Builds the full scene for a parsed grid using the shared renderer. Returns
// the wall list, the occlusion-fade updater, and runtime hooks.
export function buildLevel(app, grid) {
  const r = createTileRenderer(app);
  const walls = [];
  const surfaceVisuals = new Map(); // "x,z" -> entity
  const propVisuals = new Map();

  const carpetAt = computeCarpetZones(grid.typeAt, grid.width, grid.height);

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      r.renderFloor(x, z, carpetAt.get(x + ',' + z) || type);
      if (type === 'floor') continue;
      const res = r.renderMarker(x, z, type, {
        electrified: grid.isElectrified(x, z),
        surfaceAt: (sx, sz) => TILE_TYPES[grid.typeAt(sx, sz)]?.surface || null,
      });
      if (res.kind === 'wall') walls.push({ entity: res.entities[0], x, z, faded: false });
      else if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
      else if (res.kind === 'prop') propVisuals.set(x + ',' + z, res.entities[0]);
    }
  }
  // Edge walls (partitions between tiles) join the same fade list, keyed by
  // their world-space centre.
  for (const k of grid.hWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'h'), x, z: z - 0.5, faded: false });
  }
  for (const k of grid.vWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'v'), x: x - 0.5, z, faded: false });
  }

  // Doors: rendered from grid state and re-rendered whenever one toggles.
  // Their panel joins the fade list with door materials.
  const doorVisuals = new Map(); // door key -> { holder, wallEntry }
  function renderDoorAt(key) {
    const old = doorVisuals.get(key);
    if (old) {
      old.holder.destroy();
      walls.splice(walls.indexOf(old.wallEntry), 1);
    }
    const [orient, coords] = [key[0], key.slice(2)];
    const [x, z] = coords.split(',').map(Number);
    const { holder, panel } = r.renderDoor(x, z, orient, grid.doors.get(key).open);
    const wallEntry = {
      entity: panel,
      x: orient === 'v' ? x - 0.5 : x,
      z: orient === 'h' ? z - 0.5 : z,
      faded: false,
      solidMat: r.doorMat,
      ghostMat: r.doorGhost,
    };
    walls.push(wallEntry);
    doorVisuals.set(key, { holder, wallEntry });
  }
  for (const key of grid.doors.keys()) renderDoorAt(key);

  // Fade walls sitting between the camera and the player - the "toward the
  // camera" direction is the actual player->camera ray.
  function updateWallFade(cameraEntity, playerPos) {
    if (!playerPos) return;
    const cam = cameraEntity.getPosition();
    let dx = cam.x - playerPos.x;
    let dz = cam.z - playerPos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    for (const w of walls) {
      const vx = w.x - playerPos.x;
      const vz = w.z - playerPos.z;
      const t = vx * dx + vz * dz;
      const px = vx - t * dx;
      const pz = vz - t * dz;
      const shouldFade = t > 0.3 && Math.hypot(px, pz) < 1.15;
      if (shouldFade !== w.faded) {
        w.faded = shouldFade;
        w.entity.render.meshInstances[0].material = shouldFade
          ? (w.ghostMat || r.wallGhost)
          : (w.solidMat || r.tileMats.wall);
      }
    }
  }

  function hideSurfaceVisual(x, z) {
    const v = surfaceVisuals.get(x + ',' + z);
    if (v) {
      v.destroy();
      surfaceVisuals.delete(x + ',' + z);
    }
  }
  function removePropVisual(x, z) {
    const v = propVisuals.get(x + ',' + z);
    if (v) {
      v.destroy();
      propVisuals.delete(x + ',' + z);
    }
  }

  return {
    walls, updateWallFade, animateSurfaces: r.animate,
    addFlame: r.addFlame, explosionFlash: r.explosionFlash,
    hideSurfaceVisual, removePropVisual,
    refreshDoor: renderDoorAt,
    floorHeight: r.floorHeight,
  };
}

// Load a .glb, wrap it in a holder (so scaling/rotating is predictable), and
// drop it on a tile. Reusable for every prop and character.
export function placeModel(app, url, tileX, tileZ, { scale = 1, lift = 0.1, rotY = 0, onReady = null, animate = false } = {}) {
  // Reuse the asset if this .glb was already requested (props repeat a lot,
  // and the editor repaints cells constantly).
  let asset = app.assets.find(url);
  if (!asset) {
    asset = new pc.Asset(url, 'container', { url });
    app.assets.add(asset);
  }
  asset.ready(() => {
    const holder = new pc.Entity(url);
    const inst = asset.resource.instantiateRenderEntity();
    holder.addChild(inst);
    toonifyEntity(holder);
    addOutlines(holder);
    if (animate) setupAnim(inst, asset);
    holder.setLocalScale(scale, scale, scale);
    holder.setEulerAngles(0, rotY, 0);
    holder.setPosition(tileX, lift, tileZ);
    app.root.addChild(holder);
    if (onReady) onReady(holder);
  });
  asset.on('error', (err) => console.warn('asset load failed:', url, err));
  app.assets.load(asset);
}

// De-chibi the Kenney mini rigs. Every character shares the same 7-bone
// skeleton (root -> leg-left/leg-right + torso -> arm-left/arm-right + head)
// with no knees or elbows, so proportions are retuned by scaling bones:
// legs and torso stretch, the head shrinks back toward realistic. Legs are
// single rigid bones hip-to-foot - keep `legs` modest (~1.3) or the straight
// leg starts to read as stilts when it swings.
const PROPORTIONS = { legs: 1.45, torso: 1.18, head: 0.8, arms: 0.7 };

export function applyCharacterProportions(holder) {
  const root = holder.findByName('root');
  const legL = holder.findByName('leg-left');
  const legR = holder.findByName('leg-right');
  const torso = holder.findByName('torso');
  if (!root || !legL || !torso) return; // not a rigged mini character
  const { legs, torso: torsoS, head: headS, arms: armsS } = PROPORTIONS;
  legL.setLocalScale(1, legs, 1);
  if (legR) legR.setLocalScale(1, legs, 1);
  // Legs stretch downward from the hip joint, so lift the rig by the extra
  // leg length to keep the feet on the floor. The lift goes on root's PARENT
  // (the glTF scene node, which no clip touches) - animation clips write
  // root's translation every frame and would stomp a lift applied to root.
  const hipY = legL.getLocalPosition().y;
  const top = root.parent;
  const tp = top.getLocalPosition();
  top.setLocalPosition(tp.x, tp.y + hipY * (legs - 1), tp.z);
  torso.setLocalScale(1, torsoS, 1);
  // Torso children inherit its stretch, which would deform them: counter it
  // on the head (shrinking it outright) and on the arms' thickness. Arms
  // extend along their bind-pose X axis (the T-pose direction), so the
  // shortening goes on bone X - it follows the arm through any clip pose.
  // Their attach points still ride up with the taller torso.
  const head = holder.findByName('head');
  if (head) head.setLocalScale(headS, headS / torsoS, headS);
  for (const name of ['arm-left', 'arm-right']) {
    const arm = holder.findByName(name);
    if (arm) arm.setLocalScale(armsS, 1 / torsoS, 1);
  }
}

// --- combat / impact FX ---------------------------------------------------------
// Purely cosmetic: gameplay resolves instantly, these just make it readable.
let fxMats = null;
function ensureFxMats() {
  if (fxMats) return fxMats;
  fxMats = {
    paper: makeMaterial([0.97, 0.96, 0.9], { gloss: 0.3 }),
    trail: makeMaterial([1, 1, 1], { opacity: 0.4 }),
  };
  return fxMats;
}

// A thrown paper ball ('ball') or airplane ('plane') arcing from one tile to
// another, shedding a fading trail. Fire and forget.
export function throwProjectile(app, from, to, kind = 'ball') {
  const m = ensureFxMats();
  const holder = new pc.Entity('projectile');
  if (kind === 'plane') {
    const spine = new pc.Entity();
    spine.addComponent('render', { type: 'box', material: m.paper });
    spine.setLocalScale(0.06, 0.09, 0.36);
    holder.addChild(spine);
    for (const side of [-1, 1]) {
      const wing = new pc.Entity();
      wing.addComponent('render', { type: 'box', material: m.paper });
      wing.setLocalScale(0.16, 0.02, 0.3);
      wing.setLocalPosition(side * 0.09, 0.03, -0.02);
      wing.setLocalEulerAngles(0, 0, side * 24);
      holder.addChild(wing);
    }
  } else {
    const wad = new pc.Entity();
    wad.addComponent('render', { type: 'sphere', material: m.paper });
    wad.setLocalScale(0.17, 0.15, 0.16);
    holder.addChild(wad);
  }
  app.root.addChild(holder);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dur = 0.18 + dist * 0.055;
  const arc = 0.3 + dist * 0.07;
  const yaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
  const Y = 0.55; // hand height
  const parts = [];
  let t = 0;
  let acc = 0;
  let flying = true;
  const tick = (dt) => {
    if (flying) {
      t += dt;
      const k = Math.min(1, t / dur);
      const y = Y + Math.sin(Math.PI * k) * arc;
      holder.setPosition(from.x + dx * k, y, from.z + dz * k);
      if (kind === 'plane') {
        const vy = (Math.PI / dur) * Math.cos(Math.PI * k) * arc;
        const pitch = Math.atan2(vy, dist / dur) * pc.math.RAD_TO_DEG;
        holder.setEulerAngles(-pitch, yaw, 0);
      } else {
        holder.setEulerAngles(t * 640, yaw, t * 470);
      }
      acc += dt;
      while (acc > 0.024) {
        acc -= 0.024;
        const p = new pc.Entity();
        p.addComponent('render', { type: 'sphere', material: m.trail });
        p.setLocalScale(0.09, 0.09, 0.09);
        p.setPosition(holder.getPosition());
        app.root.addChild(p);
        parts.push({ e: p, life: 0.32 });
      }
      if (k >= 1) {
        flying = false;
        holder.destroy();
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.e.destroy();
        parts.splice(i, 1);
        continue;
      }
      const s = 0.09 * (p.life / 0.32);
      p.e.setLocalScale(s, s, s);
    }
    if (!flying && !parts.length) app.off('update', tick);
  };
  app.on('update', tick);
}

// Floating damage/heal number above a tile. DOM-based so it stays crisp;
// tracks the world position each frame as the camera moves.
export function spawnDamageText(app, cameraEntity, wx, wy, wz, text, color = '#ff8a76') {
  const div = document.createElement('div');
  div.className = 'dmg-pop';
  Object.assign(div.style, {
    position: 'fixed', zIndex: '26', pointerEvents: 'none', left: '-999px',
    font: '800 15px system-ui, sans-serif', color,
    textShadow: '0 1px 4px rgba(0,0,0,.85)', transform: 'translate(-50%, -100%)',
  });
  div.textContent = text;
  document.body.appendChild(div);
  const pos = new pc.Vec3();
  const out = new pc.Vec3();
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const k = t / 0.9;
    if (k >= 1) {
      app.off('update', tick);
      div.remove();
      return;
    }
    pos.set(wx, wy + 0.6 + k * 0.85, wz);
    cameraEntity.camera.worldToScreen(pos, out);
    // worldToScreen works in device pixels; the DOM works in CSS pixels.
    const canvas = app.graphicsDevice.canvas;
    const s = canvas.clientWidth ? canvas.clientWidth / canvas.width : 1;
    div.style.left = out.x * s + 'px';
    div.style.top = out.y * s + 'px';
    div.style.opacity = String(1 - k * k);
  };
  app.on('update', tick);
}
