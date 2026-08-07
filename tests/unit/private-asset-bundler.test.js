import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleAssets } from '../../tools/bundle-private-assets.mjs';

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

function zipEntryNames(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, 'ZIP end-of-central-directory exists');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central directory entry exists');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names.sort();
}

test('private asset bundler creates deterministic volumes below the exclusive ceiling', () => {
  const root = mkdtempSync(join(tmpdir(), 'escape-work-private-assets-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'characters'), { recursive: true });
    mkdirSync(join(source, 'office'), { recursive: true });
    const inputs = {
      'README.md': Buffer.from('Private runtime assets.\n'.repeat(20)),
      'characters/one.glb': randomBytes(1100),
      'characters/two.glb': randomBytes(1100),
      'office/chair.glb': randomBytes(1100),
      'office/desk.glb': randomBytes(1100),
      'office/plant.glb': randomBytes(1100),
    };
    for (const [path, data] of Object.entries(inputs)) writeFileSync(join(source, path), data);

    const first = bundleAssets({
      source,
      output: join(root, 'first'),
      name: 'test-assets',
      maxArchiveBytes: 2900,
    });
    const second = bundleAssets({
      source,
      output: join(root, 'second'),
      name: 'test-assets',
      maxArchiveBytes: 2900,
    });

    assert.ok(first.volumes.length > 1, 'the fixture is split across volumes');
    assert.ok(first.volumes.every((volume) => volume.bytes < 2900));
    assert.deepEqual(first.volumes, second.volumes, 'same input creates byte-identical volume metadata');
    assert.deepEqual(first.files, second.files, 'same input creates a stable file assignment');
    assert.deepEqual(first.files.map((file) => file.path), Object.keys(inputs).sort());

    for (const volume of first.volumes) {
      const archive = readFileSync(join(first.output, volume.file));
      assert.equal(archive.length, volume.bytes);
      assert.equal(hash(archive), volume.sha256);
      assert.deepEqual(zipEntryNames(archive), [...volume.files].sort());
    }
    for (const file of first.files) {
      assert.equal(file.bytes, inputs[file.path].length);
      assert.equal(file.sha256, hash(inputs[file.path]));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private asset bundler rejects a file that cannot fit in one volume', () => {
  const root = mkdtempSync(join(tmpdir(), 'escape-work-private-assets-'));
  try {
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'oversized.glb'), randomBytes(2000));
    assert.throws(
      () => bundleAssets({ source, output: join(root, 'out'), maxArchiveBytes: 1000 }),
      /cannot fit below 1000 bytes by itself/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
