// The ground read while aiming: one merged, soft-edged region covering the
// exact fine cells the armed verb can use. Storage cells are an implementation
// detail, so there is one mesh and no per-tile chips, jitter, or circles. Body
// target rings remain separate in ground-marks/combat-body-targets.
import { makeMaterial } from './shading.js';

// Lazy like shading.js: the unit suite can import this chain without a DOM.
const pc = new Proxy({}, { get: (_, k) => window.pc[k] });

// Above the floor and surface decals, below route lines and body rings.
const PAINT_Y = 0.13;
const FEATHER_FRACTION = 0.22;

const cellIndex = (point, quantum) => ({
  ix: Math.round((point[0] + 0.5) / quantum - 0.5),
  iz: Math.round((point[1] + 0.5) / quantum - 0.5),
});

function mergedGeometry(cells, quantum) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const indexed = cells.map((point) => ({ point, ...cellIndex(point, quantum) }));
  const occupied = new Set(indexed.map(({ ix, iz }) => `${ix},${iz}`));

  const vertex = (x, z, alpha) => {
    const n = positions.length / 3;
    positions.push(x, PAINT_Y, z);
    normals.push(0, 1, 0);
    colors.push(255, 255, 255, alpha);
    return n;
  };
  const quad = (corners, alphas = [255, 255, 255, 255]) => {
    const base = corners.map(([x, z], i) => vertex(x, z, alphas[i]));
    // x/z geometry needs the reverse winding for an upward normal.
    indices.push(base[0], base[2], base[1], base[0], base[3], base[2]);
  };

  const half = quantum / 2;
  const feather = quantum * FEATHER_FRACTION;
  for (const { point: [x, z], ix, iz } of indexed) {
    const minX = x - half;
    const maxX = x + half;
    const minZ = z - half;
    const maxZ = z + half;
    // Full-cell cores touch exactly. With one coplanar mesh there are no gaps,
    // rotations, or material boundaries to reveal the storage lattice.
    quad([[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]);
    if (!occupied.has(`${ix - 1},${iz}`)) {
      quad([[minX - feather, minZ], [minX, minZ], [minX, maxZ], [minX - feather, maxZ]],
        [0, 255, 255, 0]);
    }
    if (!occupied.has(`${ix + 1},${iz}`)) {
      quad([[maxX, minZ], [maxX + feather, minZ], [maxX + feather, maxZ], [maxX, maxZ]],
        [255, 0, 0, 255]);
    }
    if (!occupied.has(`${ix},${iz - 1}`)) {
      quad([[minX, minZ - feather], [maxX, minZ - feather], [maxX, minZ], [minX, minZ]],
        [0, 0, 255, 255]);
    }
    if (!occupied.has(`${ix},${iz + 1}`)) {
      quad([[minX, maxZ], [maxX, maxZ], [maxX, maxZ + feather], [minX, maxZ + feather]],
        [255, 255, 0, 0]);
    }
  }
  return { positions, normals, colors, indices };
}

export function createAimPaint(app) {
  const holder = new pc.Entity('aim-paint');
  app.root.addChild(holder);
  const mat = makeMaterial([0.3, 0.52, 0.92], {
    opacity: 0.3,
    emissive: [0.16, 0.3, 0.6],
  });
  mat.opacityVertexColor = true;
  mat.opacityVertexColorChannel = 'a';
  mat.update();

  let key = null;
  let entity = null;
  let mesh = null;
  let shownCells = [];

  function clearMesh() {
    // Destroying the render component releases its MeshInstance; PlayCanvas
    // then destroys an unreferenced mesh. Only destroy directly if construction
    // stopped before an entity took ownership.
    if (entity) entity.destroy();
    else mesh?.destroy();
    entity = null;
    mesh = null;
  }

  return {
    // `cellsFn` returns fine-cell world centres as [x,z]. `newKey` names the
    // verb/origin/world epoch; unchanged aims do no geometry work per frame.
    show(newKey, cellsFn, quantum = 1) {
      if (newKey === key) return;
      key = newKey;
      shownCells = cellsFn();
      clearMesh();
      if (!shownCells.length) return;
      const geo = mergedGeometry(shownCells, quantum);
      mesh = new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(geo.positions);
      mesh.setNormals(geo.normals);
      mesh.setColors32(geo.colors);
      mesh.setIndices(geo.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      entity = new pc.Entity('aim-region');
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, mat)] });
      entity.render.castShadows = false;
      holder.addChild(entity);
    },
    hide() {
      if (key === null && !entity) return;
      key = null;
      shownCells = [];
      clearMesh();
    },
    destroy() {
      clearMesh();
      mat.destroy();
      holder.destroy();
    },
    // Preserve the debug contract's movement-tile projection while exposing
    // the real fine-cell centres for assertions that need continuous detail.
    get debug() {
      const seen = new Set();
      const tiles = [];
      for (const [x, z] of shownCells) {
        const k = `${Math.round(x)},${Math.round(z)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        tiles.push(k.split(',').map(Number));
      }
      return { key, count: shownCells.length, tiles, cells: shownCells.map((p) => [...p]) };
    },
  };
}
