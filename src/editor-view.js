import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { parseLevel } from './grid.js';

// The PlayCanvas projection of an editor document. The document stays with
// startEditor; this owner keeps scene entities, async-render generations,
// derived carpet/conduction overlays, grid/onion helpers and camera focus.
export function createEditorView({
  app,
  pc,
  tileTypes,
  playerChar,
  actorIdByChar,
  document: d,
  serialize,
  follow,
  onSize = () => {},
  onStatus = () => {},
}) {
  const renderer = createTileRenderer(app);
  const focus = { x: 0, z: 0 };
  let orientationUpdater = () => {};

  const refocus = () => {
    focus.x = (d.width - 1) / 2;
    focus.z = (d.height - 1) / 2;
  };
  app.on('update', (dt) => {
    renderer.animate(dt);
    follow(focus, dt);
    orientationUpdater();
  });

  const mat = (rgb) => {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
    m.update();
    return m;
  };
  const playerMat = mat([0.3, 0.8, 0.45]);
  const hueToRgb = (h, s = 0.62, l = 0.58) => {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
    return [f(0), f(8), f(4)];
  };
  const actorMats = {};
  const actorMat = (id) => {
    if (!actorMats[id]) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      actorMats[id] = mat(hueToRgb(((h % 300) + 60) / 360));
    }
    return actorMats[id];
  };

  let electrified = new Set();
  function computeElectrifiedSet() {
    const next = new Set();
    try {
      const grid = parseLevel(JSON.parse(serialize()));
      for (let z = 0; z < grid.height; z++) {
        for (let x = 0; x < grid.width; x++) {
          if (grid.isElectrified(x, z)) next.add(x + ',' + z);
        }
      }
    } catch { /* a document may be momentarily unparsable while painting */ }
    return next;
  }

  let carpet = new Map();
  const effectiveTypeAt = (x, z) => {
    const ch = d.rows[z]?.[x];
    if (ch === undefined || ch === ' ') return null;
    if (ch === playerChar || actorIdByChar[ch] || d.tierCharIds[ch]) return 'floor';
    return d.tileByChar[ch] || 'floor';
  };
  const computeCarpet = () => computeCarpetZones(effectiveTypeAt, d.width, d.height);

  const cellEntities = new Map();
  const cellVersion = new Map();
  const addBox = (material, x, y, z, sx, sy, sz) => {
    const entity = new pc.Entity();
    entity.addComponent('render', { type: 'box', material });
    entity.setLocalScale(sx, sy, sz);
    entity.setPosition(x, y, z);
    app.root.addChild(entity);
    return entity;
  };

  function renderCell(x, z) {
    const ch = d.rows[z]?.[x];
    if (ch === undefined) return;
    const key = x + ',' + z;
    const version = (cellVersion.get(key) || 0) + 1;
    cellVersion.set(key, version);
    for (const entity of cellEntities.get(key) || []) entity.destroy();
    const out = [];
    cellEntities.set(key, out);
    if (ch === ' ') return;
    const actorId = actorIdByChar[ch] || d.tierCharIds[ch];
    const isActor = ch === playerChar || !!actorId;
    out.push(renderer.renderFloor(x, z,
      carpet.get(key) || (isActor ? 'floor' : d.tileByChar[ch] || 'floor')));
    if (ch === playerChar) {
      out.push(addBox(playerMat, x, 0.35, z, 0.55, 0.5, 0.55));
      return;
    }
    if (actorId) {
      out.push(addBox(actorMat(actorId), x, 0.35, z, 0.55, 0.5, 0.55));
      return;
    }
    const type = d.tileByChar[ch] || 'floor';
    if (type === 'floor') return;
    const result = renderer.renderMarker(x, z, type, {
      electrified: electrified.has(key),
      rotY: d.propRot.get(key) ?? null,
      surfaceAt: (sx, sz) => {
        const c = d.rows[sz]?.[sx];
        return c && c !== ' ' ? tileTypes[d.tileByChar[c]]?.surface || null : null;
      },
      onAsync: (holder) => {
        if (cellVersion.get(key) !== version) holder.destroy();
        else out.push(holder);
      },
    });
    out.push(...result.entities);
  }

  const edgeEntities = new Map();
  function edgeInRange(o, x, z) {
    if (o === 'h') return x >= 0 && x < d.width && z >= 0 && z <= d.height;
    return x >= 0 && x <= d.width && z >= 0 && z < d.height;
  }
  function nearestEdge(point) {
    if (!point) return null;
    const x = Math.round(point.x);
    const z = Math.round(point.z);
    const dx = point.x - x;
    const dz = point.z - z;
    if (Math.abs(dx) >= Math.abs(dz)) return { o: 'v', x: dx > 0 ? x + 1 : x, z };
    return { o: 'h', x, z: dz > 0 ? z + 1 : z };
  }
  function renderEdge(o, x, z) {
    const key = x + ',' + z;
    const entityKey = o + ':' + key;
    edgeEntities.get(entityKey)?.destroy();
    edgeEntities.delete(entityKey);
    const walls = o === 'h' ? d.hWalls : d.vWalls;
    const doors = o === 'h' ? d.hDoors : d.vDoors;
    if (walls.has(key)) edgeEntities.set(entityKey, renderer.renderEdgeWall(x, z, o));
    else if (doors.has(key)) edgeEntities.set(entityKey, renderer.renderDoor(x, z, o, false).holder);
  }
  function renderAllEdges() {
    for (const entity of edgeEntities.values()) entity.destroy();
    edgeEntities.clear();
    for (const [o, keys] of [['h', d.hWalls], ['v', d.vWalls], ['h', d.hDoors], ['v', d.vDoors]]) {
      for (const key of keys) {
        const [x, z] = key.split(',').map(Number);
        renderEdge(o, x, z);
      }
    }
  }

  function refreshElectrified(skipX = null, skipZ = null) {
    const next = computeElectrifiedSet();
    const changed = [];
    for (const key of next) if (!electrified.has(key)) changed.push(key);
    for (const key of electrified) if (!next.has(key)) changed.push(key);
    electrified = next;
    for (const key of changed) {
      const [x, z] = key.split(',').map(Number);
      if (x !== skipX || z !== skipZ) renderCell(x, z);
    }
  }
  function refreshCarpet(skipX = null, skipZ = null) {
    const next = computeCarpet();
    const changed = new Set();
    for (const [key, type] of next) if (carpet.get(key) !== type) changed.add(key);
    for (const key of carpet.keys()) if (!next.has(key)) changed.add(key);
    carpet = next;
    for (const key of changed) {
      const [x, z] = key.split(',').map(Number);
      if (x !== skipX || z !== skipZ) renderCell(x, z);
    }
  }

  let gridEntities = [];
  let gridMat = null;
  let showGrid = true;
  function renderGrid() {
    for (const entity of gridEntities) entity.destroy();
    gridEntities = [];
    if (!showGrid || !d.width || !d.height) return;
    if (!gridMat) {
      gridMat = new pc.StandardMaterial();
      gridMat.diffuse = new pc.Color(0.1, 0.1, 0.14);
      gridMat.emissive = new pc.Color(0.28, 0.3, 0.38);
      gridMat.opacity = 0.3;
      gridMat.blendType = pc.BLEND_NORMAL;
      gridMat.depthWrite = false;
      gridMat.update();
    }
    const line = (x, y, z, sx, sz) => {
      const entity = new pc.Entity();
      entity.addComponent('render', { type: 'box', material: gridMat });
      entity.setLocalScale(sx, 0.01, sz);
      entity.setPosition(x, y, z);
      app.root.addChild(entity);
      gridEntities.push(entity);
    };
    for (let x = 0; x <= d.width; x++) {
      line(x - 0.5, 0.02, d.height / 2 - 0.5, x % 5 === 0 ? 0.06 : 0.02, d.height);
    }
    for (let z = 0; z <= d.height; z++) {
      line(d.width / 2 - 0.5, 0.02, z - 0.5, d.width, z % 5 === 0 ? 0.06 : 0.02);
    }
  }
  function toggleGrid() {
    showGrid = !showGrid;
    renderGrid();
    return showGrid;
  }

  let onionEntities = [];
  let onionMat = null;
  function renderOnionSkin() {
    for (const entity of onionEntities) entity.destroy();
    onionEntities = [];
    if (d.active === 0) return;
    const below = d.storeys[d.active - 1];
    if (!below) return;
    if (!onionMat) {
      onionMat = new pc.StandardMaterial();
      onionMat.diffuse = new pc.Color(0.45, 0.62, 0.85);
      onionMat.opacity = 0.22;
      onionMat.blendType = pc.BLEND_NORMAL;
      onionMat.depthWrite = false;
      onionMat.update();
    }
    for (let z = 0; z < below.rows.length; z++) {
      for (let x = 0; x < below.rows[z].length; x++) {
        if (below.rows[z][x] === ' ') continue;
        if (d.rows[z]?.[x] !== undefined && d.rows[z][x] !== ' ') continue;
        const entity = new pc.Entity();
        entity.addComponent('render', { type: 'box', material: onionMat });
        entity.setLocalScale(0.92, 0.02, 0.92);
        entity.setPosition(x, -0.06, z);
        app.root.addChild(entity);
        onionEntities.push(entity);
      }
    }
  }

  function invalidateCells() {
    for (const list of cellEntities.values()) for (const entity of list) entity.destroy();
    cellEntities.clear();
    for (const [key, version] of cellVersion) cellVersion.set(key, version + 1);
  }
  function recomputeDerived() {
    electrified = computeElectrifiedSet();
    carpet = computeCarpet();
  }
  function renderAll() {
    invalidateCells();
    recomputeDerived();
    for (let z = 0; z < d.height; z++) for (let x = 0; x < d.width; x++) renderCell(x, z);
    renderAllEdges();
    renderGrid();
    renderOnionSkin();
    onSize();
    refocus();
    onStatus();
  }
  function resizeRefresh({ repaintExisting = false } = {}) {
    for (const [key, list] of [...cellEntities]) {
      const [x, z] = key.split(',').map(Number);
      if (x < d.width && z < d.height) continue;
      for (const entity of list) entity.destroy();
      cellEntities.delete(key);
      cellVersion.set(key, (cellVersion.get(key) || 0) + 1);
    }
    recomputeDerived();
    for (let z = 0; z < d.height; z++) {
      for (let x = 0; x < d.width; x++) {
        if (repaintExisting || !cellEntities.has(x + ',' + z)) renderCell(x, z);
      }
    }
    renderAllEdges();
    renderGrid();
    renderOnionSkin();
    onSize();
    refocus();
  }

  return {
    focus,
    refocus,
    renderCell,
    renderEdge,
    renderAllEdges,
    renderAll,
    resizeRefresh,
    refreshElectrified,
    refreshCarpet,
    edgeInRange,
    nearestEdge,
    toggleGrid,
    carpetAt: (x, z) => carpet.get(x + ',' + z) || null,
    setOrientationUpdater(fn) { orientationUpdater = fn || (() => {}); },
  };
}
