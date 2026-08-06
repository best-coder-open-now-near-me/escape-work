// Combat / impact FX and DOM-over-world projection. Purely cosmetic:
// gameplay resolves instantly, these just make it readable.
//
// Three layers live here, all of them fire-and-forget:
//   - PARTICLES: pooled primitive entities driven by one shared per-frame pump
//     (sparks, blood, paper shreds, embers, status motes). Bursts are described
//     by data - see IMPACTS below and the `fx` field on a status.
//   - DECALS: flat ground quads on a recycling ring (bloody footprints, splats,
//     scorch). Textures are generated once into a canvas, so nothing loads.
//   - DOM overlays: damage popups projected through the camera.
import { makeMaterial, toonifyMaterial } from './shading.js';
import { STATUSES } from './data/statuses.js';
import { TILE_TYPES } from './data/tiles.js';

const pc = globalThis.window?.pc;

// World point -> CSS-pixel screen point. Every DOM element tracking a world
// position (damage popups, loot labels, test helpers) projects through this.
//
// PlayCanvas's worldToScreen divides by the device's `clientRect` - which is
// the canvas's getBoundingClientRect(), i.e. CSS pixels - so its output is
// ALREADY CSS-space, whatever the backing store's resolution. This function
// therefore just passes the coordinates through.
// (It used to multiply by clientWidth/canvas.width "to convert device->CSS".
// That was backwards, and only harmless because the engine defaults
// maxPixelRatio to min(1, devicePixelRatio), leaving the factor exactly 1.
// The moment anyone raised maxPixelRatio for a sharper canvas, every overlay
// would have jumped toward the top-left by the DPR.)
// Input and output vectors MUST be distinct: worldToScreen re-reads the
// world point after writing the result (for the perspective divide), so
// passing one vector as both corrupts the projection.
// Scratch vectors for the world->screen projection, built on FIRST USE rather
// than at import. Constructing engine objects at module scope is what kept this
// file - and tile-renderer, scene and editor, which import it - out of node.
let _projIn = null;
let _projOut = null;
const projScratch = () => {
  _projIn ??= new pc.Vec3();
  _projOut ??= new pc.Vec3();
  return [_projIn, _projOut];
};
export function worldToScreenCss(cameraEntity, wx, wy, wz) {
  const [vin, vout] = projScratch();
  cameraEntity.camera.worldToScreen(vin.set(wx, wy, wz), vout);
  return { x: vout.x, y: vout.y, behind: vout.z < 0 };
}

// Body landmarks, in world units above the floor's top face. Characters are
// the de-chibi'd Kenney rigs (models.js): the e2e suite aims at 0.9 for a
// chest, so a hit sparks there, statuses wreathe the head, and blood lands at
// the feet.
export const FEET_Y = 0.06;
export const CHEST_Y = 0.9;
export const HEAD_Y = 1.55;
const FLOOR_TOP = TILE_TYPES.floor.height / 2;
// Decals ride above the floor AND above painted surfaces (tile-renderer draws
// pools/paper at floor + 0.02), so a bloody print reads on a paper drift.
const DECAL_Y = FLOOR_TOP + 0.032;

// ---------------------------------------------------------------------------
// The particle pump
// ---------------------------------------------------------------------------
// Every live particle in the game is stepped by ONE update handler per app,
// and every particle body is a pooled primitive entity - a burst on each swing
// would otherwise churn entities (and their render components) at the rate the
// player clicks. Fades are done with SCALE, not opacity, so particles of a
// colour can share one material: shrinking to nothing reads the same as fading
// out at these sizes, and it keeps the material count at "one per colour" no
// matter how many sparks are in flight.
const MAX_PARTICLES = 340; // hard ceiling - a spawn over it is simply dropped
const DECAL_CAP = 80; // ground decals recycle oldest-first past this

const pumps = new WeakMap();
function getPump(app) {
  let p = pumps.get(app);
  if (p) return p;
  p = { app, parts: [], decals: [], decalPool: [], pools: {}, decalClock: 0 };
  pumps.set(app, p);
  app.on('update', (dt) => stepPump(p, dt));
  return p;
}

function takeEntity(p, shape, material) {
  const pool = p.pools[shape] || (p.pools[shape] = []);
  const e = pool.pop();
  if (e) {
    e.render.meshInstances[0].material = material;
    e.enabled = true;
    return e;
  }
  const fresh = new pc.Entity('fx-' + shape);
  fresh.addComponent('render', { type: shape, material, castShadows: false });
  p.app.root.addChild(fresh);
  return fresh;
}

function releaseEntity(p, shape, e) {
  e.enabled = false;
  (p.pools[shape] || (p.pools[shape] = [])).push(e);
}

