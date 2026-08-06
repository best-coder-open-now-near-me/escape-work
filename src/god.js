// God mode: a runtime tweak panel for human testing. Toggle with backquote (`)
// or F8. It reflects over the game's LIVE state objects - the character sheet,
// every enemy, the active combat controller, the world - and lets you edit
// their values in place while the game runs. Nothing in here is game logic: it
// reads and writes the same objects main.js / combat.js already own, surfaced
// through the window.__god handle those modules build (see main.js).
//
// The reflection is generic on purpose. Each target object's number / boolean
// / string properties become a widget inferred from the value's TYPE (number ->
// number field, bool -> checkbox, string -> text), so a new field on the sheet
// or an actor shows up with zero panel changes. This edits the leftover RUNTIME
// state - the current hp, the AP left this turn, an enemy's wander timer - not
// the design-time constants: registries (enemy types, items) are read-only
// catalogue here, used only to spawn and give. The edit target is always a live
// instance.
import { PANEL_CHROME, BUTTON_CHROME } from './ui.js';
import { ITEMS } from './data/items.js';
import { createGodTargets } from './god-targets.js';
import { createGodTabs } from './god-tabs.js';
import { createGodPanelState } from './god-panel-state.js';

const PRIM = new Set(['number', 'boolean', 'string']);
// Animation / rig bookkeeping on an actor - real properties, but noise for a
// gameplay tweak panel. Hidden unless "internals" is toggled on.
const RIG_INTERNALS = new Set([
  'yaw', 'targetYaw', 'pathIndex', 'flashT', 'visualLift', 'clip', 'spawnX', 'spawnZ',
]);

// --- tiny DOM helpers --------------------------------------------------------
function el(tag, style, props) {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (props) Object.assign(n, props);
  return n;
}
function button(label, onclick, extra) {
  const b = el('button', Object.assign({
    padding: '4px 9px', borderRadius: '6px', font: '11px system-ui, sans-serif',
  }, BUTTON_CHROME, extra), { textContent: label });
  b.onclick = onclick;
  return b;
}

// Own number/boolean/string keys of an object, minus a hide set. `showInternals`
// re-includes the hidden ones (still typed, still editable) instead of dropping
// them, so half-interesting state can be dug out without a code change.
function primitiveFields(obj, { hide, readOnly, showInternals }) {
  const out = [];
  for (const key of Object.keys(obj)) {
    if (!PRIM.has(typeof obj[key])) continue; // objects, arrays, functions: skip
    if (hide && hide.has(key) && !showInternals) continue;
    out.push({ key, type: typeof obj[key], readOnly: !!(readOnly && readOnly.has(key)) });
  }
  return out;
}

export function installGodMode(api) {
  let panel = null; // built lazily on first open
  const KEY = 'escape-work.god';

  function toggle(force) {
    if (!panel) panel = buildPanel(api, toggle);
    const open = force !== undefined ? force : !panel.open;
    panel.setOpen(open);
    try { open ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* private mode */ }
  }

  // Toggle key: backquote (US ANSI), IntlBackslash (that physical key on some
  // ISO layouts) or F8 as a universal fallback. A keydown that bubbled out of
  // the panel's own inputs never reaches here - the panel stops those - so this
  // only fires from the game / body.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' || e.code === 'IntlBackslash' || e.key === 'F8') {
      e.preventDefault();
      toggle();
    }
  });

  // Stay open across reloads if a tester left it open (or arrived via #god).
  try {
    if (localStorage.getItem(KEY) === '1' || location.hash.includes('god')) {
      setTimeout(() => toggle(true), 0); // let the game finish booting first
    }
  } catch { /* private mode */ }

  // Pin / hold: re-assert every pinned value each frame so the game can't tick
  // it back - hp held at max is invulnerability, AP held at max is infinite
  // actions. Registered after the game's own update handler, so these writes
  // win the frame; still fires at timeScale 0 (update runs with dt 0).
  // Closing the panel stops the holds. They used to keep enforcing with the
  // panel shut, and because a combat-scope pin resolves its target live, a pin
  // made in one fight silently re-attached to the NEXT one - a tester who
  // pinned AP and closed the panel ran every later fight of that session on
  // infinite actions with nothing on screen saying so.
  api.app.on('update', () => {
    if (!panel || !panel.open || panel.pins.size === 0) return;
    for (const pin of panel.pins.values()) {
      const o = pin.getObj();
      if (!o) continue;
      // Only re-write when the game has drifted the value off its pin - this
      // keeps a pinned setter (e.g. combat AP, which refreshes on write) from
      // firing every single frame.
      // Through the SETTER when the field has one, exactly as the edit box
      // does. The hold used to write raw, so a field whose setter enforces an
      // invariant - the purse is clamped to a whole number at or above zero -
      // had that invariant honoured when you typed the value and bypassed sixty
      // times a second afterwards. Pinning was the one way to keep a value the
      // setter exists to refuse.
      try {
        if (o[pin.key] === pin.value) continue;
        if (pin.set) pin.set(pin.value); else o[pin.key] = pin.value;
      } catch { /* stale target */ }
    }
  });
}

