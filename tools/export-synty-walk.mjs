// Retarget the licensed Human Basic Motions walk through Unity Humanoid and
// replace only the `walk` animation in Escape Work's private Synty GLBs.
// Existing mesh, material, skin, and combat animation data stays byte-for-byte
// represented in the rebuilt container.
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_UNITY = 'C:/Program Files/Unity/Hub/Editor/6000.4.10f1/Editor/Unity.exe';
const MANIFEST = resolve(ROOT, 'tools/synty-walk.json');
const EDITOR_SCRIPT = resolve(ROOT, 'tools/unity/ExportSyntyWalk.cs');
const ALIGN4 = (value) => (value + 3) & ~3;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function options(argv) {
  const result = {
    bake: null,
    packageRoot: null,
    unity: process.env.UNITY_EDITOR || DEFAULT_UNITY,
    verifyOnly: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--verify-only') {
      result.verifyOnly = true;
      continue;
    }
    const value = argv[++index];
    if (!value) throw new Error(`${key} needs a value.`);
    if (key === '--bake') result.bake = resolve(value);
    else if (key === '--package') result.packageRoot = resolve(value);
    else if (key === '--unity') result.unity = resolve(value);
    else throw new Error(`Unknown option: ${key}`);
  }
  return result;
}

function matIdentity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function matMultiply(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let inner = 0; inner < 4; inner++) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function matInverse(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => matrix[column * 4 + row]),
    ...Array.from({ length: 4 }, (_, column) => row === column ? 1 : 0),
  ]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error('Cannot invert singular matrix.');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map((value) => value / divisor);
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - factor * rows[column][index]);
    }
  }
  return Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
}

function quaternionMatrix([x, y, z, w]) {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

function trsMatrix(translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1]) {
  const matrix = quaternionMatrix(rotation);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) matrix[column * 4 + row] *= scale[column];
  }
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];
  return matrix;
}

function determinant3(matrix) {
  const a = matrix[0], b = matrix[4], c = matrix[8];
  const d = matrix[1], e = matrix[5], f = matrix[9];
  const g = matrix[2], h = matrix[6], i = matrix[10];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function quaternionFromMatrix(matrix) {
  const m00 = matrix[0], m01 = matrix[4], m02 = matrix[8];
  const m10 = matrix[1], m11 = matrix[5], m12 = matrix[9];
  const m20 = matrix[2], m21 = matrix[6], m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

function decompose(matrix) {
  const translation = [matrix[12], matrix[13], matrix[14]];
  const scale = [
    Math.hypot(matrix[0], matrix[1], matrix[2]),
    Math.hypot(matrix[4], matrix[5], matrix[6]),
    Math.hypot(matrix[8], matrix[9], matrix[10]),
  ];
  if (determinant3(matrix) < 0) scale[0] *= -1;
  const normalized = matrix.slice();
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) normalized[column * 4 + row] /= scale[column] || 1;
  }
  return { translation, rotation: quaternionFromMatrix(normalized), scale };
}

const BASIS = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function unityPoseMatrix(pose) {
  const position = pose.position;
  const rotation = pose.rotation;
  const unity = trsMatrix(
    [position.x, position.y, position.z],
    [rotation.x, rotation.y, rotation.z, rotation.w],
  );
  return matMultiply(matMultiply(BASIS, unity), BASIS);
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) {
    throw new Error('Expected a glTF 2.0 GLB.');
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB JSON chunk is missing.');
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  if (buffer.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error('GLB BIN chunk is missing.');
  const binary = buffer.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  return { json, binary };
}

function packGlb(json, binary) {
  let jsonBuffer = Buffer.from(JSON.stringify(json));
  if (jsonBuffer.length % 4) {
    jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(4 - jsonBuffer.length % 4, 0x20)]);
  }
  const paddedBinary = binary.length % 4
    ? Buffer.concat([binary, Buffer.alloc(4 - binary.length % 4)])
    : binary;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuffer.length + 8 + paddedBinary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(paddedBinary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuffer, binaryHeader, paddedBinary]);
}

function nodeParents(json) {
  const parents = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((node, parent) => {
    for (const child of node.children || []) parents[child] = parent;
  });
  return parents;
}

function restWorldMatrices(json, parents) {
  const result = new Array(json.nodes.length);
  const visit = (index) => {
    if (result[index]) return result[index];
    const node = json.nodes[index];
    const local = node.matrix || trsMatrix(node.translation, node.rotation, node.scale);
    result[index] = parents[index] < 0 ? local : matMultiply(visit(parents[index]), local);
    return result[index];
  };
  json.nodes.forEach((_, index) => visit(index));
  return result;
}