function stepPump(p, dt) {
  const parts = p.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.t += dt;
    if (q.t >= q.life) {
      releaseEntity(p, q.shape, q.e);
      parts.splice(i, 1);
      continue;
    }
    const k = q.t / q.life;
    q.vy += q.gravity * dt;
    if (q.drag) {
      const d = Math.exp(-q.drag * dt);
      q.vx *= d; q.vy *= d; q.vz *= d;
    }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.z += q.vz * dt;
    // Debris that reaches the carpet skids to a stop on it instead of sinking
    // through - the floor is where blood and paper belong.
    if (q.floorY !== null && q.y < q.floorY) {
      q.y = q.floorY;
      q.vy *= -0.28;
      q.vx *= 0.55;
      q.vz *= 0.55;
    }
    q.e.setPosition(q.x, q.y, q.z);
    const s = q.size * (1 + q.grow * k) * (1 - k * k);
    q.e.setLocalScale(s, s * q.flat, s);
    if (q.spin) q.e.setEulerAngles(q.spin * q.t, q.spin * 0.7 * q.t, q.spin * 1.3 * q.t);
  }
  // Decals fade on their own slow clock (10Hz): a full-rate opacity write on
  // 80 materials every frame costs more than the fade is worth.
  p.decalClock += dt;
  if (p.decalClock < 0.1) return;
  const step = p.decalClock;
  p.decalClock = 0;
  for (let i = p.decals.length - 1; i >= 0; i--) {
    const d = p.decals[i];
    d.t += step;
    if (d.t >= d.life) {
      d.e.enabled = false;
      p.decals.splice(i, 1);
      p.decalPool.push(d);
      continue;
    }
    const k = d.t / d.life;
    if (k > 0.55) {
      d.mat.opacity = d.alpha * (1 - (k - 0.55) / 0.45);
      d.mat.update();
    }
  }
}

// One material per colour (and blend mode). Additive materials read as LIGHT -
// sparks, embers, status motes; the lit ones are matter - blood, paper, dust.
const partMats = new Map();
function partMat(color, additive) {
  const key = `${color[0].toFixed(2)},${color[1].toFixed(2)},${color[2].toFixed(2)}|${additive ? 'a' : 'n'}`;
  let m = partMats.get(key);
  if (m) return m;
  if (additive) {
    m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(0, 0, 0);
    m.specular = new pc.Color(0, 0, 0);
    m.gloss = 0;
    m.emissive = new pc.Color(color[0], color[1], color[2]);
    m.emissiveIntensity = 2.0;
    m.blendType = pc.BLEND_ADDITIVEALPHA;
    m.opacity = 0.8;
    m.depthWrite = false;
    m.update();
  } else {
    m = makeMaterial(color, { gloss: 0.2 });
  }
  partMats.set(key, m);
  return m;
}

const rnd = (a, b) => a + Math.random() * (b - a);

// Spawn one burst. Everything is optional; the defaults are a small warm
// spark puff. `dir` biases the cone along a horizontal direction (a hit throws
// its debris away from the attacker).
export function burst(app, pos, opts = {}) {
  const {
    count = 8, color = [1, 0.88, 0.5], additive = true, shape = 'sphere',
    speed = 2.4, speedVar = 0.5, up = 1.4, upVar = 0.9, spread = 1,
    gravity = -8, drag = 1.1, size = 0.07, sizeVar = 0.4, flat = 1,
    life = 0.45, lifeVar = 0.4, grow = 0, spin = 0, floor = true, dir = null,
    jitter = 0.08,
  } = opts;
  const p = getPump(app);
  const mat = partMat(color, additive);
  const floorY = floor ? FLOOR_TOP + 0.02 : null;
  for (let i = 0; i < count; i++) {
    if (p.parts.length >= MAX_PARTICLES) return;
    const ang = Math.random() * Math.PI * 2;
    const sp = speed * rnd(1 - speedVar, 1 + speedVar);
    let vx = Math.cos(ang) * sp * spread;
    let vz = Math.sin(ang) * sp * spread;
    if (dir) {
      vx = vx * 0.55 + dir.x * sp;
      vz = vz * 0.55 + dir.z * sp;
    }
    const e = takeEntity(p, shape, mat);
    const q = {
      e, shape,
      x: pos.x + rnd(-jitter, jitter),
      y: pos.y + rnd(-jitter, jitter),
      z: pos.z + rnd(-jitter, jitter),
      vx, vy: up * rnd(1 - upVar, 1 + upVar), vz,
      gravity, drag, grow, spin: spin ? spin * rnd(-1, 1) : 0, flat, floorY,
      size: size * rnd(1 - sizeVar, 1 + sizeVar),
      life: life * rnd(1 - lifeVar, 1 + lifeVar),
      t: 0,
    };
    q.e.setPosition(q.x, q.y, q.z);
    q.e.setLocalScale(q.size, q.size * flat, q.size);
    p.parts.push(q);
  }
}

// The bright pop at the centre of an impact: one additive sphere that swells
// and vanishes inside a fifth of a second. Cheap, and it's what sells the hit
// as an EVENT rather than a number appearing.
export function flash(app, pos, { color = [1, 0.95, 0.75], size = 0.3, life = 0.16, grow = 2.4 } = {}) {
  burst(app, pos, {
    count: 1, color, additive: true, size, sizeVar: 0, life, lifeVar: 0,
    speed: 0, up: 0, upVar: 0, gravity: 0, drag: 0, grow, floor: false, jitter: 0,
  });
}

