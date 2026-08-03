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

  function register(entity, kind, ref) {
    if (!entity || items.has(entity)) return;
    const instances = [];
    for (const rc of entity.findComponents('render')) {
      // Skip the decorative shells (ink outline, hover highlight) so the
      // pick box hugs the real geometry, not an inflated hull.
      if (rc.entity.name === 'outlines' || rc.entity.name === 'highlight') continue;
      for (const mi of rc.meshInstances) instances.push(mi);
    }
    if (!instances.length) return;
    items.set(entity, { kind, ref, instances });
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

  const _o = new pc.Vec3();
  const _f = new pc.Vec3();
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
      if (!bounds(item)) continue;
      const t = raySlab(_o.x, _o.y, _o.z, dx, dy, dz);
      if (t !== null && t < bestT) {
        bestT = t;
        best = { entity, kind: item.kind, ref: item.ref };
      }
    }
    return best;
  }

  return { register, unregister, pick };
}
