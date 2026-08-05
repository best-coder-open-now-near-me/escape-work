// Pure/mutable document operations for the level editor. The browser host owns
// rendering and history; this module owns coordinate remapping and invariants
// for one storey so those rules can be tested without PlayCanvas or the DOM.

export function storeySize(storey) {
  const height = storey.rows.length;
  const width = height ? Math.max(...storey.rows.map((row) => row.length)) : 0;
  return { width, height };
}

export function cloneEditorStorey(storey) {
  return {
    ...storey,
    rows: storey.rows.map((row) => row.slice()),
    hWalls: new Set(storey.hWalls),
    vWalls: new Set(storey.vWalls),
    hDoors: new Set(storey.hDoors),
    vDoors: new Set(storey.vDoors),
    propRot: new Map(storey.propRot),
  };
}

export function resizedDimension(current, delta, minSize = 4, maxSize = 40) {
  if (!delta) return current;
  if (delta < 0) return Math.max(minSize, current + delta);
  return current >= maxSize ? current : Math.min(maxSize, current + delta);
}

export function edgeInDocument(o, x, z, width, height) {
  if (o === 'h') return x >= 0 && x < width && z >= 0 && z <= height;
  return x >= 0 && x <= width && z >= 0 && z < height;
}

const movedKeys = (values, dx, dz, keep) => new Set([...values]
  .map((key) => key.split(',').map(Number))
  .map(([x, z]) => [x + dx, z + dz])
  .filter(([x, z]) => keep(x, z))
  .map(([x, z]) => `${x},${z}`));

const movedRotations = (values, dx, dz, width, height) => new Map([...values]
  .map(([key, rotY]) => [...key.split(',').map(Number), rotY])
  .map(([x, z, rotY]) => [x + dx, z + dz, rotY])
  .filter(([x, z]) => x >= 0 && x < width && z >= 0 && z < height)
  .map(([x, z, rotY]) => [`${x},${z}`, rotY]));

export function shiftEditorStorey(storey, dx, dz, {
  blank = '.', minSize = 4, maxSize = 40, isActor = () => false,
} = {}) {
  const { width, height } = storeySize(storey);
  const nextWidth = resizedDimension(width, dx, minSize, maxSize);
  const nextHeight = resizedDimension(height, dz, minSize, maxSize);
  const shiftX = nextWidth - width;
  const shiftZ = nextHeight - height;
  if (!shiftX && !shiftZ) return null;

  let lostActors = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if ((shiftX < 0 && x < -shiftX) || (shiftZ < 0 && z < -shiftZ)) {
        if (isActor(storey.rows[z]?.[x])) lostActors++;
      }
    }
  }

  const next = cloneEditorStorey(storey);
  if (shiftZ > 0) {
    for (let i = 0; i < shiftZ; i++) next.rows.unshift(new Array(width).fill(blank));
  } else {
    for (let i = 0; i < -shiftZ; i++) next.rows.shift();
  }
  for (const row of next.rows) {
    if (shiftX > 0) for (let i = 0; i < shiftX; i++) row.unshift(blank);
    else for (let i = 0; i < -shiftX; i++) row.shift();
  }

  next.hWalls = movedKeys(next.hWalls, shiftX, shiftZ,
    (x, z) => edgeInDocument('h', x, z, nextWidth, nextHeight));
  next.vWalls = movedKeys(next.vWalls, shiftX, shiftZ,
    (x, z) => edgeInDocument('v', x, z, nextWidth, nextHeight));
  next.hDoors = movedKeys(next.hDoors, shiftX, shiftZ,
    (x, z) => edgeInDocument('h', x, z, nextWidth, nextHeight));
  next.vDoors = movedKeys(next.vDoors, shiftX, shiftZ,
    (x, z) => edgeInDocument('v', x, z, nextWidth, nextHeight));
  next.propRot = movedRotations(next.propRot, shiftX, shiftZ, nextWidth, nextHeight);
  return { storey: next, width: nextWidth, height: nextHeight, lostActors };
}