// ---------------------------------------------------------------------------
// Impacts - the vocabulary of "something just happened here"
// ---------------------------------------------------------------------------
// Each preset is a list of bursts (plus an optional flash) layered into one
// effect. Adding a kind is adding an entry; the callers pass an id.
const BLOOD = [0.4, 0.03, 0.03];
// Sizes are tuned for the DEFAULT camera boom (controls.js parks at 26 units
// out), where a tenth of a world unit is only a few pixels - anything smaller
// than ~0.12 reads as video noise rather than debris.
const IMPACTS = {
  // A landed melee swing: a spark pop off the contact point, and blood.
  melee: {
    flash: { color: [1, 0.92, 0.7], size: 0.26 },
    bursts: [
      { count: 10, color: [1, 0.86, 0.45], speed: 3.2, size: 0.15, life: 0.42, gravity: -9 },
      { count: 7, color: BLOOD, additive: false, speed: 2.2, size: 0.07, life: 0.75, gravity: -11 },
    ],
    splat: 0.9,
  },
  // Paper moving with nobody hurt: gathering a drift off the floor, a throw
  // shedding sheets. Same confetti as `paper`, minus everything that bleeds -
  // picking up ammo should not stain the carpet.
  shreds: {
    bursts: [
      { count: 8, color: [0.95, 0.93, 0.86], additive: false, shape: 'box', speed: 1.8, size: 0.11, flat: 0.16, life: 0.9, gravity: -3.5, drag: 2.2, spin: 460 },
    ],
  },
  // Paper landing on somebody: shredded confetti, a little blood at the edges.
  paper: {
    flash: { color: [1, 1, 0.9], size: 0.2, life: 0.14 },
    bursts: [
      { count: 9, color: [0.95, 0.93, 0.86], additive: false, shape: 'box', speed: 2.4, size: 0.115, flat: 0.16, life: 1, gravity: -3.5, drag: 2.2, spin: 520 },
      { count: 4, color: BLOOD, additive: false, speed: 1.8, size: 0.06, life: 0.65, gravity: -10 },
    ],
    splat: 0.5,
  },
  // A body meeting a wall (shove slam) - dust, no cutting edge.
  slam: {
    flash: { color: [0.85, 0.85, 0.9], size: 0.26, life: 0.16 },
    bursts: [
      { count: 11, color: [0.62, 0.6, 0.58], additive: false, speed: 2.6, size: 0.18, life: 0.7, gravity: -2.5, drag: 2.6, grow: 1.2 },
      { count: 5, color: [1, 0.9, 0.6], speed: 2.2, size: 0.12, life: 0.3 },
    ],
  },
  // A miss: the swing still moved air.
  whiff: {
    bursts: [
      { count: 6, color: [0.72, 0.74, 0.8], additive: false, speed: 2, size: 0.13, life: 0.4, gravity: -1.5, drag: 3, grow: 1.6 },
    ],
  },
  // Live water.
  zap: {
    flash: { color: [0.7, 0.95, 1], size: 0.28, life: 0.16, grow: 3 },
    bursts: [
      { count: 13, color: [0.6, 0.92, 1], speed: 4.2, size: 0.12, life: 0.35, gravity: -1, drag: 0.4 },
    ],
  },
  // Open flame.
  fire: {
    bursts: [
      { count: 9, color: [1, 0.55, 0.14], speed: 1.4, up: 2.2, size: 0.17, life: 0.7, gravity: 1.2, drag: 1.4, grow: 0.4 },
      { count: 5, color: [0.32, 0.3, 0.3], additive: false, speed: 0.8, up: 1.8, size: 0.2, life: 1.1, gravity: 0.9, drag: 1.6, grow: 1.4 },
    ],
  },
  // A printer's dying breath.
  toner: {
    flash: { color: [0.8, 0.82, 0.9], size: 0.42, life: 0.22, grow: 3.2 },
    bursts: [
      { count: 13, color: [0.26, 0.26, 0.3], additive: false, speed: 3.4, size: 0.24, life: 1.3, gravity: -1.2, drag: 1.8, grow: 1.8 },
      { count: 11, color: [1, 0.78, 0.35], speed: 4.6, size: 0.15, life: 0.5, gravity: -6 },
    ],
  },
  // Somebody hits the carpet for good.
  death: {
    flash: { color: [1, 0.8, 0.55], size: 0.3, life: 0.18, grow: 2.4 },
    bursts: [
      { count: 11, color: [0.95, 0.93, 0.86], additive: false, shape: 'box', speed: 2.6, size: 0.125, flat: 0.14, life: 1.6, gravity: -3, drag: 1.6, spin: 420 },
      { count: 9, color: BLOOD, additive: false, speed: 2.2, size: 0.08, life: 0.9, gravity: -11 },
      { count: 7, color: [0.6, 0.58, 0.56], additive: false, speed: 1.6, size: 0.24, life: 0.8, gravity: -1.6, drag: 2.6, grow: 1.6 },
    ],
    splat: 1.5,
  },
  // Patching yourself up.
  heal: {
    bursts: [
      { count: 12, color: [0.55, 1, 0.6], speed: 0.7, up: 1.6, upVar: 0.4, size: 0.14, life: 1, gravity: 0.9, drag: 0.9, jitter: 0.2 },
    ],
  },
  // A promotion. Confetti from the ceiling of an office that doesn't deserve it.
  levelup: {
    flash: { color: [1, 0.9, 0.5], size: 0.42, life: 0.28, grow: 2.6 },
    bursts: [
      { count: 18, color: [1, 0.85, 0.35], speed: 1.4, up: 3, upVar: 0.5, size: 0.15, life: 1.2, gravity: -4.5, drag: 0.7 },
      { count: 12, color: [1, 0.95, 0.75], additive: false, shape: 'box', speed: 1.6, up: 2.7, size: 0.13, flat: 0.18, life: 1.6, gravity: -3.4, drag: 1.2, spin: 480 },
    ],
  },
  // Going down on a wet floor.
  slip: {
    bursts: [
      { count: 10, color: [0.62, 0.85, 0.98], speed: 2.8, up: 0.9, size: 0.13, life: 0.5, gravity: -6, spread: 1.3 },
    ],
  },
  // Stepping in a wad of gum.
  gum: {
    bursts: [
      { count: 7, color: [0.93, 0.5, 0.65], additive: false, speed: 1.4, up: 1.2, size: 0.11, life: 0.6, gravity: -7, drag: 1.4 },
    ],
  },
};