function buildPanel(api, requestToggle) {
  // --- shell ----------------------------------------------------------------
  const root = el('div', Object.assign({
    position: 'fixed', top: '12px', right: '12px', zIndex: '45',
    width: '320px', maxHeight: 'calc(100vh - 24px)', borderRadius: '10px',
    padding: '0', display: 'none', flexDirection: 'column', userSelect: 'none',
    overflow: 'hidden',
  }, PANEL_CHROME), { id: 'god-panel' });

  // Keep the panel's own keystrokes and wheel out of the game (PlayCanvas
  // listens on window). keyup is deliberately let through, so a key pressed
  // in-game and released over the panel never stays stuck down in the engine.
  root.addEventListener('keydown', (e) => e.stopPropagation());
  root.addEventListener('keypress', (e) => e.stopPropagation());
  root.addEventListener('wheel', (e) => e.stopPropagation());

  const header = el('div', {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '9px 12px', borderBottom: '1px solid #3a3a52', fontWeight: '700',
  });
  header.append(el('div', { flex: '1', letterSpacing: '1px' }, { textContent: 'GOD MODE' }));
  const internalsBox = el('input', { cursor: 'pointer' }, { type: 'checkbox', id: 'god-internals', title: 'Show internal / rig fields' });
  const internalsLbl = el('label', { font: '10px system-ui', opacity: '.7', cursor: 'pointer', display: 'flex', gap: '3px', alignItems: 'center' });
  internalsLbl.append(internalsBox, document.createTextNode('internals'));
  header.append(internalsLbl, button('✕', () => requestToggle(false), { padding: '2px 7px' }));
  root.append(header);

  const tabbar = el('div', { display: 'flex', gap: '4px', padding: '8px 10px 0' });
  root.append(tabbar);

  const search = el('input', {
    margin: '8px 10px', padding: '5px 8px', borderRadius: '6px',
    border: '1px solid #3a3a52', background: '#1b1b2a', color: '#f0f0f5',
    font: '12px system-ui', width: 'calc(100% - 20px)', boxSizing: 'border-box',
  }, { id: 'god-search', type: 'search', placeholder: 'search names or parameters…' });
  root.append(search);

  const hint = el('div', {
    display: 'none', margin: '0 10px 6px', padding: '5px 8px', borderRadius: '6px',
    background: '#3a2e46', color: '#e8d8f5', font: '11px system-ui', cursor: 'pointer',
  });
  root.append(hint);

  const body = el('div', { flex: '1', overflowY: 'auto', padding: '2px 10px 10px' }, { id: 'god-body' });
  root.append(body);

  const watch = el('div', {
    borderTop: '1px solid #3a3a52', padding: '7px 12px', font: '11px system-ui',
    display: 'none', flexDirection: 'column', gap: '3px', maxHeight: '30vh', overflowY: 'auto',
  }, { id: 'god-watch' });
  root.append(watch);

  document.body.appendChild(root);

  // --- state ----------------------------------------------------------------
  const state = createGodPanelState();
  const panel = {
    root,
    get open() { return state.open; },
    pins: state.pins,
    setOpen,
  };
  const { playerTargets, enemyTargets, combatTargets } = createGodTargets(api, {
    render: (...args) => render(...args),
    armPlace: (...args) => armPlace(...args),
    rigInternals: RIG_INTERNALS,
  });
  const { renderWorld, renderSpawn } = createGodTabs({
    api,
    body,
    el,
    button,
    selectStyle,
    itemSelect,
    sectionTitle,
    readout,
    afterEdit,
    render,
    armPlace,
  });

  internalsBox.onchange = () => { state.setShowInternals(internalsBox.checked); render(); };
  search.oninput = () => render();

  const TABS = ['player', 'enemies', 'combat', 'world', 'spawn'];
  const tabBtns = {};
  for (const t of TABS) {
    const b = button(t[0].toUpperCase() + t.slice(1), () => { state.selectTab(t); search.value && (search.value = ''); render(); },
      { flex: '1', padding: '5px 0', borderRadius: '6px 6px 0 0' });
    b.id = `god-tab-${t}`;
    tabBtns[t] = b;
    tabbar.append(b);
  }

  function setOpen(v) {
    state.setOpen(v);
    root.style.display = v ? 'flex' : 'none';
    if (v) render();
  }

  // --- generic reflection card ---------------------------------------------
  // Renders one target object's editable fields. `filter` (search) keeps only
  // matching keys; a title match keeps them all.
  function reflectCard(target, filter) {
    const card = el('div', {
      margin: '8px 0', border: '1px solid #2c2c42', borderRadius: '8px', overflow: 'hidden',
    });
    const titleMatch = filter && target.title.toLowerCase().includes(filter);
    card.append(el('div', {
      padding: '6px 9px', background: '#1f1f30', fontWeight: '700', font: '12px system-ui',
      display: 'flex', alignItems: 'center', gap: '6px',
    }, { textContent: target.title }));

    if (target.note) {
      card.append(el('div', { padding: '8px 9px', opacity: '.6', font: '11px system-ui' }, { textContent: target.note }));
      return card;
    }

    const fields = primitiveFields(target.obj, {
      hide: target.hide, readOnly: target.readOnly, showInternals: state.showInternals,
    }).filter((f) => !filter || titleMatch || f.key.toLowerCase().includes(filter));

    for (const f of fields) card.append(reflectRow(target, f));

    if (target.special === 'inventory' && (!filter || titleMatch || 'inventory'.includes(filter))) {
      card.append(inventorySection(target.obj));
    }
    if (target.actions && !filter) {
      const bar = el('div', { display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '6px 9px' });
      for (const a of target.actions) bar.append(button(a.label, a.run));
      card.append(bar);
    }
    return card;
  }

  function reflectRow(target, f) {
    const { obj } = target;
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 9px',
      borderTop: '1px solid #24243a',
    });
    row.append(el('div', { flex: '1', font: '11px system-ui', opacity: f.readOnly ? '.55' : '.9' }, { textContent: f.key }));

    const commit = (val) => {
      // A field with a real SETTER goes through it rather than around it. The
      // panel edits live state in place by design, but "in place" must not mean
      // "past the invariant": the purse is clamped to a whole number at or
      // above zero, and a raw write of -5 (or 2.5) put the party in a hole
      // buying refused its way out of.
      const set = target.setters?.[f.key];
      if (set) set(val); else obj[f.key] = val;
      afterEdit(target);
      // A pinned field follows the value that actually LANDED, which a setter
      // may have clamped.
      const id = pinId(target, f.key);
      if (panel.pins.has(id)) panel.pins.get(id).value = obj[f.key];
    };

    let input;
    if (f.type === 'boolean') {
      input = el('input', { cursor: f.readOnly ? 'default' : 'pointer' }, { type: 'checkbox', checked: obj[f.key], disabled: f.readOnly });
      input.onchange = () => commit(input.checked);
      input.__read = () => { input.checked = obj[f.key]; };
    } else if (f.type === 'number') {
      input = el('input', numStyle(f.readOnly), { type: 'number', step: 'any', value: fmt(obj[f.key]), disabled: f.readOnly });
      input.onchange = () => { const n = parseFloat(input.value); if (!Number.isNaN(n)) commit(n); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      input.__read = () => { input.value = fmt(obj[f.key]); };
    } else { // string
      input = el('input', textStyle(f.readOnly), { type: 'text', value: obj[f.key], disabled: f.readOnly });
      input.onchange = () => commit(input.value);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      input.__read = () => { input.value = obj[f.key]; };
    }
    input.id = `god-f-${target.id}-${f.key}`;
    row.append(input);
    state.trackRow(input, input.__read);

    if (!f.readOnly && (f.type === 'number' || f.type === 'boolean')) {
      row.append(pinToggle(target, f.key, () => obj[f.key]));
    }
    return row;
  }

  // --- pin / hold -----------------------------------------------------------
  const pinId = (target, key) => `${target.scope || target.id}.${key}`;
  function pinToggle(target, key, read) {
    const id = pinId(target, key);
    const b = el('button', {
      border: 'none', background: 'none', cursor: 'pointer', fontSize: '12px',
      opacity: panel.pins.has(id) ? '1' : '.35', padding: '0 2px',
    }, { textContent: '📌', title: 'Hold this value every frame' });
    b.onclick = () => {
      if (panel.pins.has(id)) panel.pins.delete(id);
      // The pin carries the field's SETTER, if it has one - the per-frame hold
      // below writes through it for the same reason the edit box does.
      else {
        panel.pins.set(id, {
          label: `${target.title} · ${key}`,
          getObj: target.getObj,
          set: target.setters?.[key] || null,
          key,
          value: read(),
        });
      }
      render();
    };
    return b;
  }

  // --- inventory (array of item ids) ---------------------------------------
  function inventorySection(sheet) {
    const wrap = el('div', { padding: '6px 9px', borderTop: '1px solid #24243a' });
    wrap.append(el('div', { font: '10px system-ui', opacity: '.6', marginBottom: '4px', letterSpacing: '1px' }, { textContent: 'INVENTORY' }));
    const chips = el('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '5px' });
    (sheet.inventory || []).forEach((itemId, i) => {
      const def = ITEMS[itemId] || {};
      const chip = el('div', {
        display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px',
        borderRadius: '10px', background: '#2e2e46', font: '11px system-ui',
      });
      chip.append(document.createTextNode(`${def.icon || '📦'} ${def.name || itemId}`));
      chip.append(button('×', () => { sheet.inventory.splice(i, 1); api.refreshHud(); render(); }, { padding: '0 4px', borderRadius: '8px' }));
      chips.append(chip);
    });
    if (!(sheet.inventory || []).length) chips.append(el('span', { opacity: '.5', font: '11px system-ui' }, { textContent: 'empty' }));
    wrap.append(chips);
    const add = el('div', { display: 'flex', gap: '5px' });
    const sel = itemSelect();
    add.append(sel, button('Give', () => { api.giveItem(sel.value); render(); }));
    wrap.append(add);
    return wrap;
  }

  function usesEditorCard(target) {
    const card = el('div', { margin: '8px 0', border: '1px solid #2c2c42', borderRadius: '8px', overflow: 'hidden' });
    card.append(el('div', { padding: '6px 9px', background: '#1f1f30', fontWeight: '700', font: '12px system-ui' }, { textContent: target.title }));
    const c = target.usesEditor;
    for (const id of Object.keys(c.usesLeft)) {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 9px', borderTop: '1px solid #24243a' });
      row.append(el('div', { flex: '1', font: '11px system-ui' }, { textContent: id }));
      const input = el('input', numStyle(false), { type: 'number', step: '1', value: fmt(c.usesLeft[id]) });
      input.onchange = () => { const n = parseInt(input.value, 10); if (!Number.isNaN(n)) { c.usesLeft[id] = n; c.refresh(); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      input.__read = () => { input.value = fmt(c.usesLeft[id]); };
      state.trackRow(input, input.__read);
      row.append(input);
      card.append(row);
    }
    return card;
  }

  // --- placement (click-to-place, via the game's own ground raycast) --------
  function armPlace(kind, payload, message) {
    state.beginPlacement(kind);
    hint.textContent = `◎ ${message} · (Esc / click here to cancel)`;
    hint.style.display = 'block';
    api.armPick((tile, point) => {
      state.clearPlacement();
      hint.style.display = 'none';
      if (!tile) { render(); return; }
      if (kind === 'teleport') api.teleport(point ? point.x : tile.x, point ? point.z : tile.z);
      else if (kind === 'spawn') api.spawnEnemy(payload, tile.x, tile.z);
      else if (kind === 'drop') api.dropItem(payload, tile.x, tile.z);
      render();
    });
  }
  hint.onclick = cancelPlace;
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelPlace(); });
  function cancelPlace() {
    if (!state.placement) return;
    state.clearPlacement();
    hint.style.display = 'none';
    api.armPick(null);
    render();
  }

  // --- render ---------------------------------------------------------------
  function currentTargets() {
    if (state.activeTab === 'player') return playerTargets();
    if (state.activeTab === 'enemies') return enemyTargets();
    if (state.activeTab === 'combat') return combatTargets();
    return [];
  }

  function render() {
    for (const t of TABS) tabBtns[t].style.background = t === state.activeTab ? '#34344f' : '#2e2e46';
    body.innerHTML = '';
    state.resetRows();
    const filter = search.value.trim().toLowerCase();

    if (filter) {
      // Search is cross-tab: every reflectable target from Player / Enemies /
      // Combat, filtered to matching parameter names.
      const all = [...playerTargets(), ...enemyTargets(), ...combatTargets()];
      let any = false;
      for (const target of all) {
        if (target.note || target.usesEditor) continue;
        const card = reflectCard(target, filter);
        if (card.querySelectorAll('input').length || target.title.toLowerCase().includes(filter)) { body.append(card); any = true; }
      }
      if (!any) body.append(el('div', { opacity: '.5', padding: '12px 4px', font: '12px system-ui' }, { textContent: 'No matching parameters.' }));
    } else if (state.activeTab === 'world') {
      renderWorld();
    } else if (state.activeTab === 'spawn') {
      renderSpawn();
    } else {
      for (const target of currentTargets()) {
        body.append(target.usesEditor ? usesEditorCard(target) : reflectCard(target, null));
      }
    }

    renderWatch();
    state.setLastSignature(state.signature(api, search.value));
  }

  function renderWatch() {
    watch.innerHTML = '';
    if (panel.pins.size === 0) { watch.style.display = 'none'; return; }
    watch.style.display = 'flex';
    watch.append(el('div', { font: '9px system-ui', letterSpacing: '1px', opacity: '.55' }, { textContent: 'PINNED (held every frame)' }));
    for (const [id, pin] of panel.pins) {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });
      const val = el('span', { fontVariantNumeric: 'tabular-nums', color: '#8adf76' });
      val.__read = () => { const o = pin.getObj(); val.textContent = o ? fmt(o[pin.key]) : '—'; };
      val.__read();
      state.trackRow(val, val.__read);
      row.append(el('span', { flex: '1', opacity: '.85' }, { textContent: pin.label }), val,
        button('×', () => { panel.pins.delete(id); render(); }, { padding: '0 5px' }));
      watch.append(row);
    }
  }

  // Live sync at 10 Hz, off the wall clock so it keeps ticking at timeScale 0.
  // Never overwrites the field being edited.
  setInterval(() => {
    if (!panel.open) return;
    if (state.signature(api, search.value) !== state.lastSignature) { render(); return; }
    state.syncRows(document.activeElement);
  }, 100);

  // --- small shared bits ----------------------------------------------------
  function afterEdit(target) {
    api.refreshHud();
    if (api.combat) api.combat.refresh();
  }
  function sectionTitle(t) {
    return el('div', { font: '10px system-ui', letterSpacing: '2px', color: '#8a8577', margin: '10px 0 5px', borderBottom: '1px solid #2c2c42', paddingBottom: '3px' }, { textContent: t });
  }
  function readout(label, get) {
    const row = el('div', { display: 'flex', gap: '7px', padding: '2px', font: '11px system-ui' });
    row.append(el('div', { flex: '1', opacity: '.7' }, { textContent: label }));
    const v = el('div', { fontVariantNumeric: 'tabular-nums' });
    v.__read = () => { v.textContent = get(); };
    v.__read();
    state.trackRow(v, v.__read);
    row.append(v);
    body.append(row);
  }
  function itemSelect() {
    const s = el('select', selectStyle());
    for (const id of Object.keys(ITEMS)) s.append(el('option', null, { value: id, textContent: `${ITEMS[id].icon || ''} ${ITEMS[id].name}` }));
    return s;
  }

  return panel;
}

// --- shared field styling ----------------------------------------------------
const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));
const numStyle = (ro) => ({
  width: '78px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #3a3a52',
  background: ro ? '#20202f' : '#1b1b2a', color: ro ? '#9a9ab0' : '#f0f0f5', font: '11px system-ui',
});
const textStyle = (ro) => Object.assign(numStyle(ro), { width: '130px' });
const selectStyle = () => ({
  flex: '1', padding: '4px', borderRadius: '5px', border: '1px solid #3a3a52',
  background: '#1b1b2a', color: '#f0f0f5', font: '11px system-ui',
});
