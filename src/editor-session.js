// Undo/redo and draft persistence for one editor document.
//
// The host supplies document snapshots and rendering-aware restore. This
// module owns the mutable stacks, gesture checkpoint, dirty flag and debounce
// timer, keeping persistence policy independent of the editor's DOM and scene.
export function createEditorSession({
  snapshot,
  restore,
  serialize,
  onDirty = () => {},
  notify = () => {},
  storage = globalThis.localStorage,
  draftKey = 'escape-work.editor.draft',
  draftDelay = 700,
  historyCap = 60,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  let history = [];
  let future = [];
  let pendingStroke = null;
  let dirty = false;
  let draftTimer = null;

  const scheduleDraft = () => {
    cancel(draftTimer);
    draftTimer = schedule(() => {
      draftTimer = null;
      try { storage?.setItem(draftKey, serialize()); } catch { /* unavailable or full */ }
    }, draftDelay);
  };

  function markDirty({ save = true } = {}) {
    dirty = true;
    onDirty();
    if (save) scheduleDraft();
  }

  function markClean({ clearDraft = false } = {}) {
    dirty = false;
    cancel(draftTimer);
    draftTimer = null;
    if (clearDraft) {
      try { storage?.removeItem(draftKey); } catch { /* unavailable */ }
    }
  }

  function clearDraft() {
    cancel(draftTimer);
    draftTimer = null;
    try { storage?.removeItem(draftKey); } catch { /* unavailable */ }
  }

  function readDraft() {
    try {
      const raw = storage?.getItem(draftKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function resetHistory() {
    history = [];
    future = [];
    pendingStroke = null;
  }

  function beginStroke() {
    pendingStroke = snapshot();
  }

  function pushHistory() {
    history.push(pendingStroke || snapshot());
    pendingStroke = null;
    if (history.length > historyCap) history.shift();
    future = [];
    markDirty();
  }

  function commitStroke() {
    if (pendingStroke) pushHistory();
    else markDirty();
  }

  function undo() {
    if (!history.length) { notify('Nothing to undo.'); return false; }
    future.push(snapshot());
    restore(history.pop());
    markDirty();
    notify(`Undo. (${history.length} step${history.length === 1 ? '' : 's'} left)`);
    return true;
  }

  function redo() {
    if (!future.length) { notify('Nothing to redo.'); return false; }
    history.push(snapshot());
    restore(future.pop());
    markDirty();
    notify('Redo.');
    return true;
  }

  return {
    get dirty() { return dirty; },
    get historyLength() { return history.length; },
    get futureLength() { return future.length; },
    markDirty,
    markClean,
    clearDraft,
    readDraft,
    resetHistory,
    beginStroke,
    pushHistory,
    commitStroke,
    undo,
    redo,
  };
}