export function resizeEditorStorey(storey, dw, dh, {
  blank = '.', minSize = 4, maxSize = 40, isActor = () => false,
} = {}) {
  const { width, height } = storeySize(storey);
  const nextWidth = resizedDimension(width, dw, minSize, maxSize);
  const nextHeight = resizedDimension(height, dh, minSize, maxSize);
  if (nextWidth === width && nextHeight === height) return null;

  let lostActors = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (x >= nextWidth || z >= nextHeight) {
        if (isActor(storey.rows[z]?.[x])) lostActors++;
      }
    }
  }

  const next = cloneEditorStorey(storey);
  while (next.rows.length < nextHeight) next.rows.push(new Array(width).fill(blank));
  while (next.rows.length > nextHeight) next.rows.pop();
  for (const row of next.rows) {
    while (row.length < nextWidth) row.push(blank);
    while (row.length > nextWidth) row.pop();
  }
  const keepH = (key) => {
    const [x, z] = key.split(',').map(Number);
    return edgeInDocument('h', x, z, nextWidth, nextHeight);
  };
  const keepV = (key) => {
    const [x, z] = key.split(',').map(Number);
    return edgeInDocument('v', x, z, nextWidth, nextHeight);
  };
  next.hWalls = new Set([...next.hWalls].filter(keepH));
  next.vWalls = new Set([...next.vWalls].filter(keepV));
  next.hDoors = new Set([...next.hDoors].filter(keepH));
  next.vDoors = new Set([...next.vDoors].filter(keepV));
  next.propRot = movedRotations(next.propRot, 0, 0, nextWidth, nextHeight);
  return { storey: next, width: nextWidth, height: nextHeight, lostActors };
}

export function paintDocumentCell(storey, x, z, char, { playerChar = '@', blank = '.' } = {}) {
  const { width, height } = storeySize(storey);
  if (x < 0 || x >= width || z < 0 || z >= height || storey.rows[z][x] === char) {
    return { changed: false, clearedPlayer: [] };
  }
  const clearedPlayer = [];
  if (char === playerChar) {
    for (let zz = 0; zz < height; zz++) {
      const xx = storey.rows[zz].indexOf(playerChar);
      if (xx === -1) continue;
      storey.rows[zz][xx] = blank;
      storey.propRot.delete(`${xx},${zz}`);
      clearedPlayer.push({ x: xx, z: zz });
    }
  }
  storey.rows[z][x] = char;
  storey.propRot.delete(`${x},${z}`);
  return { changed: true, clearedPlayer };
}

const edgeSets = (storey, o) => (o === 'h'
  ? { walls: storey.hWalls, doors: storey.hDoors }
  : { walls: storey.vWalls, doors: storey.vDoors });

export function setDocumentEdge(storey, o, x, z, kind) {
  const { walls, doors } = edgeSets(storey, o);
  const key = `${x},${z}`;
  const before = walls.has(key) ? 'wall' : doors.has(key) ? 'door' : null;
  if (before === kind && !(walls.has(key) && doors.has(key))) return false;
  walls.delete(key);
  doors.delete(key);
  if (kind === 'wall') walls.add(key);
  if (kind === 'door') doors.add(key);
  return true;
}

export function stampDocumentEdges(storey, clipboard, at, width, height) {
  let changed = false;
  const put = (pairs, o, kind) => {
    for (const [dx, dz] of pairs) {
      const x = at.x + dx;
      const z = at.z + dz;
      if (!edgeInDocument(o, x, z, width, height)) continue;
      changed = setDocumentEdge(storey, o, x, z, kind) || changed;
    }
  };
  // Doors win if malformed clipboard data contains both, matching level load.
  put(clipboard.hWalls, 'h', 'wall');
  put(clipboard.vWalls, 'v', 'wall');
  put(clipboard.hDoors, 'h', 'door');
  put(clipboard.vDoors, 'v', 'door');
  return changed;
}