// Play one impact at a world point. `dir` (optional, a unit-ish {x,z}) throws
// the debris away from whoever caused it.
export function impact(app, x, y, z, kind = 'melee', { dir = null, scale = 1 } = {}) {
  const preset = IMPACTS[kind];
  if (!preset) return;
  const pos = { x, y, z };
  if (preset.flash) flash(app, pos, { ...preset.flash, size: (preset.flash.size ?? 0.3) * scale });
  for (const b of preset.bursts) {
    burst(app, pos, { ...b, dir, count: Math.max(1, Math.round(b.count * scale)), size: (b.size ?? 0.07) * scale });
  }
  if (preset.splat) bloodSplat(app, x, z, { scale: preset.splat * scale });
}

// ---------------------------------------------------------------------------
// Statuses - what a buff or a debuff LOOKS like
// ---------------------------------------------------------------------------
// The look is data (`fx` on a status in data/statuses.js); this is the runtime
// that reads it, exactly like statuses.js is the runtime for their rules. A
// status with no `fx` simply shows nothing.
//
// On APPLICATION: a one-shot burst, whose default direction comes from the
// status's polarity - a buff rises off you, a debuff falls onto you.
export function statusBurst(app, x, z, id) {
  const def = STATUSES[id];
  const f = def?.fx;
  if (!f) return;
  const color = f.color;
  const harmful = !!def.harmful;
  const mode = f.burst || (harmful ? 'fall' : 'rise');
  if (mode === 'rise') {
    flash(app, { x, y: FEET_Y + 0.25, z }, { color, size: 0.26, life: 0.26, grow: 2.6 });
    burst(app, { x, y: FEET_Y + 0.15, z }, {
      count: 11, color, speed: 0.5, up: 1.9, upVar: 0.35, size: 0.12,
      life: 0.9, gravity: -1.2, drag: 1.1, jitter: 0.26, floor: false,
    });
  } else if (mode === 'fall') {
    burst(app, { x, y: HEAD_Y + 0.4, z }, {
      count: 10, color, speed: 0.45, up: -1.1, upVar: 0.5, size: 0.12,
      life: 0.8, gravity: -2.2, drag: 1.1, jitter: 0.3,
    });
    flash(app, { x, y: HEAD_Y, z }, { color, size: 0.24, life: 0.22, grow: 2 });
  } else if (mode === 'pop') { // straight out from the head, the instantaneous ones
    flash(app, { x, y: HEAD_Y, z }, { color, size: 0.24, life: 0.2, grow: 2.4 });
    burst(app, { x, y: HEAD_Y, z }, {
      count: 10, color, speed: 2, up: 1, size: 0.12, life: 0.55, gravity: -3, drag: 1.8,
    });
  }
  // Anything else shows nothing. `pop` used to be the bare `else`, so
  // `burst: 'none'` - again only `sneaking` - announced the sneak with the
  // LOUDEST of the three (Q053/Q212). A status that opts out of a burst gets
  // no burst; the harmful/harmless default above still covers omitting the key.
}