function gltfBoneName(unityName, known) {
  if (known.has(unityName)) return unityName;
  const match = unityName.match(/^(.*) (\d+)$/);
  if (match) {
    const candidate = `${match[1]}.${Number(match[2]).toString().padStart(3, '0')}`;
    if (known.has(candidate)) return candidate;
  }
  throw new Error(`Unity bone ${unityName} is absent from the GLB.`);
}

function uniqueFrames(bake) {
  const frames = new Map();
  for (const frame of bake.frames) {
    const frameNumber = Math.round(Number(frame.time) * bake.sampleRate);
    frames.set(frameNumber, frame);
  }
  return [...frames.entries()].sort((left, right) => left[0] - right[0])
    .map(([frameNumber, frame]) => ({ frameNumber, frame }));
}

function animationSamples(json, bake) {
  if (!bake.success) throw new Error(`${bake.id} walk bake failed: ${bake.error}`);
  const parents = nodeParents(json);
  const restWorld = restWorldMatrices(json, parents);
  const namedNodes = new Map();
  json.nodes.forEach((node, index) => {
    if (node.name) namedNodes.set(node.name, index);
  });
  const known = new Set(namedNodes.keys());
  const restByName = new Map(bake.restPose.map((bone) => [bone.bone, bone]));
  const mappings = bake.restPose.map((bone) => {
    const gltfName = gltfBoneName(bone.bone, known);
    return { bone, gltfName, node: namedNodes.get(gltfName) };
  });
  const offsets = new Map(mappings.map(({ bone, node }) => [
    bone.bone,
    matMultiply(matInverse(unityPoseMatrix(bone)), restWorld[node]),
  ]));
  const frames = uniqueFrames(bake);
  const times = frames.map(({ frameNumber }) => frameNumber / bake.sampleRate);
  const samples = new Map(mappings.map(({ node }) => [node, {
    translation: [],
    rotation: [],
    scale: [],
  }]));
  const previousRotations = new Map();

  for (const { frame } of frames) {
    const poses = new Map(frame.bones.map((pose) => [pose.bone, pose]));
    const desired = new Map(mappings.map(({ bone }) => {
      const pose = poses.get(bone.bone);
      if (!pose) throw new Error(`${bake.id} frame is missing ${bone.bone}.`);
      return [bone.bone, matMultiply(unityPoseMatrix(pose), offsets.get(bone.bone))];
    }));
    for (const { bone, node } of mappings) {
      const parentBone = restByName.get(bone.bone).parent;
      const parentWorld = parentBone
        ? desired.get(parentBone)
        : (parents[node] < 0 ? matIdentity() : restWorld[parents[node]]);
      const local = matMultiply(matInverse(parentWorld), desired.get(bone.bone));
      const value = decompose(local);
      const previous = previousRotations.get(node);
      if (previous && value.rotation.reduce((sum, item, index) => sum + item * previous[index], 0) < 0) {
        value.rotation = value.rotation.map((item) => -item);
      }
      previousRotations.set(node, value.rotation);
      const nodeSamples = samples.get(node);
      nodeSamples.translation.push(value.translation);
      nodeSamples.rotation.push(value.rotation);
      nodeSamples.scale.push(value.scale);
    }
  }
  return { mappings, samples, times };
}

function readAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126 || accessor.sparse) {
    throw new Error('Walk validation expects dense float accessors.');
  }
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const width = widths[accessor.type];
  const stride = view.byteStride || width * 4;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return Array.from({ length: accessor.count }, (_, row) => Array.from(
    { length: width },
    (_, column) => binary.readFloatLE(start + row * stride + column * 4),
  ));
}

function verifyReference(glb, bake, label) {
  const generated = animationSamples(glb.json, bake);
  const animation = glb.json.animations.find((item) => item.name === 'walk');
  if (!animation) throw new Error(`${label} has no walk animation.`);
  let maxTranslation = 0;
  let maxRotation = 0;
  let maxScale = 0;
  const generatedByNode = generated.samples;
  for (const channel of animation.channels) {
    const path = channel.target.path;
    const expected = generatedByNode.get(channel.target.node)?.[path];
    if (!expected) continue;
    const sampler = animation.samplers[channel.sampler];
    let actual = readAccessor(glb.json, glb.binary, sampler.output);
    if (actual.length !== expected.length) {
      const constant = actual.every((row) => row.every(
        (value, index) => Math.abs(value - actual[0][index]) < 1e-5,
      ));
      if (!constant) {
        throw new Error(`${label} ${path} frame count differs (${actual.length} vs ${expected.length}).`);
      }
      actual = expected.map(() => actual[0]);
    }
    for (let frame = 0; frame < actual.length; frame++) {
      let difference;
      if (path === 'rotation') {
        const direct = Math.max(...actual[frame].map((value, index) => Math.abs(value - expected[frame][index])));
        const flipped = Math.max(...actual[frame].map((value, index) => Math.abs(value + expected[frame][index])));
        difference = Math.min(direct, flipped);
        maxRotation = Math.max(maxRotation, difference);
      } else {
        difference = Math.max(...actual[frame].map((value, index) => Math.abs(value - expected[frame][index])));
        if (path === 'translation') maxTranslation = Math.max(maxTranslation, difference);
        else maxScale = Math.max(maxScale, difference);
      }
    }
  }
  console.log(`${label}: legacy reconstruction max delta T=${maxTranslation.toExponential(2)} R=${maxRotation.toExponential(2)} S=${maxScale.toExponential(2)}`);
  if (maxTranslation > 0.02 || maxRotation > 0.002 || maxScale > 0.002) {
    throw new Error(`${label} rest-pose conversion did not reproduce the existing walk.`);
  }
}

