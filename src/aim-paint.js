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
const CLIP_EPSILON = 1e-7;

const cellIndex = (point, quantum) => ({
  ix: Math.round((point[0] + 0.5) / quantum - 0.5),
  iz: Math.round((point[1] + 0.5) / quantum - 0.5),
});

function clipPolygonFor(shape) {
  if (!shape) return null;
  if (shape.kind === 'circle') {
    const segments = Math.max(24, shape.segments || 64);
    return Array.from({ length: segments }, (_, i) => {
      const a = i * Math.PI * 2 / segments;
      return { x: shape.x + Math.cos(a) * shape.radius, z: shape.z + Math.sin(a) * shape.radius };
    });
  }
  if (shape.kind === 'polygon') {
    const points = (shape.points || []).map(([x, z]) => ({ x, z }));
    if (points.length > 1
      && Math.hypot(points[0].x - points.at(-1).x, points[0].z - points.at(-1).z) < CLIP_EPSILON) {
      points.pop();
    }
    return points;
  }
  return null;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function clipConvex(subject, boundary) {
  if (!boundary || boundary.length < 3) return subject;
  const clip = polygonArea(boundary) < 0 ? [...boundary].reverse() : boundary;
  let output = subject;
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const from = input[j];
      const to = input[(j + 1) % input.length];
      const fromSide = side(from);
      const toSide = side(to);
      const fromInside = fromSide >= -CLIP_EPSILON;
      const toInside = toSide >= -CLIP_EPSILON;
      const crossing = () => {
        const t = fromSide / (fromSide - toSide);
        return {
          x: from.x + (to.x - from.x) * t,
          z: from.z + (to.z - from.z) * t,
          alpha: from.alpha + (to.alpha - from.alpha) * t,
        };
      };
      if (fromInside && toInside) output.push(to);
      else if (fromInside) output.push(crossing());
      else if (toInside) output.push(crossing(), to);
    }
  }
  return output;
}

export function buildAimGeometry(cells, quantum, clipShape = null) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const clip = clipPolygonFor(clipShape);
  const clipFeather = quantum * FEATHER_FRACTION;
  const indexed = cells.map((point) => ({ point, ...cellIndex(point, quantum) }));
  const occupied = new Set(indexed.map(({ ix, iz }) => `${ix},${iz}`));

  const vertex = (x, z, alpha) => {
    if (clipShape?.kind === 'circle') {
      const inset = clipShape.radius - Math.hypot(x - clipShape.x, z - clipShape.z);
      alpha *= Math.max(0, Math.min(1, inset / clipFeather));
    }
    const n = positions.length / 3;
    positions.push(x, PAINT_Y, z);
    normals.push(0, 1, 0);
    colors.push(255, 255, 255, Math.round(alpha));
    return n;
  };
  const quad = (corners, alphas = [255, 255, 255, 255]) => {
    let polygon = corners.map(([x, z], i) => ({ x, z, alpha: alphas[i] }));
    polygon = clipConvex(polygon, clip);
    if (polygon.length < 3) return;
    const base = polygon.map(({ x, z, alpha }) => vertex(x, z, alpha));
    // x/z geometry needs the reverse winding for an upward normal.
    for (let i = 2; i < base.length; i++) indices.push(base[0], base[i], base[i - 1]);
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
  const paintMaterial = (color, emissive) => {
    const material = makeMaterial(color, { opacity: 0.3, emissive });
    material.opacityVertexColor = true;
    material.opacityVertexColorChannel = 'a';
    material.update();
    return material;
  };
  const materials = {
    valid: paintMaterial([0.3, 0.52, 0.92], [0.16, 0.3, 0.6]),
    invalid: paintMaterial([0.78, 0.2, 0.18], [0.5, 0.08, 0.06]),
  };

  let key = null;
  let tone = null;
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
    show(newKey, cellsFn, quantum = 1, clipShape = null, nextTone = 'valid') {
      if (newKey === key && nextTone === tone) return;
      key = newKey;
      tone = nextTone;
      shownCells = cellsFn();
      clearMesh();
      if (!shownCells.length) return;
      const geo = buildAimGeometry(shownCells, quantum, clipShape);
      mesh = new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(geo.positions);
      mesh.setNormals(geo.normals);
      mesh.setColors32(geo.colors);
      mesh.setIndices(geo.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      entity = new pc.Entity('aim-region');
      entity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(mesh, materials[nextTone] || materials.valid)],
      });
      entity.render.castShadows = false;
      holder.addChild(entity);
    },
    hide() {
      if (key === null && !entity) return;
      key = null;
      tone = null;
      shownCells = [];
      clearMesh();
    },
    destroy() {
      clearMesh();
      materials.valid.destroy();
      materials.invalid.destroy();
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
      return { key, tone, count: shownCells.length, tiles, cells: shownCells.map((p) => [...p]) };
    },
  };
}