// While a status is LIVE it wears an aura: a trickle of particles the shape of
// what it does to you. One tracker per game, synced from the update loop with
// whoever currently carries statuses - it owns its own timers, so callers just
// describe the world each frame.
//
// Aura kinds (a status's `fx.aura`):
//   ember  rising sparks off the body        (burning)
//   orbit  motes circling the head           (stunned, surprised)
//   drip   drops falling to the carpet       (bleeding)
//   haze   slow cloud around the head        (blinded)
//   shield motes rising along the body       (deflecting, training credit)
//   cling  low motes at the feet             (gum)
export function createAuraLayer(app) {
  const state = new Map(); // entity -> Map(statusId -> { t, ang })
  let acc = 0;

  function emit(entity, id, f, s) {
    const p = entity.getPosition();
    const color = f.color;
    switch (f.aura) {
      case 'ember':
        burst(app, { x: p.x, y: p.y + CHEST_Y, z: p.z }, {
          count: 2, color, speed: 0.5, up: 1.8, size: 0.13, life: 0.75,
          gravity: 1.1, drag: 1.2, grow: 0.3, jitter: 0.26, floor: false,
        });
        break;
      case 'orbit': {
        s.ang += 1.5;
        const r = 0.42;
        burst(app, { x: p.x + Math.cos(s.ang) * r, y: p.y + HEAD_Y + 0.16, z: p.z + Math.sin(s.ang) * r }, {
          count: 1, color, speed: 0, up: 0.15, upVar: 0, size: 0.1, sizeVar: 0.1,
          life: 0.5, lifeVar: 0.1, gravity: 0, drag: 0, jitter: 0.02, floor: false,
        });
        break;
      }
      case 'drip':
        burst(app, { x: p.x, y: p.y + 0.55, z: p.z }, {
          count: 1, color, additive: false, speed: 0.25, up: -0.2, upVar: 0.5,
          size: 0.09, life: 0.6, gravity: -9, drag: 0, jitter: 0.2,
        });
        break;
      case 'haze':
        burst(app, { x: p.x, y: p.y + HEAD_Y, z: p.z }, {
          count: 1, color, additive: false, speed: 0.35, up: 0.15, size: 0.22,
          life: 1.1, gravity: 0.15, drag: 1.4, grow: 1.2, jitter: 0.3, floor: false,
        });
        break;
      case 'cling':
        burst(app, { x: p.x, y: p.y + FEET_Y, z: p.z }, {
          count: 1, color, speed: 0.3, up: 0.5, size: 0.09, life: 0.5,
          gravity: -1.2, drag: 1.5, jitter: 0.18,
        });
        break;
      case 'shield':
        burst(app, { x: p.x, y: p.y + 0.35, z: p.z }, {
          count: 1, color, speed: 0.2, up: 1.1, size: 0.1, life: 0.75,
          gravity: -0.6, drag: 0.9, jitter: 0.3, floor: false,
        });
        break;
      // An aura kind this module does not implement shows NOTHING. It used to
      // share a label with 'shield', which meant `aura: 'none'` - the only
      // out-of-vocabulary value in data/statuses.js, and it is on `sneaking` -
      // wore the shield's glowing motes for the whole held sneak. The one
      // state whose entire point is not being seen was the one continuously
      // trailing particles (Q053). Silence is also the right answer for a
      // typo, which this arm used to swallow.
      default:
        break;
    }
  }

  // Called every frame with `collect`, which yields the current carriers as
  // [{ entity, statuses: [{ id }] }]. It is invoked ONLY on the frames the
  // tracker actually emits on (about 16Hz) - walking the whole roster and
  // snapshotting everyone's statuses is not free, and an aura mote every
  // sixtieth of a second is not a thing anyone can see.
  function sync(dt, collect) {
    acc += dt;
    if (acc < 0.06) return;
    const step = acc;
    acc = 0;
    const carriers = collect();
    const seen = new Set();
    for (const c of carriers) {
      if (!c || !c.entity || !c.statuses || !c.statuses.length) continue;
      seen.add(c.entity);
      let m = state.get(c.entity);
      if (!m) state.set(c.entity, m = new Map());
      for (const st of c.statuses) {
        const f = STATUSES[st.id]?.fx;
        if (!f?.aura) continue;
        let s = m.get(st.id);
        if (!s) m.set(st.id, s = { t: Math.random() * 0.2, ang: Math.random() * 6.28 });
        s.t += step;
        if (s.t >= (f.rate || 0.25)) {
          s.t = 0;
          emit(c.entity, st.id, f, s);
        }
      }
      for (const id of m.keys()) {
        if (!c.statuses.some((st) => st.id === id)) m.delete(id);
      }
    }
    for (const e of state.keys()) if (!seen.has(e)) state.delete(e);
  }

  return { sync };
}