function floatBuffer(rows) {
  const width = Array.isArray(rows[0]) ? rows[0].length : 1;
  const buffer = Buffer.alloc(rows.length * width * 4);
  let offset = 0;
  for (const row of rows) {
    for (const value of (Array.isArray(row) ? row : [row])) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
  }
  return buffer;
}

function replaceWalk(source, bake) {
  const glb = parseGlb(source);
  const generated = animationSamples(glb.json, bake);
  const json = glb.json;
  const baseLength = json.buffers[0].byteLength;
  const chunks = [Buffer.from(glb.binary.subarray(0, baseLength))];
  let byteLength = baseLength;
  const appendAccessor = (rows, type, bounds = false) => {
    const aligned = ALIGN4(byteLength);
    if (aligned > byteLength) chunks.push(Buffer.alloc(aligned - byteLength));
    const data = floatBuffer(rows);
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: data.length });
    const accessor = { bufferView: viewIndex, componentType: 5126, count: rows.length, type };
    if (bounds) {
      accessor.min = [Math.min(...rows)];
      accessor.max = [Math.max(...rows)];
    }
    const accessorIndex = json.accessors.length;
    json.accessors.push(accessor);
    chunks.push(data);
    byteLength = aligned + data.length;
    return accessorIndex;
  };
  const input = appendAccessor(generated.times, 'SCALAR', true);
  const animation = {
    name: 'walk',
    extras: { source: bake.sourceClip || 'HumanM@Walk01_Forward', retargeter: 'Unity Humanoid' },
    channels: [],
    samplers: [],
  };
  for (const { node } of generated.mappings) {
    const nodeSamples = generated.samples.get(node);
    for (const [path, type] of [['translation', 'VEC3'], ['rotation', 'VEC4'], ['scale', 'VEC3']]) {
      const output = appendAccessor(nodeSamples[path], type);
      const sampler = animation.samplers.length;
      animation.samplers.push({ input, output, interpolation: 'LINEAR' });
      animation.channels.push({ sampler, target: { node, path } });
    }
  }
  const walkIndex = json.animations.findIndex((item) => item.name === 'walk');
  if (walkIndex < 0) throw new Error('Character GLB has no walk animation to replace.');
  json.animations[walkIndex] = animation;
  const binary = Buffer.concat(chunks);
  json.buffers[0].byteLength = binary.length;
  return packGlb(json, binary);
}

