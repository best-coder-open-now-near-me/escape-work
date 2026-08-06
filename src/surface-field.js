// Fine-resolution surface storage. Terrain and office objects live in grid.js;
// spills, litter and other things underfoot live here. Coordinates passed to
// this module are WORLD coordinates: movement tile (0, 0) spans -0.5..0.5 on
// each axis, regardless of this field's resolution.
//
// Integer keys keep equality, flood fill and save/debug output deterministic.
// Nothing outside this module should derive an integer key from world space;
// callers ask the field so changing SURFACE_QUANTUM does not become a rewrite.
export const SURFACE_QUANTUM = 0.5;

const EPSILON = 1e-9;

function validateDimensions(width, height, quantum) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError('SurfaceField width and height must be positive integers.');
  }
  if (!Number.isFinite(quantum) || quantum <= 0) {
    throw new TypeError('SurfaceField quantum must be a positive number.');
  }
  const cellsPerTile = Math.round(1 / quantum);
  if (Math.abs(cellsPerTile * quantum - 1) > EPSILON) {
    throw new RangeError('SurfaceField quantum must divide one movement tile exactly.');
  }
  return cellsPerTile;
}

const sameMetadata = (a, b) => {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => Object.is(a[key], b[key]));
};

export function createSurfaceField({ width, height, quantum = SURFACE_QUANTUM }) {
  const cellsPerTile = validateDimensions(width, height, quantum);
  const cellWidth = width * cellsPerTile;
  const cellHeight = height * cellsPerTile;
  const cells = new Map();
  const listeners = new Set();
  let transaction = null;

  const keyOf = (ix, iz) => `${ix},${iz}`;
  const inBoundsCell = (ix, iz) => Number.isInteger(ix) && Number.isInteger(iz)
    && ix >= 0 && ix < cellWidth && iz >= 0 && iz < cellHeight;
  const inBoundsPoint = (x, z) => Number.isFinite(x) && Number.isFinite(z)
    && x >= -0.5 && x < width - 0.5 && z >= -0.5 && z < height - 0.5;
  const pointToCell = (x, z) => {
    if (!inBoundsPoint(x, z)) return null;
    return {
      ix: Math.floor((x + 0.5) / quantum),
      iz: Math.floor((z + 0.5) / quantum),
    };
  };
  const cellCenter = (ix, iz) => inBoundsCell(ix, iz)
    ? { x: -0.5 + (ix + 0.5) * quantum, z: -0.5 + (iz + 0.5) * quantum }
    : null;

  const emit = (changes, reason = null) => {
    if (!changes.length && !reason) return;
    const changeSet = Object.freeze({ changes: Object.freeze(changes), reason });
    for (const listener of listeners) listener(changeSet);
  };
  const record = (change) => {
    if (transaction) transaction.push(change);
    else emit([change]);
  };

  const cellAt = (ix, iz) => cells.get(keyOf(ix, iz)) || null;
  const setCell = (ix, iz, surfaceId, metadata = {}) => {
    if (!inBoundsCell(ix, iz)) return false;
    if (surfaceId == null) return clearCell(ix, iz);
    if (typeof surfaceId !== 'string' || !surfaceId) {
      throw new TypeError('Surface id must be a non-empty string.');
    }
    const key = keyOf(ix, iz);
    const before = cells.get(key) || null;
    // The id is the operation's subject, never metadata a caller can shadow.
    const after = Object.freeze({ ...metadata, surfaceId });
    if (before?.surfaceId === surfaceId && sameMetadata(before, after)) return false;
    cells.set(key, after);
    record(Object.freeze({ ix, iz, before, after }));
    return true;
  };
  function clearCell(ix, iz) {
    if (!inBoundsCell(ix, iz)) return false;
    const key = keyOf(ix, iz);
    const before = cells.get(key);
    if (!before) return false;
    cells.delete(key);
    record(Object.freeze({ ix, iz, before, after: null }));
    return true;
  }

  // One logical edit yields one change set. Nested helpers participate in the
  // outer edit, so fillTile/future masks can be composed without repainting,
  // rerouting and recomputing conduction once per fine cell.
  const edit = (fn) => {
    if (transaction) return fn();
    transaction = [];
    try {
      return fn();
    } finally {
      const changes = transaction;
      transaction = null;
      emit(changes);
    }
  };

  const fillTile = (x, z, surfaceId, metadata = {}) => {
    if (!Number.isInteger(x) || !Number.isInteger(z)
      || x < 0 || x >= width || z < 0 || z >= height) return false;
    let changed = false;
    edit(() => {
      const startX = x * cellsPerTile;
      const startZ = z * cellsPerTile;
      for (let iz = startZ; iz < startZ + cellsPerTile; iz++) {
        for (let ix = startX; ix < startX + cellsPerTile; ix++) {
          changed = setCell(ix, iz, surfaceId, metadata) || changed;
        }
      }
    });
    return changed;
  };
  const clearTile = (x, z) => {
    if (!Number.isInteger(x) || !Number.isInteger(z)
      || x < 0 || x >= width || z < 0 || z >= height) return false;
    let changed = false;
    edit(() => {
      const startX = x * cellsPerTile;
      const startZ = z * cellsPerTile;
      for (let iz = startZ; iz < startZ + cellsPerTile; iz++) {
        for (let ix = startX; ix < startX + cellsPerTile; ix++) {
          changed = clearCell(ix, iz) || changed;
        }
      }
    });
    return changed;
  };
  const clearSource = (sourceKey) => {
    if (sourceKey == null) return false;
    let changed = false;
    edit(() => {
      for (const [key, record] of [...cells]) {
        if (record.sourceKey !== sourceKey) continue;
        const [ix, iz] = key.split(',').map(Number);
        changed = clearCell(ix, iz) || changed;
      }
    });
    return changed;
  };

  const recordAt = (x, z) => {
    const index = pointToCell(x, z);
    return index ? cellAt(index.ix, index.iz) : null;
  };
  const surfaceAt = (x, z) => recordAt(x, z)?.surfaceId || null;
  const setAt = (x, z, surfaceId, metadata = {}) => {
    const index = pointToCell(x, z);
    return index ? setCell(index.ix, index.iz, surfaceId, metadata) : false;
  };
  const clearAt = (x, z) => {
    const index = pointToCell(x, z);
    return index ? clearCell(index.ix, index.iz) : false;
  };
  const entries = () => [...cells].map(([key, value]) => {
    const [ix, iz] = key.split(',').map(Number);
    return { ix, iz, ...cellCenter(ix, iz), ...value };
  });
  // Split a straight world-space movement segment wherever it crosses a fine
  // cell edge. Exact boundary parameters make contact independent of frame
  // rate and movement speed; callers may sample dynamic fire/electric state at
  // each span's midpoint without mistaking a skipped cell for bare floor.
  const traceSegment = (x0, z0, x1, z1) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const total = Math.hypot(dx, dz);
    if (!(total > EPSILON)) return [];
    const cuts = [0, 1];
    if (Math.abs(dx) > EPSILON) {
      for (let ix = 1; ix < cellWidth; ix++) {
        const boundary = -0.5 + ix * quantum;
        const t = (boundary - x0) / dx;
        if (t > EPSILON && t < 1 - EPSILON) cuts.push(t);
      }
    }
    if (Math.abs(dz) > EPSILON) {
      for (let iz = 1; iz < cellHeight; iz++) {
        const boundary = -0.5 + iz * quantum;
        const t = (boundary - z0) / dz;
        if (t > EPSILON && t < 1 - EPSILON) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    const unique = cuts.filter((t, i) => i === 0 || Math.abs(t - cuts[i - 1]) > EPSILON);
    const spans = [];
    for (let i = 1; i < unique.length; i++) {
      const t0 = unique[i - 1];
      const t1 = unique[i];
      const tm = (t0 + t1) / 2;
      const mx = x0 + dx * tm;
      const mz = z0 + dz * tm;
      const index = pointToCell(mx, mz);
      spans.push({
        t0,
        t1,
        distance: total * (t1 - t0),
        from: { x: x0 + dx * t0, z: z0 + dz * t0 },
        to: { x: x0 + dx * t1, z: z0 + dz * t1 },
        midpoint: { x: mx, z: mz },
        ix: index?.ix ?? null,
        iz: index?.iz ?? null,
        record: index ? cellAt(index.ix, index.iz) : null,
      });
    }
    return spans;
  };
  const onChange = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  // Derived surface presentation can change without a cell mutation (today:
  // toppling a partition can join a water pool to a cable). It still travels
  // through the one invalidation seam consumers already subscribe to.
  const invalidate = (reason = 'derived') => emit([], reason);

  return {
    width,
    height,
    quantum,
    cellsPerTile,
    cellWidth,
    cellHeight,
    keyOf,
    inBoundsCell,
    inBoundsPoint,
    pointToCell,
    cellCenter,
    cellAt,
    recordAt,
    surfaceAt,
    setCell,
    clearCell,
    setAt,
    clearAt,
    fillTile,
    clearTile,
    clearSource,
    edit,
    entries,
    traceSegment,
    onChange,
    invalidate,
    get size() { return cells.size; },
  };
}