// ---------------------------------------------------------------------------
// Ground decals - footprints, blood, scorch
// ---------------------------------------------------------------------------
// Flat textured quads on the carpet, on a recycling ring so a long fight can
// never accumulate geometry without bound. The textures are drawn once into a
// canvas at boot: no asset to load, no file to ship.
function makeTexture(app, size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  const tex = new pc.Texture(app.graphicsDevice, {
    width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  tex.setSource(canvas);
  return tex;
}

let decalTex = null;
function decalTextures(app) {
  if (decalTex) return decalTex;
  const TAU = Math.PI * 2;
  // A shoe sole: the ball of the foot and a heel, toe toward -v (which the
  // plane maps to +Z, the direction the walker is facing).
  const foot = makeTexture(app, 64, (ctx, s) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.36, s * 0.19, s * 0.26, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.74, s * 0.14, s * 0.16, 0, 0, TAU);
    ctx.fill();
    // The arch between ball and heel - faint, not empty. A print is ink
    // pressed off a sole, not a stencil cut.
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.56, s * 0.09, s * 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  // A splat: a core blob plus fixed satellites. Per-decal rotation and scale
  // keep the repeat invisible.
  const splat = makeTexture(app, 64, (ctx, s) => {
    // Radial falloff, not a hard ellipse: a stain has a wet edge, and a
    // hard-edged one shrinks into a little dark DIAMOND at the sizes these
    // are drawn at.
    const blob = (cx, cy, r, a) => {
      const g = ctx.createRadialGradient(cx * s, cy * s, 0, cx * s, cy * s, r * s);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.62, `rgba(255,255,255,${a * 0.92})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx * s, cy * s, r * s, 0, TAU);
      ctx.fill();
    };
    blob(0.5, 0.52, 0.3, 1);
    blob(0.72, 0.36, 0.12, 0.9);
    blob(0.29, 0.68, 0.1, 0.85);
    blob(0.68, 0.72, 0.075, 0.8);
    blob(0.35, 0.29, 0.06, 0.75);
    blob(0.85, 0.62, 0.045, 0.6);
    blob(0.17, 0.42, 0.04, 0.55);
  });
  decalTex = { foot, splat };
  return decalTex;
}

// Lay one decal on the floor. Recycles the oldest once the ring is full, so
// the entity and material count is bounded no matter how much blood is spilled.
export function groundDecal(app, x, z, { tex, color, size = 0.3, yaw = 0, life = 26, alpha = 0.85 }) {
  const p = getPump(app);
  let d = p.decalPool.pop();
  if (!d) {
    if (p.decals.length >= DECAL_CAP) {
      // Full ring: the oldest print gives up its entity and material to the
      // newest, which is what bounds this layer's cost.
      d = p.decals.shift();
    } else {
      const mat = new pc.StandardMaterial();
      mat.blendType = pc.BLEND_NORMAL;
      mat.depthWrite = false;
      mat.gloss = 0.15;
      toonifyMaterial(mat); // shaded like the carpet it's lying on
      const e = new pc.Entity('fx-decal');
      e.addComponent('render', { type: 'plane', material: mat, castShadows: false });
      p.app.root.addChild(e);
      d = { e, mat, t: 0, life, alpha };
    }
  }
  d.t = 0;
  d.life = life;
  d.alpha = alpha;
  d.mat.diffuse.set(color[0], color[1], color[2]);
  d.mat.diffuseMap = tex;
  d.mat.opacityMap = tex;
  d.mat.opacityMapChannel = 'a';
  d.mat.opacity = alpha;
  d.mat.update();
  d.e.enabled = true;
  d.e.setPosition(x, DECAL_Y, z);
  d.e.setEulerAngles(0, yaw, 0);
  d.e.setLocalScale(size, 1, size);
  p.decals.push(d);
  return d;
}

const BLOOD_DECAL = [0.34, 0.02, 0.02];

export function bloodSplat(app, x, z, { scale = 1, color = BLOOD_DECAL, life = 30 } = {}) {
  groundDecal(app, x + rnd(-0.18, 0.18), z + rnd(-0.18, 0.18), {
    tex: decalTextures(app).splat,
    color,
    size: rnd(0.34, 0.5) * scale,
    yaw: Math.random() * 360,
    life,
    alpha: 0.8,
  });
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------
// Whoever walks wet or bleeding leaves a trail, and the trail is the point:
// paper drifts CUT (data/surfaces.js), so anyone crossing a drift is soon
// stamping bloody prints across the carpet behind them. Water works the same
// way for a few tiles, dimmer.
//
// State is keyed by the actor and lives here, so callers only have to report
// "this actor entered this tile, here's what it's standing in".
const FOOT_STATE = new WeakMap(); // actor -> { side, wet, kind }
const FOOT_COLORS = {
  blood: [0.36, 0.02, 0.02],
  water: [0.28, 0.36, 0.44],
  coffee: [0.22, 0.14, 0.09],
};

// One tile entered. `bleeding` means the walker is dripping (a bleed status, or
// simply badly hurt); `surface` is what they just stepped IN, which both stains
// the shoe for the next few tiles and decides how vivid this print is.
export function footstep(app, actor, x, z, { bleeding = false, surface = null, onPaper = false } = {}) {
  if (!actor?.entity) return;
  let st = FOOT_STATE.get(actor);
  if (!st) FOOT_STATE.set(actor, st = { side: 1, wet: 0, kind: null });
  // Picking up a stain: a liquid you step in rides the sole for a few tiles.
  if (surface === 'water' || surface === 'coffee') {
    st.wet = 4;
    st.kind = surface;
  }
  let kind = null;
  let alpha = 0.7;
  if (bleeding) {
    kind = 'blood';
    // Blood on a white paper drift is the whole image - it reads darker and
    // lasts longer there than it does on office carpet.
    alpha = onPaper ? 0.95 : 0.7;
  } else if (st.wet > 0) {
    st.wet -= 1;
    kind = st.kind;
    alpha = 0.34 * (st.wet / 4 + 0.3);
  }
  if (!kind) return;
  const pos = actor.entity.getPosition();
  const yaw = actor.yaw ?? 0;
  const rad = yaw * Math.PI / 180;
  // Step off the centreline, alternating feet - a single line of prints reads
  // as a smear, two staggered rows read as somebody walking. A blood trail
  // also gets the half-tile print BEHIND this one: the hook fires once per
  // tile entered, and one print per metre is a hopping gait, not a walk.
  for (const back of (kind === 'blood' ? [0, -0.5] : [0])) {
    st.side = -st.side;
    const ox = Math.cos(rad) * 0.14 * st.side + Math.sin(rad) * back;
    const oz = -Math.sin(rad) * 0.14 * st.side + Math.cos(rad) * back;
    groundDecal(app, pos.x + ox, pos.z + oz, {
      tex: decalTextures(app).foot,
      color: FOOT_COLORS[kind],
      size: 0.38,
      yaw: yaw + rnd(-7, 7),
      life: kind === 'blood' ? 34 : 14,
      alpha: back ? alpha * 0.85 : alpha,
    });
  }
  // A bleeder doesn't only print - they drip.
  if (kind === 'blood' && Math.random() < 0.35) {
    bloodSplat(app, pos.x + rnd(-0.2, 0.2), pos.z + rnd(-0.2, 0.2), { scale: 0.45, life: 34 });
  }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------
let fxMats = null;
function ensureFxMats() {
  if (fxMats) return fxMats;
  fxMats = {
    paper: makeMaterial([0.97, 0.96, 0.9], { gloss: 0.3 }),
    paperFold: makeMaterial([0.82, 0.84, 0.86], { gloss: 0.2 }),
    trail: makeMaterial([1, 1, 1], { opacity: 0.4 }),
  };
  return fxMats;
}

// A thrown paper ball ('ball'), airplane ('plane'), or flat envelope
// ('envelope') arcing from one tile to another, shedding a fading trail. Fire
// and forget. It leaves the thrower's
// hand in a puff of loose sheets and shreds itself on arrival - the arc used
// to simply blink out of existence at the target.
//
// 'shot' is the FIRED one (the staple gun, the straw): the same flight, read
// differently - a small pellet, quicker, and almost flat, because a lobbed
// staple looks thrown and the whole point of the weapon is that it wasn't. It
// also skips the puff of loose sheets at both ends, which is paper's tell and
// nothing a staple sheds.
export function throwProjectile(app, from, to, kind = 'ball') {
  const m = ensureFxMats();
  const shot = kind === 'shot';
  const sheetFlight = kind === 'plane' || kind === 'envelope';
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
  } else if (kind === 'envelope') {
    const body = new pc.Entity();
    body.addComponent('render', { type: 'box', material: m.paper });
    body.setLocalScale(0.25, 0.018, 0.34);
    holder.addChild(body);
    // A small contrasting flap makes the silhouette read as an envelope at
    // the game's camera distance, not a white ball or anonymous projectile.
    const flap = new pc.Entity();
    flap.addComponent('render', { type: 'box', material: m.paperFold });
    flap.setLocalScale(0.19, 0.012, 0.13);
    flap.setLocalPosition(0, 0.017, -0.055);
    flap.setLocalEulerAngles(0, 45, 0);
    holder.addChild(flap);
  } else {
    const wad = new pc.Entity();
    wad.addComponent('render', { type: 'sphere', material: m.paper });
    if (shot) wad.setLocalScale(0.075, 0.07, 0.075);
    else wad.setLocalScale(0.17, 0.15, 0.16);
    holder.addChild(wad);
  }
  app.root.addChild(holder);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dur = shot ? 0.1 + dist * 0.018 : 0.18 + dist * 0.055;
  const arc = shot ? 0.05 + dist * 0.012 : 0.3 + dist * 0.07;
  const yaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
  const Y = 0.55; // hand height
  // The wind-up: a couple of loose sheets kicked off the throwing hand. A shot
  // has no wind-up - that is what makes it read as fired.
  if (!shot) {
    burst(app, { x: from.x, y: Y + 0.15, z: from.z }, {
      count: 4, color: [0.95, 0.93, 0.86], additive: false, shape: 'box',
      speed: 1.1, up: 0.9, size: 0.06, flat: 0.2, life: 0.55, gravity: -4, drag: 2, spin: 380,
      dir: { x: dx / dist, z: dz / dist },
    });
  }
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
      if (sheetFlight) {
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
        p.addComponent('render', { type: sheetFlight ? 'box' : 'sphere', material: m.trail });
        const base = sheetFlight ? [0.075, 0.012, 0.055] : [0.09, 0.09, 0.09];
        p.setLocalScale(base[0], base[1], base[2]);
        if (sheetFlight) p.setEulerAngles(0, yaw + parts.length * 29, parts.length % 2 ? 18 : -18);
        p.setPosition(holder.getPosition());
        app.root.addChild(p);
        parts.push({ e: p, life: 0.32, base });
      }
      if (k >= 1) {
        flying = false;
        const end = holder.getPosition();
        burst(app, { x: end.x, y: end.y, z: end.z }, shot
          ? { count: 4, color: [0.95, 0.93, 0.86], additive: false, speed: 2.4, size: 0.04, life: 0.4, gravity: -6, drag: 2.4 }
          : {
            count: 7, color: [0.95, 0.93, 0.86], additive: false, shape: 'box',
            speed: 1.9, size: 0.06, flat: 0.18, life: 0.8, gravity: -3.6, drag: 2, spin: 460,
          });
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
      const fade = p.life / 0.32;
      p.e.setLocalScale(p.base[0] * fade, p.base[1] * fade, p.base[2] * fade);
    }
    if (!flying && !parts.length) app.off('update', tick);
  };
  app.on('update', tick);
}

// Bulk Mail is a FAN, even when nobody happens to be standing in it. Five
// envelopes fly along the same angular limits the rules carpet, so the effect
// communicates the wedge instead of looking like one Paper Ball aimed at one
// target. Resolution remains instant and entirely separate from these visuals.
export function throwPaperFan(app, from, angle, cone, count = 5) {
  const half = (cone.halfAngle * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = angle - half + t * half * 2;
    // Alternate the reach slightly so the leading edge reads as scattered
    // mail rather than five synchronized missiles.
    const reach = cone.range * (0.78 + (i % 3) * 0.09);
    throwProjectile(app, from, {
      x: from.x + Math.cos(a) * reach,
      z: from.z + Math.sin(a) * reach,
    }, 'envelope');
  }
}

// ---------------------------------------------------------------------------
// Floating numbers
// ---------------------------------------------------------------------------
// Floating damage/heal number above a tile. DOM-based so it stays crisp;
// tracks the world position each frame as the camera moves.
// How long a damage number stays up. Deliberately unhurried: a fight resolves
// several of these at once, and at 0.9s they were gone before you had read
// them - especially the ones behind the combat panel.
const DMG_POP_SECONDS = 1.8;

// Successive popups fan out sideways instead of stacking on one another - two
// numbers in the same instant used to overprint into an unreadable smudge.
let popSeq = 0;

export function spawnDamageText(app, cameraEntity, wx, wy, wz, text, color = '#ff8a76', opts = {}) {
  const { big = false } = opts;
  const div = document.createElement('div');
  div.className = 'dmg-pop';
  Object.assign(div.style, {
    position: 'fixed', zIndex: '26', pointerEvents: 'none', left: '-999px',
    font: `${big ? 900 : 800} ${big ? 22 : 15}px system-ui, sans-serif`, color,
    textShadow: big
      ? '0 0 10px rgba(0,0,0,.9), 0 2px 5px rgba(0,0,0,.95)'
      : '0 1px 4px rgba(0,0,0,.85)',
    transformOrigin: 'center bottom', willChange: 'transform',
  });
  div.textContent = text;
  document.body.appendChild(div);
  const drift = ((popSeq++ % 4) - 1.5) * 13;
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const k = t / DMG_POP_SECONDS;
    if (k >= 1) {
      app.off('update', tick);
      div.remove();
      return;
    }
    const s = worldToScreenCss(cameraEntity, wx, wy + 0.6 + k * 0.55, wz);
    // A point behind the camera projects to a mirrored/garbage screen position -
    // hide the popup that frame rather than flash it somewhere wrong (matches
    // the loot-label projection guard).
    if (s.behind) { div.style.opacity = '0'; return; }
    div.style.left = (s.x + drift * Math.min(1, k * 4)) + 'px';
    div.style.top = s.y + 'px';
    // A number that PUNCHES in - overshoot on the first 120ms, settle back.
    // The number arriving is the moment the hit reads; a linear fade-up made
    // every hit, big or small, arrive at the same weight.
    const pop = t < 0.12 ? 1 + (big ? 1.1 : 0.7) * (1 - t / 0.12) ** 2 : 1;
    div.style.transform = `translate(-50%, -100%) scale(${pop.toFixed(3)})`;
    div.style.opacity = String(k < 0.6 ? 1 : 1 - ((k - 0.6) / 0.4) ** 2);
  };
  app.on('update', tick);
}