function copyUnityAsset(source, destination) {
  if (!existsSync(source)) throw new Error(`Licensed source is missing: ${source}`);
  if (!existsSync(`${source}.meta`)) throw new Error(`Unity metadata is missing: ${source}.meta`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  copyFileSync(`${source}.meta`, `${destination}.meta`);
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

function updateReferenceBake(path, rig) {
  if (!existsSync(path)) return;
  const reference = JSON.parse(readFileSync(path, 'utf8'));
  const walk = reference.clips?.find((clip) => clip.id === 'walk');
  if (!walk) return;
  walk.sourceClip = rig.sourceClip;
  walk.duration = rig.duration;
  walk.sampleRate = rig.sampleRate;
  walk.frames = rig.frames;
  writeFileSync(path, `${JSON.stringify(reference, null, 2)}\n`);
}

function applyReport(report, manifest, packageRoot) {
  const rigs = new Map(report.rigs.map((rig) => [rig.id, rig]));
  const pending = [];
  for (const target of manifest.targets) {
    const rig = rigs.get(target.id);
    if (!rig?.success) throw new Error(`${target.id} walk bake failed: ${rig?.error || 'no report'}`);
    for (const model of target.models) {
      const path = resolve(packageRoot, model);
      pending.push({ path, model, data: replaceWalk(readFileSync(path), rig) });
    }
  }
  for (const output of pending) {
    writeFileSync(output.path, output.data);
    console.log(`${output.model}: ${output.data.length} bytes, ${report.rigs[0].sourceClip} (${report.rigs[0].duration.toFixed(3)}s)`);
  }
  for (const target of manifest.targets) {
    updateReferenceBake(resolve(ROOT, target.referenceBake), rigs.get(target.id));
  }
  refreshPackageManifest(packageRoot);
  console.log(`Synty walk package refreshed -> ${packageRoot}`);
}

const config = options(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const packageRoot = config.packageRoot || resolve(ROOT, manifest.privatePackage);
if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
  throw new Error(`Private Synty package is missing: ${packageRoot}`);
}

for (const target of manifest.targets) {
  const modelPath = resolve(packageRoot, target.models[0]);
  const referencePath = resolve(ROOT, target.referenceBake);
  if (!existsSync(referencePath)) throw new Error(`Reference bake is missing: ${referencePath}`);
  verifyReference(
    parseGlb(readFileSync(modelPath)),
    { ...JSON.parse(readFileSync(referencePath, 'utf8')).clips.find((clip) => clip.id === 'walk'),
      id: target.id,
      success: true,
      restPose: JSON.parse(readFileSync(referencePath, 'utf8')).restPose,
      sampleRate: JSON.parse(readFileSync(referencePath, 'utf8')).sampleRate,
    },
    target.models[0],
  );
}
if (config.verifyOnly) process.exit(0);
if (config.bake) {
  applyReport(JSON.parse(readFileSync(config.bake, 'utf8')), manifest, packageRoot);
  process.exit(0);
}
if (!existsSync(config.unity)) throw new Error(`Unity editor not found: ${config.unity}`);

const temporary = mkdtempSync(join(tmpdir(), 'escape-work-synty-walk-'));
try {
  for (const directory of ['Assets/Editor', 'Assets/Source', 'Packages', 'ProjectSettings']) {
    mkdirSync(resolve(temporary, directory), { recursive: true });
  }
  copyFileSync(EDITOR_SCRIPT, resolve(temporary, 'Assets/Editor/ExportSyntyWalk.cs'));
  writeFileSync(resolve(temporary, 'Packages/manifest.json'), '{"dependencies":{}}\n');
  writeFileSync(resolve(temporary, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.4.10f1\n');
  copyUnityAsset(resolve(ROOT, manifest.animation), resolve(temporary, 'Assets/Source/Walk.fbx'));
  copyUnityAsset(resolve(ROOT, manifest.sourceAvatar), resolve(temporary, 'Assets/Source/Avatar.fbx'));
  manifest.targets.forEach((target, index) => {
    const filename = index === 0 ? 'SyntyShops.fbx' : 'SyntyGeneric.fbx';
    copyUnityAsset(resolve(ROOT, target.source), resolve(temporary, 'Assets/Source', filename));
  });
  const dumpPath = resolve(temporary, 'synty-walk.json');
  const logPath = resolve(temporary, 'unity.log');
  const args = [
    '-batchmode', '-nographics', '-quit',
    '-projectPath', temporary,
    '-executeMethod', 'EscapeWork.ExportSyntyWalk.Run',
    '-logFile', logPath,
  ];
  const environment = {
    ...process.env,
    ESCAPE_WORK_WALK_DUMP: dumpPath,
    ESCAPE_WORK_WALK_CLIP: manifest.clipName,
    ESCAPE_WORK_WALK_RATE: String(manifest.sampleRate),
  };
  // A brand-new Unity project may complete its first script compilation and
  // honor `-quit` before invoking the requested editor method. If that happens,
  // the second launch uses the compiled assembly and performs the bake.
  for (let attempt = 1; attempt <= 2 && !existsSync(dumpPath); attempt++) {
    const result = spawnSync(config.unity, args, {
      encoding: 'utf8',
      env: environment,
      timeout: 15 * 60 * 1000,
    });
    if (result.status !== 0) {
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-12000) : '';
      throw new Error(log || result.stderr || result.error?.message || 'Unity walk bake failed.');
    }
  }
  if (!existsSync(dumpPath)) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-12000) : '';
    throw new Error(`Unity did not produce a walk bake after two launches.\n${log}`);
  }
  const report = JSON.parse(readFileSync(dumpPath, 'utf8'));
  applyReport(report, manifest, packageRoot);
} finally {
  const expected = resolve(tmpdir());
  if (!temporary.startsWith(`${expected}${sep}`)) throw new Error(`Refusing to remove unexpected path: ${temporary}`);
  rmSync(temporary, { recursive: true, force: true });
}
