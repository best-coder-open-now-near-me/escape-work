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
import { ENEMY_TYPES } from './data/enemies.js';
import { COMPANIONS } from './data/companions.js';
import { STATUSES } from './data/statuses.js';
import { applyStatus, clearStatuses, statusList, severityFor } from './statuses.js';

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
  const panel = { root, open: false, pins: new Map(), setOpen };
  let activeTab = 'player';
  // What the STATUSES control (Spawn tab) is set to, kept across the re-render
  // an Apply triggers. Declared up here with the rest of the panel's state
  // because render() runs before the section that uses it is reached.
  const statusPick = { id: Object.keys(STATUSES)[0], dur: 3, res: 0 };
  let showInternals = false;
  let lastSig = '';
  let rows = []; // { input, read } for live value sync (not the focused one)
  let placing = null; // { kind, label }

  internalsBox.onchange = () => { showInternals = internalsBox.checked; render(); };
  search.oninput = () => render();

  const TABS = ['player', 'enemies', 'combat', 'world', 'spawn'];
  const tabBtns = {};
  for (const t of TABS) {
    const b = button(t[0].toUpperCase() + t.slice(1), () => { activeTab = t; search.value && (search.value = ''); render(); },
      { flex: '1', padding: '5px 0', borderRadius: '6px 6px 0 0' });
    b.id = `god-tab-${t}`;
    tabBtns[t] = b;
    tabbar.append(b);
  }

  function setOpen(v) {
    panel.open = v;
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
      hide: target.hide, readOnly: target.readOnly, showInternals,
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
    rows.push({ input, read: input.__read });

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

  // --- per-tab target lists -------------------------------------------------
  function playerTargets() {
    const out = [];
    const party = api.party;
    if (!party) {
      out.push({ id: 'sheet', title: 'Character Sheet', note: 'Pick a class first.' });
      return out;
    }
    // The purse, above the sheets. It is PARTY state, not sheet state
    // (ECONOMY_PLAN #2), so it gets a card of its own rather than hiding on
    // whoever happens to be active. `members` is an array and `active` is
    // hidden, so this card renders exactly one editable field - the money -
    // which is the whole point of having it during a balance session.
    out.push({
      id: 'purse', scope: 'purse',
      title: 'Petty Cash',
      obj: party,
      getObj: () => api.party,
      hide: new Set(['active']),
      setters: { cash: (n) => api.setCash(n) }, // clamped, whole, and repaints
    });
    // One live sheet card per party member; the active one carries the
    // inventory editor (Give lands in the controlled member's pockets).
    party.members.forEach((m, i) => {
      const active = i === party.active;
      const actions = [];
      if (!active && m.sheet.hp > 0 && m.actor) {
        actions.push({ label: 'Control', run: () => { api.switchTo(i); render(); } });
      }
      if (m.sheet.hp <= 0) {
        actions.push({ label: 'Revive (1 HP)', run: () => { api.reviveMember(i); render(); } });
      }
      out.push({
        // The ACTIVE member keeps the plain 'sheet' scope - stable field ids
        // (#god-f-sheet-hp) and pins that always mean "whoever I control".
        // So the 'sheet' pin must RESOLVE that way too: bound to the index that
        // happened to be active when it was pinned, switching control left the
        // pin holding the old member while displaying as the new one's.
        id: active ? 'sheet' : `sheet-${i}`, scope: active ? 'sheet' : `sheet-${i}`,
        title: `${m.sheet.name}${active ? ' (active)' : ''}${m.sheet.hp <= 0 ? ' †' : ''}`,
        obj: m.sheet,
        getObj: active
          ? () => api.party?.members[api.party.active]?.sheet
          : () => api.party?.members[i]?.sheet,
        // maxHp/maxAp are DERIVED from attr + the class base (stats.js
        // recomputeDerived) - assigning them directly is the one thing
        // ARCHITECTURE.md forbids, because the next recompute (equipping gear,
        // raising an attribute, loading a save) silently discards the edit, and
        // pinning one makes the pin fight the recompute every frame.
        readOnly: new Set(['classId', 'companionId', 'className', 'model', 'xpNext', 'name',
          'maxHp', 'maxAp']),
        special: active ? 'inventory' : null,
        actions,
      });
    });
    const pa = api.playerActor;
    if (pa && pa.entity) {
      out.push({
        id: 'body', scope: 'body', title: 'Body (position, speed)', obj: pa, getObj: () => api.playerActor,
        hide: RIG_INTERNALS, readOnly: new Set(['x', 'z']),
        actions: [{ label: 'Teleport (click a tile)', run: () => armPlace('teleport', null, 'Click a tile to teleport the player') }],
      });
    }
    return out;
  }

  function enemyTargets() {
    return api.enemies.map((en, i) => ({
      // A pin resolves its target by IDENTITY, not by array index. `enemies`
      // is spliced when an expired enemy summon leaves the board, and every
      // later index shifts down - an index-based pin then force-wrote its held
      // value into a DIFFERENT coworker every frame (holding a fresh one at
      // hp 1, resurrecting a wounded one) while the watch row still named the
      // old one. Once this body is off the board the pin resolves to null and
      // simply stops.
      id: `enemy-${i}`, scope: `enemy-${i}`, obj: en,
      getObj: () => (api.enemies.includes(en) ? en : null),
      title: `${en.def.name} @ (${en.x}, ${en.z})${en.alive ? '' : ' †'}`,
      hide: RIG_INTERNALS, readOnly: new Set(['x', 'z', 'typeId']),
      actions: [
        { label: 'Full heal', run: () => { en.hp = en.maxHp; api.combat && api.combat.refresh(); render(); } },
        { label: 'Kill', run: () => { if (en.alive) en.die(); render(); } },
      ],
    }));
  }

  function combatTargets() {
    const c = api.combat;
    if (!c) return [{ id: 'combat', title: 'Combat', note: 'No fight in progress.' }];
    const out = [{
      id: 'combat', scope: 'combat', title: 'Combat', obj: c, getObj: () => api.combat,
      readOnly: new Set(['phase', 'armed', 'maxAp']),
    }];
    // Per-action "uses left this fight" (heals) - a plain object, rendered as
    // its own small editor rather than through the primitive walker.
    if (c.usesLeft && Object.keys(c.usesLeft).length) {
      out.push({ id: 'uses', title: 'Action uses left', usesEditor: c });
    }
    return out;
  }

  // --- world + spawn (bespoke control tabs) --------------------------------
  function renderWorld() {
    body.append(sectionTitle('TIME'));
    const tsRow = el('div', { display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '6px' });
    const scales = [['Pause', 0], ['¼', 0.25], ['½', 0.5], ['1×', 1], ['2×', 2]];
    for (const [label, v] of scales) {
      const active = Math.abs(api.timeScale - v) < 1e-6;
      const b = button(label, () => { api.timeScale = v; render(); },
        { flex: '1', minWidth: '46px', borderColor: active ? '#8adf76' : '#3a3a52', background: active ? '#31452c' : '#2e2e46' });
      b.id = `god-timescale-${v}`;
      tsRow.append(b);
    }
    body.append(tsRow);

    body.append(sectionTitle('READOUTS'));
    readout('timeScale', () => fmt(api.timeScale));
    readout('inCombat', () => String(api.inCombat));
    readout('gameOver', () => String(api.gameOver));
    readout('tiles burning', () => String(api.burningCount));

    const doors = api.doors;
    if (doors.length) {
      body.append(sectionTitle('DOORS'));
      for (const d of doors) {
        const row = el('div', { display: 'flex', alignItems: 'center', gap: '7px', padding: '3px 2px', font: '11px system-ui' });
        row.append(el('div', { flex: '1' }, { textContent: d.key }));
        const box = el('input', { cursor: 'pointer' }, { type: 'checkbox', checked: d.open });
        box.onchange = () => { api.setDoorOpen(d.key, box.checked); };
        row.append(el('span', { opacity: '.6' }, { textContent: 'open' }), box);
        body.append(row);
      }
    }
  }

  // Land any status on the character you're steering, with the duration and the
  // resist you want, without staging a fight to get one. Written because the
  // things a status DOES to the player are the things you have to look at to
  // judge - the sway and the ink of a blind, the re-dealt action bar of a reorg,
  // how much Composure has to blunt them before they stop being a problem - and
  // the only way to see them was to walk a Security Guard into you and hope he
  // rolled the right attack.
  //
  // Turn-clock statuses do not tick outside combat (there are no turns), which
  // makes this a HOLD rather than a countdown out on the map: apply it, walk
  // around in it for as long as you like, clear it. In a fight it ticks
  // normally, so the same control tests the real lifecycle.
  function renderStatuses() {
    body.append(sectionTitle('STATUSES'));
    if (!api.player) {
      body.append(el('div', { opacity: '.55', font: '11px system-ui' }, { textContent: 'Needs a character - pick a class first.' }));
      return;
    }
    const row = el('div', { display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' });
    const sel = el('select', selectStyle());
    for (const id of Object.keys(STATUSES)) {
      sel.append(el('option', null, { value: id, textContent: `${STATUSES[id].icon || ''} ${STATUSES[id].name}` }));
    }
    sel.id = 'god-status';
    // The three choices survive the re-render an Apply triggers (`statusPick`,
    // panel scope). Without that the dropdown snapped back to the first status
    // after every press, and the loop this control exists for - apply, look at
    // it, raise the resist, apply again - meant re-picking the status each time.
    sel.value = statusPick.id;
    const dur = el('input', { ...numStyle(false), width: '52px' }, { type: 'number', min: '1', step: '1', value: String(statusPick.dur), title: 'Ticks / steps to apply' });
    const res = el('input', { ...numStyle(false), width: '52px' }, { type: 'number', min: '0', step: '1', value: String(statusPick.res), title: "Composure's statusResist - shortens AND blunts a resistable status" });
    // The severity that resist buys, shown before you commit to it: the number
    // the whole stat is worth is otherwise invisible until the effect lands.
    const sev = el('div', { font: '11px system-ui', opacity: '.7', minWidth: '96px' });
    const paintSev = () => {
      const s = severityFor(sel.value, Number(res.value) || 0);
      sev.textContent = STATUSES[sel.value]?.resistable
        ? `severity ${s.toFixed(2)}` : 'not resistable';
    };
    const remember = () => {
      statusPick.id = sel.value;
      statusPick.dur = Math.max(1, Number(dur.value) || 1);
      statusPick.res = Math.max(0, Number(res.value) || 0);
    };
    sel.onchange = () => { remember(); paintSev(); };
    dur.oninput = remember;
    res.oninput = () => { remember(); paintSev(); };
    paintSev();
    const apply = button('Apply', () => {
      remember();
      applyStatus(api.player, statusPick.id, { duration: statusPick.dur }, statusPick.res);
      afterEdit();
      render();
    });
    apply.id = 'god-apply-status';
    row.append(sel, dur, res, apply,
      button('Clear all', () => { clearStatuses(api.player); afterEdit(); render(); }));
    body.append(row, sev);
    // What is live on them right now, with what it is actually worth: `left` is
    // the countdown the chip shows, `sev` is how hard it landed.
    const live = statusList(api.player);
    body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '6px' }, {
      textContent: live.length
        ? live.map((s) => `${s.icon} ${s.name} ·${s.left}${s.sev < 1 ? ` ·${Math.round(s.sev * 100)}%` : ''}`).join('   ')
        : 'Nothing live.',
    }));
  }

  function renderSpawn() {
    renderStatuses();
    body.append(sectionTitle('SPAWN ENEMY'));
    const eRow = el('div', { display: 'flex', gap: '5px', marginBottom: '8px' });
    const eSel = el('select', selectStyle());
    for (const id of Object.keys(ENEMY_TYPES)) eSel.append(el('option', null, { value: id, textContent: ENEMY_TYPES[id].name }));
    eRow.append(eSel,
      button('At player', () => { const pa = api.playerActor; api.spawnEnemy(eSel.value, pa.x, pa.z); render(); }),
      button('Click', () => armPlace('spawn', eSel.value, `Click a tile to spawn ${ENEMY_TYPES[eSel.value].name}`)));
    body.append(eRow);

    body.append(sectionTitle('ITEMS'));
    const iRow = el('div', { display: 'flex', gap: '5px' });
    const iSel = itemSelect();
    iRow.append(iSel,
      button('Give', () => { api.giveItem(iSel.value); render(); }),
      button('Drop (click)', () => armPlace('drop', iSel.value, `Click a tile to drop ${ITEMS[iSel.value].name}`)));
    body.append(iRow);

    body.append(sectionTitle('PARTY'));
    const cRow = el('div', { display: 'flex', gap: '5px' });
    const cSel = el('select', selectStyle());
    // Labelled by ID as well as name: companions are named for the job they do
    // (data/companions.js), so two from the same class would be one repeated
    // string in this dropdown and there'd be no telling which one you recruited.
    for (const id of Object.keys(COMPANIONS)) {
      cSel.append(el('option', null, { value: id, textContent: `${COMPANIONS[id].name} (${id})` }));
    }
    const recruitBtn = button('Recruit', () => { api.recruit(cSel.value); render(); });
    recruitBtn.id = 'god-recruit';
    cRow.append(cSel, recruitBtn);
    body.append(cRow);
    body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '4px' },
      { textContent: 'Recruits the companion if they stand on this floor and the roster has room.' }));
    if (!api.player) body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '6px' }, { textContent: 'Give needs a character - pick a class first.' }));
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
      rows.push({ input, read: input.__read });
      row.append(input);
      card.append(row);
    }
    return card;
  }

  // --- placement (click-to-place, via the game's own ground raycast) --------
  function armPlace(kind, payload, message) {
    placing = { kind };
    hint.textContent = `◎ ${message} · (Esc / click here to cancel)`;
    hint.style.display = 'block';
    api.armPick((tile, point) => {
      placing = null;
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
    if (!placing) return;
    placing = null;
    hint.style.display = 'none';
    api.armPick(null);
    render();
  }

  // --- render ---------------------------------------------------------------
  function currentTargets() {
    if (activeTab === 'player') return playerTargets();
    if (activeTab === 'enemies') return enemyTargets();
    if (activeTab === 'combat') return combatTargets();
    return [];
  }

  function render() {
    for (const t of TABS) tabBtns[t].style.background = t === activeTab ? '#34344f' : '#2e2e46';
    body.innerHTML = '';
    rows = [];
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
    } else if (activeTab === 'world') {
      renderWorld();
    } else if (activeTab === 'spawn') {
      renderSpawn();
    } else {
      for (const target of currentTargets()) {
        body.append(target.usesEditor ? usesEditorCard(target) : reflectCard(target, null));
      }
    }

    renderWatch();
    lastSig = signature();
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
      rows.push({ input: val, read: val.__read });
      row.append(el('span', { flex: '1', opacity: '.85' }, { textContent: pin.label }), val,
        button('×', () => { panel.pins.delete(id); render(); }, { padding: '0 5px' }));
      watch.append(row);
    }
  }

  // A cheap fingerprint of the panel's STRUCTURE (not its values) - when it
  // changes (a fight starts, an enemy spawns, a class is picked) the view is
  // rebuilt; otherwise the 10 Hz tick only refreshes values in place.
  function signature() {
    // The party fingerprint: size, who's active, who's down - recruit,
    // switch and knock-out all restructure the player tab.
    const partySig = api.party
      ? api.party.members.map((m) => (m.sheet.hp <= 0 ? 'd' : 'a')).join('') + api.party.active
      : '';
    return [activeTab, search.value, showInternals, !!api.player, partySig, api.enemies.length,
      !!api.combat, api.doors.length, panel.pins.size, placing ? placing.kind : ''].join('|');
  }

  // Live sync at 10 Hz, off the wall clock so it keeps ticking at timeScale 0.
  // Never overwrites the field being edited.
  setInterval(() => {
    if (!panel.open) return;
    if (signature() !== lastSig) { render(); return; }
    for (const r of rows) if (r.input !== document.activeElement) r.read();
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
    rows.push({ input: v, read: v.__read });
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
