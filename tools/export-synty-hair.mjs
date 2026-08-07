// Export the small modular hair meshes used by Escape Work's Synty profile.
// Unity owns FBX import; this tool asks the installed editor for plain mesh
// arrays, then writes dependency-free GLBs into the private runtime package.
// No licensed source file crosses into the public repository or build output.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_UNITY = 'C:/Program Files/Unity/Hub/Editor/6000.4.10f1/Editor/Unity.exe';
const MANIFEST = resolve(ROOT, 'tools/synty-hair.json');
const EDITOR_SCRIPT = resolve(ROOT, 'tools/unity/ExportSyntyHair.cs');
const align4 = (value) => (value + 3) & ~3;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function options(argv) {
  const out = {
    source: resolve(ROOT, 'assets/Synty'),
    packageRoot: resolve(ROOT, 'build/private-assets-synty'),
    unity: process.env.UNITY_EDITOR || DEFAULT_UNITY,
  };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[++index];
    if (!value) throw new Error(`${key} needs a value.`);
    if (key === '--source') out.source = resolve(value);
    else if (key === '--package') out.packageRoot = resolve(value);
    else if (key === '--unity') out.unity = resolve(value);
    else throw new Error(`Unknown option: ${key}`);
  }
  return out;
}

function floatBuffer(values, width) {
  const buffer = Buffer.alloc(values.length * width * 4);
  let offset = 0;
  for (const value of values) {
    for (let axis = 0; axis < width; axis++) {
      const key = axis === 0 ? 'x' : (axis === 1 ? 'y' : 'z');
      buffer.writeFloatLE(Number(value[key] || 0), offset);
      offset += 4;
    }
  }
  return buffer;
}

function uintBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
  return buffer;
}

function glbFor(dump) {
  const sources = [
    { data: floatBuffer(dump.positions, 3), target: 34962 },
    { data: floatBuffer(dump.normals, 3), target: 34962 },
    { data: floatBuffer(dump.uv, 2), target: 34962 },
    { data: uintBuffer(dump.indices), target: 34963 },
  ];
  const parts = [];
  const bufferViews = [];
  let byteLength = 0;
  for (const source of sources) {
    const aligned = align4(byteLength);
    if (aligned > byteLength) parts.push(Buffer.alloc(aligned - byteLength));
    bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: source.data.length, target: source.target });
    parts.push(source.data);
    byteLength = aligned + source.data.length;
  }
  const binary = Buffer.concat(parts);
  const bounds = [0, 1, 2].map((axis) => {
    const key = axis === 0 ? 'x' : (axis === 1 ? 'y' : 'z');
    const values = dump.positions.map((point) => Number(point[key] || 0));
    return { min: Math.min(...values), max: Math.max(...values) };
  });
  const json = {
    asset: { version: '2.0', generator: 'Escape Work Synty hair exporter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: dump.id, mesh: 0 }],
    meshes: [{ name: dump.id, primitives: [{
      attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
      indices: 3,
      material: 0,
    }] }],
    materials: [{
      name: 'hair',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.3, 0.18, 0.08, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: dump.positions.length, type: 'VEC3', min: bounds.map((x) => x.min), max: bounds.map((x) => x.max) },
      { bufferView: 1, componentType: 5126, count: dump.normals.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: dump.uv.length, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: dump.indices.length, type: 'SCALAR' },
    ],
  };
  let jsonBuffer = Buffer.from(JSON.stringify(json));
  if (jsonBuffer.length % 4) jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(4 - (jsonBuffer.length % 4), 0x20)]);
  const paddedBinary = binary.length % 4 ? Buffer.concat([binary, Buffer.alloc(4 - (binary.length % 4))]) : binary;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuffer.length + 8 + paddedBinary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBinary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, paddedBinary]);
}

function glbFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.glb')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function refreshPackageManifest(packageRoot) {
  const path = resolve(packageRoot, 'package-manifest.json');
  const old = JSON.parse(readFileSync(path, 'utf8'));
  const files = glbFiles(packageRoot).map((absolute) => {
    const data = readFileSync(absolute);
    return {
      path: relative(packageRoot, absolute).split(sep).join('/'),
      bytes: data.length,
      sha256: sha256(data),
    };
  });
  writeFileSync(path, `${JSON.stringify({ ...old, files }, null, 2)}\n`);
}

const config = options(process.argv.slice(2));
if (!existsSync(config.unity)) throw new Error(`Unity editor not found: ${config.unity}`);
if (!existsSync(config.source) || !statSync(config.source).isDirectory()) throw new Error(`Synty source not found: ${config.source}`);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'escape-work-synty-hair-'));
try {
  for (const directory of ['Assets/Editor', 'Assets/Source', 'Packages', 'ProjectSettings', 'Dump']) {
    mkdirSync(resolve(temporary, directory), { recursive: true });
  }
  copyFileSync(EDITOR_SCRIPT, resolve(temporary, 'Assets/Editor/ExportSyntyHair.cs'));
  writeFileSync(resolve(temporary, 'Packages/manifest.json'), '{"dependencies":{}}\n');
  writeFileSync(resolve(temporary, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.4.10f1\n');
  for (const attachment of manifest.attachments) {
    const source = resolve(config.source, ...attachment.source.split('/'));
    if (!existsSync(source)) throw new Error(`Missing Synty attachment: ${source}`);
    copyFileSync(source, resolve(temporary, 'Assets/Source', `${attachment.id}.fbx`));
  }
  const result = spawnSync(config.unity, [
    '-batchmode', '-nographics', '-quit',
    '-projectPath', temporary,
    '-executeMethod', 'EscapeWork.ExportSyntyHair.Run',
    '-logFile', '-',
  ], {
    encoding: 'utf8',
    env: { ...process.env, ESCAPE_WORK_HAIR_DUMP: resolve(temporary, 'Dump') },
  });
  if (result.status !== 0) throw new Error(result.stdout || result.stderr || 'Unity hair export failed.');
  const hairRoot = resolve(config.packageRoot, 'characters/hair');
  mkdirSync(hairRoot, { recursive: true });
  for (const attachment of manifest.attachments) {
    const dump = JSON.parse(readFileSync(resolve(temporary, 'Dump', `${attachment.id}.json`), 'utf8'));
    const data = glbFor(dump);
    writeFileSync(resolve(hairRoot, `${attachment.id}.glb`), data);
    const span = [0, 1, 2].map((axis) => {
      const key = axis === 0 ? 'x' : (axis === 1 ? 'y' : 'z');
      const values = dump.positions.map((point) => Number(point[key] || 0));
      return Math.max(...values) - Math.min(...values);
    });
    console.log(`${attachment.id}: ${dump.positions.length} vertices, ${data.length} bytes, span ${span.map((x) => x.toFixed(3)).join(' x ')}`);
  }
  refreshPackageManifest(config.packageRoot);
  console.log(`Synty hair package refreshed -> ${hairRoot}`);
} finally {
  const expected = resolve(tmpdir());
  if (!temporary.startsWith(`${expected}${sep}`)) throw new Error(`Refusing to remove unexpected path: ${temporary}`);
  rmSync(temporary, { recursive: true, force: true });
}
