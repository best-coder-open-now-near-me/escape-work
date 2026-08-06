import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSession } from '../../src/editor-session.js';

function fixture() {
  let value = 1;
  const notices = [];
  const writes = new Map();
  const jobs = [];
  const storage = {
    getItem: (key) => writes.get(key) ?? null,
    setItem: (key, next) => writes.set(key, next),
    removeItem: (key) => writes.delete(key),
  };
  const session = createEditorSession({
    snapshot: () => value,
    restore: (next) => { value = next; },
    serialize: () => JSON.stringify({ value }),
    notify: (line) => notices.push(line),
    storage,
    schedule: (fn) => { jobs.push(fn); return fn; },
    cancel: (fn) => { const i = jobs.indexOf(fn); if (i >= 0) jobs.splice(i, 1); },
  });
  return {
    session, notices, writes, jobs,
    get value() { return value; },
    set value(next) { value = next; },
  };
}

test('a stroke records its pre-edit snapshot once and supports redo', () => {
  const f = fixture();
  f.session.beginStroke();
  f.value = 2;
  f.session.commitStroke();

  assert.equal(f.session.historyLength, 1);
  assert.equal(f.session.undo(), true);
  assert.equal(f.value, 1);
  assert.equal(f.session.redo(), true);
  assert.equal(f.value, 2);
  assert.equal(f.session.dirty, true);
});

test('a no-op undo is reported without changing the document', () => {
  const f = fixture();

  assert.equal(f.session.undo(), false);
  assert.equal(f.value, 1);
  assert.deepEqual(f.notices, ['Nothing to undo.']);
});

test('draft writes are debounced and clean state cancels the pending write', () => {
  const f = fixture();
  f.session.markDirty();
  f.session.markDirty();
  assert.equal(f.jobs.length, 1);

  const writeDraft = f.jobs.shift();
  writeDraft();
  assert.deepEqual(f.session.readDraft(), { value: 1 });

  f.session.markDirty();
  f.session.markClean({ clearDraft: true });
  assert.equal(f.jobs.length, 0);
  assert.equal(f.session.dirty, false);
  assert.equal(f.writes.size, 0);
});

test('unavailable and corrupt draft storage are harmless', () => {
  const unavailable = createEditorSession({
    snapshot: () => null,
    restore: () => {},
    serialize: () => '{}',
    storage: {
      getItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    },
  });
  assert.equal(unavailable.readDraft(), null);
  unavailable.clearDraft();

  const corrupt = createEditorSession({
    snapshot: () => null,
    restore: () => {},
    serialize: () => '{}',
    storage: { getItem: () => '{nope' },
  });
  assert.equal(corrupt.readDraft(), null);
});
