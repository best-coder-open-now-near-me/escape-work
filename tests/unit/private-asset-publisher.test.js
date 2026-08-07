import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PUBLISH_INDEX,
  applyAssetPlan,
  planAssetPublish,
} from '../../tools/publish-private-assets.mjs';

test('private asset publishing changes only managed files and settles to a no-op', () => {
  const root = mkdtempSync(join(tmpdir(), 'escape-work-private-publish-'));
  try {
    const source = join(root, 'source');
    const repo = join(root, 'repo');
    mkdirSync(join(source, 'characters'), { recursive: true });
    mkdirSync(join(repo, 'office'), { recursive: true });
    writeFileSync(join(source, 'README.md'), 'new readme\n');
    writeFileSync(join(source, 'characters', 'worker.glb'), Buffer.from([1, 2, 3]));
    writeFileSync(join(repo, 'README.md'), 'old readme\n');
    writeFileSync(join(repo, 'office', 'stale.glb'), Buffer.from([9]));
    writeFileSync(join(repo, 'UNMANAGED.md'), 'keep me\n');
    writeFileSync(join(repo, PUBLISH_INDEX), `${JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: 'README.md', bytes: 11, sha256: 'old' },
        { path: 'office/stale.glb', bytes: 1, sha256: 'old' },
      ],
    })}\n`);

    const plan = planAssetPublish({ source, repo });
    assert.deepEqual(plan.added, ['characters/worker.glb']);
    assert.deepEqual(plan.updated, ['README.md']);
    assert.deepEqual(plan.removed, ['office/stale.glb']);
    assert.equal(plan.changed, true);

    applyAssetPlan(plan);
    assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), 'new readme\n');
    assert.deepEqual(readFileSync(join(repo, 'characters', 'worker.glb')), Buffer.from([1, 2, 3]));
    assert.equal(readFileSync(join(repo, 'UNMANAGED.md'), 'utf8'), 'keep me\n');
    assert.equal(existsSync(join(repo, 'office', 'stale.glb')), false);

    const settled = planAssetPublish({ source, repo });
    assert.equal(settled.changed, false);
    assert.deepEqual(settled.added, []);
    assert.deepEqual(settled.updated, []);
    assert.deepEqual(settled.removed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private asset publishing rejects a source-owned publish index', () => {
  const root = mkdtempSync(join(tmpdir(), 'escape-work-private-publish-'));
  try {
    const source = join(root, 'source');
    const repo = join(root, 'repo');
    mkdirSync(source);
    mkdirSync(repo);
    writeFileSync(join(source, PUBLISH_INDEX), '{}');
    assert.throws(() => planAssetPublish({ source, repo }), /is not safe to publish/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
