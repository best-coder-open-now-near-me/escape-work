// Object picking: turn a screen pixel into the interactable ENTITY under the
// cursor, not just the ground tile. The rest of the input stack only ever
// knew the y=0 ground plane (controls.screenToGround), so a click on a tall
// door or a standing enemy actually landed on the floor a tile BEHIND them -
// doors silently swallowed their clicks, enemies were fiddly to target, and
// nothing could be highlighted on hover. This keeps a small registry of
// interactable holder entities, each tagged { kind, ref }, and ray-tests the
// cursor against their world bounding boxes, returning the nearest hit.
//
// It is camera-agnostic at construction (the camera rig is built after the
// scene): pick(cameraEntity, sx, sy) takes the camera each call.
const pc = globalThis.window?.pc;

export function createPicker() {
  // holder entity -> { kind, ref, instances: MeshInstance[] }. The mesh
  // instances are captured once at registration; their world AABBs update
  // live as the holder moves, so a wandering enemy stays pickable.
  const items = new Map();
  const BODY_KINDS = new Set(['party', 'enemy', 'npc', 'summon']);

  function register(entity, kind, ref, options = {}) {
    if (!entity || items.has(entity)) return;
    const instances = [];
    for (const rc of entity.findComponents('render')) {
      // Skip the decorative shells (ink outline, hover highlight) so the
      // pick box hugs the real geometry, not an inflated hull.
      if (rc.entity.name === 'outlines' || rc.entity.name === 'highlight') continue;
      for (const mi of rc.meshInstances) instances.push(mi);
    }
    if (!instances.length) return;
    // Animated GLBs can report a deliberately conservative WORLD aabb large
    // enough for every pose in the clip. That is useful for rendering culls
    // but poisonous for interaction: a Synty character several tiles away can
    // then intercept a door click. Bodies default to their per-mesh oriented
    // bounds; callers may still override the policy explicitly, and doors use
    // the same precise path to avoid empty corners around a swung panel.
    const precise = options.precise ?? BODY_KINDS.has(kind);
    items.set(entity, { kind, ref, instances, precise });
    // Auto-forget when the entity is destroyed (doors re-render on every
    // toggle; loose items vanish when picked up).
    entity.once('destroy', () => items.delete(entity));
  }

  function unregister(entity) {
    if (entity) items.delete(entity);
  }

  // Union AABB of an item's mesh instances, in world space. Writes into the
  // shared _min/_max scratch; returns false when nothing renderable is left.
  const _min = new pc.Vec3();
  const _max = new pc.Vec3();
  function bounds(item) {
    let has = false;
    for (const mi of item.instances) {
      const b = mi.aabb; // world-space, engine-maintained
      const mn = b.getMin();
      const mx = b.getMax();
      if (!has) { _min.copy(mn); _max.copy(mx); has = true; continue; }
      _min.x = Math.min(_min.x, mn.x); _min.y = Math.min(_min.y, mn.y); _min.z = Math.min(_min.z, mn.z);
      _max.x = Math.max(_max.x, mx.x); _max.y = Math.max(_max.y, mx.y); _max.z = Math.max(_max.z, mx.z);
    }
    return has;
  }

  // Slab ray/box test. o + t*d spans near->far as t goes 0..1; returns the
  // entry distance t (>= 0) or null on a miss. Reads _min/_max in place.
  function raySlab(ox, oy, oz, dx, dy, dz) {
    let tmin = 0;
    let tmax = 1;
    const axis = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!axis(ox, dx, _min.x, _max.x)) return null;
    if (!axis(oy, dy, _min.y, _max.y)) return null;
    if (!axis(oz, dz, _min.z, _max.z)) return null;
    return tmin;
  }

  // A hidden storey must not eat clicks. The cutaway hides a whole floor by
  // disabling its root entity (scene.js `updateCutaway`), but a disabled
  // entity's mesh instances keep their world AABBs - so the ray went on
  // hitting doors and props on a storey the player cannot even see, and the
  // door they clicked THROUGH never got the click. `layeredPick` already
  // scans top-down through visible storeys for the same reason; this is the
  // body picker learning the same rule. Walks the chain rather than reading
  // `entity.enabled`, which is the LOCAL flag: the item's own flag stays true
  // while its storey root is the thing switched off.
  function visible(entity) {
    for (let e = entity; e; e = e.parent) if (e.enabled === false) return false;
    return true;
  }

  const _o = new pc.Vec3();
  const _f = new pc.Vec3();
  const _localO = new pc.Vec3();
  const _localF = new pc.Vec3();
  const _inverse = new pc.Mat4();

  // Intersect a mesh's own oriented bounds. The segment parameter survives an
  // affine transform, so the returned t remains comparable with world-AABB
  // hits. Primitive door panels use their exact local box here: unlike their
  // world AABB, it contains no empty corners after the door swings open.
  function preciseHit(instances, ox, oy, oz, fx, fy, fz) {
    let best = null;
    _o.set(ox, oy, oz);
    _f.set(fx, fy, fz);
    for (const mi of instances) {
      const local = mi.mesh?.aabb;
      const node = mi.node;
      if (!local || !node?.getWorldTransform) continue;
      _inverse.copy(node.getWorldTransform()).invert();
      _inverse.transformPoint(_o, _localO);
      _inverse.transformPoint(_f, _localF);
      _min.copy(local.getMin());
      _max.copy(local.getMax());
      const t = raySlab(
        _localO.x, _localO.y, _localO.z,
        _localF.x - _localO.x, _localF.y - _localO.y, _localF.z - _localO.z,
      );
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best;
  }

  // Nearest interactable under the screen pixel, or null. Returns a fresh
  // { entity, kind, ref } so callers never hold the internal record.
  function pick(cameraEntity, sx, sy) {
    if (!cameraEntity || !items.size) return null;
    const cam = cameraEntity.camera;
    cam.screenToWorld(sx, sy, cam.nearClip, _o);
    cam.screenToWorld(sx, sy, cam.farClip, _f);
    const dx = _f.x - _o.x;
    const dy = _f.y - _o.y;
    const dz = _f.z - _o.z;
    let bestT = Infinity;
    let best = null;
    for (const [entity, item] of items) {
      if (!visible(entity)) continue;
      let t;
      if (item.precise) {
        t = preciseHit(item.instances, _o.x, _o.y, _o.z, _f.x, _f.y, _f.z);
      } else {
        if (!bounds(item)) continue;
        t = raySlab(_o.x, _o.y, _o.z, dx, dy, dz);
      }
      if (t !== null && t < bestT) {
        bestT = t;
        best = { entity, kind: item.kind, ref: item.ref };
      }
    }
    return best;
  }

  return { register, unregister, pick };
}
