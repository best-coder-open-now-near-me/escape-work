// All DOM-facing UI: the HUD lines, the right-click context menu, and the
// win/lose overlays. Nothing in here knows about PlayCanvas.

// Shared chrome for floating panels and buttons - combat.js and the editor
// build their own DOM but should look like the rest of the UI, so the
// palette lives in exactly one place.
export const PANEL_CHROME = {
  background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
  boxShadow: '0 8px 24px rgba(0,0,0,.45)', font: '13px system-ui, sans-serif',
};
export const BUTTON_CHROME = {
  border: '1px solid #3a3a52', background: '#2e2e46', color: '#f0f0f5',
  font: 'inherit', cursor: 'pointer',
};

export function say(text) {
  const el = document.getElementById('subtitle');
  if (el) el.textContent = text;
  narrate(text);
}

// --- narrator box (Divinity / BG3 style general narration) --------------------
// General narration surfaces in a dialogue-style box near the bottom, like the
// narrator in Divinity/BG3 - not just the (now hidden) top subtitle. It is
// purely cosmetic: pointer-events pass through so play never stalls, and it
// auto-fades. Combat owns its own bottom panel + log and a live conversation
// owns the dialogue panel, so main.js gates the narrator off during both (see
// setNarrationGate) to avoid stacking boxes at the bottom of the screen.
let narratorEl = null;
let narratorTimer = null;
let narrationOk = false;

function ensureNarrator() {
  if (narratorEl) return narratorEl;
  narratorEl = document.createElement('div');
  narratorEl.id = 'narration-box';
  Object.assign(narratorEl.style, {
    position: 'fixed', right: '14px', bottom: '20px', transform: 'translateY(6px)',
    zIndex: '27', maxWidth: 'min(360px, 46vw)', boxSizing: 'border-box',
    pointerEvents: 'none', textAlign: 'left',
    background: 'rgba(18,18,30,.9)', border: '1px solid #3a3a52', borderRadius: '12px',
    padding: '11px 16px', color: '#e9e7f2',
    font: 'italic 14px Georgia, "Times New Roman", serif', lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    opacity: '0', transition: 'opacity .2s ease, transform .2s ease',
  });
  document.body.appendChild(narratorEl);
  return narratorEl;
}

function hideNarrator() {
  if (!narratorEl) return;
  narratorEl.style.opacity = '0';
  narratorEl.style.transform = 'translateY(6px)';
}

// main.js flips this each frame: narration is welcome only when a class is in
// play and neither combat nor a conversation owns the bottom of the screen.
export function setNarrationGate(ok) {
  narrationOk = ok;
  if (!ok) hideNarrator();
}

function narrate(text) {
  if (!narrationOk || !text) return;
  const el = ensureNarrator();
  el.textContent = text;
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  if (narratorTimer) clearTimeout(narratorTimer);
  narratorTimer = setTimeout(hideNarrator, 5200);
}

// --- focused-object banner (Divinity/BG3 examine-on-hover) --------------------
// Naming whatever the cursor is over, up top, before you click it. Cosmetic +
// non-interactive; main.js feeds it the current hover target each mouse move
// (an { name, detail, color } object) or null to clear. The border tint tracks
// the hover-highlight palette (hostile red, talkable green, lootable gold,
// neutral cyan) so the banner and the world glow read as the same signal.
let focusEl = null;
function ensureFocusBanner() {
  if (focusEl) return focusEl;
  focusEl = document.createElement('div');
  focusEl.id = 'focus-banner';
  Object.assign(focusEl.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translate(-50%, -4px)',
    zIndex: '20', pointerEvents: 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    minWidth: '150px', maxWidth: 'min(520px, 66vw)', padding: '8px 18px', borderRadius: '10px',
    background: 'rgba(20,20,32,.92)', border: '1px solid #3a3a52',
    boxShadow: '0 6px 20px rgba(0,0,0,.5)', whiteSpace: 'nowrap',
    opacity: '0', transition: 'opacity .12s ease, transform .12s ease',
  });
  document.body.appendChild(focusEl);
  return focusEl;
}

// info: { name, sub, color, dotColor }. Tiered + centred - the name on top,
// `sub` (HP, or the verb a click takes) beneath. When `dotColor` is set a small
// dot flanks each side of the name; callers use it for an enemy's aggression.
export function setFocusBanner(info) {
  const el = ensureFocusBanner();
  if (!info) {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -4px)';
    return;
  }
  el.innerHTML = '';

  const nameRow = document.createElement('div');
  Object.assign(nameRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px' });
  const dot = () => {
    const d = document.createElement('span');
    Object.assign(d.style, {
      width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto',
      background: info.dotColor, boxShadow: `0 0 6px ${info.dotColor}`,
    });
    return d;
  };
  if (info.dotColor) nameRow.appendChild(dot());
  const name = document.createElement('span');
  Object.assign(name.style, { font: '700 15px system-ui, sans-serif', letterSpacing: '.4px', color: '#f4f4fa' });
  name.textContent = info.name;
  nameRow.appendChild(name);
  if (info.dotColor) nameRow.appendChild(dot());
  el.appendChild(nameRow);

  if (info.sub) {
    const sub = document.createElement('div');
    Object.assign(sub.style, { font: '12px system-ui, sans-serif', opacity: '.66', marginTop: '3px', letterSpacing: '.5px' });
    sub.textContent = info.sub;
    el.appendChild(sub);
  }
  el.style.borderColor = info.color || '#3a3a52';
  el.style.opacity = '1';
  el.style.transform = 'translate(-50%, 0)';
}

// --- loot toast ---------------------------------------------------------------
// A short-lived notice pinned top-left, just right of the inventory button, so
// loot pickups ("Printer: Toner Cartridge") read as a quick "you got X" instead
// of taking over the centre HUD. One reused element: rapid loots replace the
// text and restart the pop rather than stacking.
let toastEl = null;
let toastTimer = null;
export function toast(text, ms = 2600) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'loot-toast';
    Object.assign(toastEl.style, {
      position: 'fixed', top: '12px', left: '102px', zIndex: '26',
      maxWidth: 'min(360px, 52vw)', padding: '7px 13px', borderRadius: '7px',
      background: 'rgba(20,20,32,.94)', border: '1px solid #8adf76',
      color: '#eafff0', font: '700 13px system-ui, sans-serif', letterSpacing: '.4px',
      boxShadow: '0 6px 20px rgba(0,0,0,.5)', pointerEvents: 'none',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      opacity: '0', transform: 'translateY(-6px)',
    });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  // Replay the slide/fade even when re-fired while still on screen.
  toastEl.style.transition = 'none';
  toastEl.style.opacity = '0';
  toastEl.style.transform = 'translateY(-6px)';
  void toastEl.offsetWidth; // reflow so the reset lands before we animate in
  toastEl.style.transition = 'opacity .18s ease, transform .18s ease';
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateY(0)';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateY(-6px)';
  }, ms);
}

export function updateStatsHud(sheet) {
  const el = document.getElementById('stats');
  if (el) el.textContent = `Lv ${sheet.level} · HP ${sheet.hp}/${sheet.maxHp} · XP ${sheet.xp}/${sheet.xpNext}`;
  renderStatusEffects(sheet);
}

// --- player status effects ----------------------------------------------------
// Transient effects stacked just above the bottom-left stats - gum, bleeding,
// and any temporary buffs. NOT the class talent, which is a permanent trait,
// not a status. Buffs read green, debuffs amber - the same good/bad language as
// the enemy aggression dots. Rebuilt on every stats refresh (each effect change
// already pokes updateStatsHud), so it appears/clears in step with the effect.
let statusEl = null;
function ensureStatusList() {
  if (statusEl) return statusEl;
  statusEl = document.createElement('div');
  statusEl.id = 'status-effects';
  Object.assign(statusEl.style, {
    position: 'fixed', left: '12px', bottom: '48px', zIndex: '6',
    display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start',
    pointerEvents: 'none', font: '12px system-ui, sans-serif',
  });
  document.body.appendChild(statusEl);
  return statusEl;
}

function effectChips(sheet) {
  const chips = [];
  if (sheet.gum > 0) chips.push({ icon: '🍬', label: 'Gum on shoe', good: false });
  if (sheet.bleed > 0) chips.push({ icon: '🩸', label: 'Bleeding', good: false });
  return chips;
}

function renderStatusEffects(sheet) {
  const el = ensureStatusList();
  el.innerHTML = '';
  if (!sheet) return;
  for (const c of effectChips(sheet)) {
    const chip = document.createElement('div');
    chip.className = 'status-chip';
    chip.textContent = `${c.icon} ${c.label}`;
    const accent = c.good ? '#6fc86f' : '#e0b23a';
    Object.assign(chip.style, {
      padding: '3px 9px', borderRadius: '6px', whiteSpace: 'nowrap', letterSpacing: '.3px',
      background: 'rgba(20,20,32,.72)', border: `1px solid ${accent}`, color: '#eef',
    });
    el.appendChild(chip);
  }
}

// A soft radial vignette over the whole viewport - pure atmosphere, makes the
// flat office glow feel a little more dungeon.
export function addVignette() {
  const v = document.createElement('div');
  v.id = 'vignette';
  Object.assign(v.style, {
    position: 'fixed', inset: '0', zIndex: '4', pointerEvents: 'none',
    background: 'radial-gradient(ellipse at center, transparent 52%, rgba(6,6,12,0.5) 100%)',
  });
  document.body.appendChild(v);
}

// --- context menu -----------------------------------------------------------
let menuEl = null;
function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.id = 'context-menu';
  Object.assign(menuEl.style, {
    position: 'fixed', zIndex: '20', minWidth: '170px', display: 'none',
    background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
    borderRadius: '7px', padding: '5px', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
    font: '13px system-ui, sans-serif', userSelect: 'none',
  });
  document.body.appendChild(menuEl);
  // A left-press outside the menu closes it; right-presses only reposition it.
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && menuEl && !menuEl.contains(e.target)) hideMenu();
  });
  return menuEl;
}

export function showMenu(x, y, items) {
  const el = ensureMenu();
  el.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.textContent = it.label;
    Object.assign(row.style, { padding: '7px 11px', borderRadius: '5px', cursor: 'pointer' });
    row.onmouseenter = () => { row.style.background = '#34344f'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    row.onclick = () => { hideMenu(); it.action && it.action(); };
    el.appendChild(row);
  }
  el.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  el.style.top = Math.min(y, window.innerHeight - items.length * 34 - 12) + 'px';
  el.style.display = 'block';
}

export function hideMenu() {
  if (menuEl) menuEl.style.display = 'none';
}

// --- Alt loot overlay ---------------------------------------------------------
// BG3-style: while Alt is held, clickable labels float over everything
// lootable in the area (loose items, containers, bodies). The caller supplies
// entries with world positions and repositions them each frame via project().
export function createLootLabels() {
  const root = document.createElement('div');
  root.id = 'loot-labels';
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '18', display: 'none', pointerEvents: 'none' });
  document.body.appendChild(root);
  let entries = [];

  function show(list) {
    entries = list;
    root.innerHTML = '';
    for (const en of entries) {
      const chip = document.createElement('div');
      chip.className = 'loot-label';
      chip.textContent = `${en.icon || '📦'} ${en.text}`;
      Object.assign(chip.style, {
        position: 'absolute', transform: 'translate(-50%, -100%)', whiteSpace: 'nowrap',
        background: 'rgba(22,22,36,.92)', border: '1px solid #3a3a52', borderRadius: '6px',
        padding: '3px 9px', color: '#f0f0f5', font: '12px system-ui, sans-serif',
        cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none', display: 'none',
      });
      chip.onmouseenter = () => { chip.style.borderColor = '#8adf76'; };
      chip.onmouseleave = () => { chip.style.borderColor = '#3a3a52'; };
      chip.onmousedown = (e) => e.stopPropagation(); // don't let the canvas see it
      chip.onclick = () => { hide(); en.onClick && en.onClick(); };
      en.el = chip;
      root.appendChild(chip);
    }
    root.style.display = 'block';
  }

  function hide() {
    entries = [];
    root.innerHTML = '';
    root.style.display = 'none';
  }

  // project(world) -> { x, y } screen px, or null when behind the camera.
  function reposition(project) {
    for (const en of entries) {
      const s = project(en.world);
      const ok = s && s.x > -80 && s.x < window.innerWidth + 80 && s.y > 0 && s.y < window.innerHeight + 40;
      en.el.style.display = ok ? 'block' : 'none';
      if (ok) {
        en.el.style.left = `${s.x}px`;
        en.el.style.top = `${s.y}px`;
      }
    }
  }

  return { show, hide, reposition, get visible() { return root.style.display !== 'none'; } };
}

// --- inventory panel ----------------------------------------------------------
// The pockets. Toggled with I or the bag button. Rows come straight from the
// item registry; `usable` items get Use, flavor items get Examine, everything
// can be dropped (dropping creates a loose floor item the Alt overlay sees).
export function createInventoryPanel(ITEMS, cap, { onUse, onDrop, onExamine }) {
  const bag = document.createElement('button');
  bag.id = 'inventory-btn';
  bag.textContent = '🎒';
  Object.assign(bag.style, {
    position: 'fixed', top: '12px', left: '58px', zIndex: '25',
    background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
    borderRadius: '7px', padding: '6px 10px', font: '14px system-ui, sans-serif',
    cursor: 'pointer',
  });
  document.body.appendChild(bag);

  const panel = document.createElement('div');
  panel.id = 'inventory-panel';
  Object.assign(panel.style, {
    position: 'fixed', top: '54px', left: '12px', zIndex: '25', width: '250px',
    display: 'none', background: '#232334', color: '#f0f0f5',
    border: '1px solid #3a3a52', borderRadius: '9px', padding: '10px 12px',
    font: '12px system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
  });
  document.body.appendChild(panel);

  const smallBtn = (label, title) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '3px 8px', borderRadius: '5px', border: '1px solid #3a3a52',
      background: '#2e2e46', color: '#f0f0f5', font: '11px system-ui, sans-serif',
      cursor: 'pointer',
    });
    return b;
  };

  function refresh(sheet) {
    const inv = sheet?.inventory || [];
    panel.innerHTML = `<div style="font-weight:700; letter-spacing:1px; margin-bottom:7px;">
      POCKETS <span style="opacity:.6; font-weight:400;">${inv.length}/${cap} · 📄 ${sheet?.paper ?? 0}</span></div>`;
    if (!inv.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '.6';
      empty.textContent = 'Empty. The office provides, if you rummage.';
      panel.appendChild(empty);
      return;
    }
    inv.forEach((id, i) => {
      const def = ITEMS[id];
      const row = document.createElement('div');
      row.id = `inv-row-${i}`;
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 2px',
        borderTop: i ? '1px solid #2c2c42' : 'none',
      });
      const name = document.createElement('div');
      name.textContent = `${def?.icon || '📦'} ${def?.name || id}`;
      name.style.flex = '1';
      name.title = def?.examine || '';
      row.appendChild(name);
      if (def?.heal || def?.ammo) {
        const use = smallBtn('Use', def.heal ? `+${def.heal} HP` : `+${def.ammo} paper`);
        use.id = `inv-use-${i}`;
        use.onclick = () => onUse(i);
        row.appendChild(use);
      } else {
        const ex = smallBtn('👁', def?.examine || '');
        ex.id = `inv-examine-${i}`;
        ex.onclick = () => onExamine(i);
        row.appendChild(ex);
      }
      const drop = smallBtn('Drop', 'Leave it on the floor');
      drop.id = `inv-drop-${i}`;
      drop.onclick = () => onDrop(i);
      row.appendChild(drop);
      panel.appendChild(row);
    });
  }

  let lastSheet = null;
  function toggle(sheet) {
    lastSheet = sheet;
    const showing = panel.style.display !== 'none';
    panel.style.display = showing ? 'none' : 'block';
    if (!showing) refresh(sheet);
  }
  bag.onclick = () => { if (lastSheet) toggle(lastSheet); };

  return {
    toggle,
    refresh: (sheet) => { lastSheet = sheet; if (panel.style.display !== 'none') refresh(sheet); },
    hide: () => { panel.style.display = 'none'; },
    get visible() { return panel.style.display !== 'none'; },
  };
}

// --- persistent attack hotbar -------------------------------------------------
// Always-on out-of-combat action bar: the player's OFFENSIVE actions (attacks,
// shove, thrown weapons) so a coworker can be targeted before a fight starts.
// Arming a slot and clicking an enemy opens combat with that move (main.js
// wires the arming + targeting). Ids are `#hotbar-act-<id>` - deliberately NOT
// the combat bar's `#act-<id>`, so the two never collide in the DOM or tests.
// `actions` is [{ id, label, ap, ammoCost }]; onArm(id) toggles a slot.
export function createHotbar(actions, { onArm }) {
  const bar = document.createElement('div');
  bar.id = 'hotbar';
  Object.assign(bar.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
    zIndex: '22', display: 'none', gap: '7px', padding: '8px 10px', borderRadius: '10px',
    userSelect: 'none',
  });
  document.body.appendChild(bar);

  const buttons = actions.map((a, i) => {
    const b = document.createElement('button');
    b.id = 'hotbar-act-' + a.id;
    b.dataset.action = a.id;
    Object.assign(b.style, BUTTON_CHROME, {
      minWidth: '104px', padding: '7px 6px', borderRadius: '7px',
    });
    b.title = `${a.label} · ${a.ap}AP`;
    b.onmousedown = (e) => e.stopPropagation(); // don't let the canvas see it
    b.onclick = () => onArm(a.id);
    bar.appendChild(b);
    return { b, def: a };
  });

  let armed = null;
  let sheet = null;
  function render() {
    buttons.forEach(({ b, def }, i) => {
      let label = `${i + 1} · ${def.label}`;
      if (def.ammoCost) label += ` (${sheet?.paper ?? 0}📄)`;
      b.textContent = label;
      const usable = !def.ammoCost || (sheet?.paper ?? 0) >= def.ammoCost;
      b.disabled = !usable;
      b.style.opacity = usable ? '1' : '.4';
      b.style.borderColor = def.id === armed ? '#8adf76' : '#3a3a52';
    });
  }
  render();

  return {
    setVisible: (v) => { bar.style.display = v ? 'flex' : 'none'; },
    setArmed: (id) => { armed = id; render(); },
    refresh: (s) => { sheet = s; render(); },
    get armed() { return armed; },
    get visible() { return bar.style.display !== 'none'; },
    destroy: () => bar.remove(), // leader switches rebuild the bar wholesale
  };
}

// --- party bar ----------------------------------------------------------------
// The roster, top-left: one slot per member (#party-slot-<i> for the tests)
// with name, an HP bar, a DOWN marker, and a highlight on the member being
// controlled. Clicking a slot asks the host to switch control - the host
// decides whether that's allowed right now (combat, dialogue, downed).
export function createPartyBar({ onSelect, onLevelUp }) {
  const bar = document.createElement('div');
  bar.id = 'party-bar';
  Object.assign(bar.style, PANEL_CHROME, {
    position: 'fixed', left: '12px', top: '54px', zIndex: '21',
    display: 'none', flexDirection: 'column', gap: '6px',
    padding: '8px', borderRadius: '10px', userSelect: 'none', minWidth: '130px',
  });
  bar.onmousedown = (e) => e.stopPropagation(); // clicks stay off the canvas
  document.body.appendChild(bar);

  // `combatInfo` (optional) is combat's per-member snapshot ([{ap}, ...]) -
  // when present, each living slot also shows that member's remaining AP.
  function refresh(party, combatInfo = null) {
    bar.innerHTML = '';
    party.members.forEach((m, i) => {
      const s = m.sheet;
      const down = s.hp <= 0;
      const ap = combatInfo && !down ? ` · ${combatInfo[i]?.ap ?? 0}AP` : '';
      const slot = document.createElement('div');
      slot.id = 'party-slot-' + i;
      slot.className = 'party-slot';
      Object.assign(slot.style, {
        padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
        border: `1px solid ${i === party.active ? '#8adf76' : '#3a3a52'}`,
        background: i === party.active ? '#2e3a2e' : '#2a2a3e',
        opacity: down ? '.6' : '1', font: '12px system-ui, sans-serif',
      });
      slot.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <span style="font-weight:${i === party.active ? '700' : '400'};">${s.name}</span>
          <span style="opacity:.8">${down ? 'DOWN' : `${s.hp}/${s.maxHp}${ap}`}</span>
        </div>
        <div style="height:4px; margin-top:4px; background:#1a1a28; border-radius:2px;">
          <div style="height:100%; width:${Math.max(0, Math.round((s.hp / s.maxHp) * 100))}%;
            background:${down ? '#5a2a2a' : s.hp / s.maxHp > 0.4 ? '#6fc86f' : '#e0b23a'}; border-radius:2px;"></div>
        </div>`;
      slot.onclick = () => onSelect(i);
      // Level-up pip: a living member with banked points (of either type) wears
      // a badge; clicking it opens their allocation screen (without switching
      // control to them).
      const pending = (s.attrPoints || 0) + (s.classPoints || 0);
      if (!down && pending > 0 && onLevelUp) {
        const pip = document.createElement('button');
        pip.id = 'party-lvlup-' + i;
        pip.textContent = `⬆ Level Up (${pending})`;
        Object.assign(pip.style, {
          marginTop: '5px', width: '100%', padding: '3px 6px', borderRadius: '6px',
          border: '1px solid #8adf76', background: '#3a5a34', color: '#eafbe6',
          font: '11px system-ui, sans-serif', fontWeight: '700', cursor: 'pointer',
        });
        pip.onclick = (e) => { e.stopPropagation(); onLevelUp(i); };
        slot.appendChild(pip);
      }
      bar.appendChild(slot);
    });
  }

  return {
    refresh,
    setVisible: (v) => { bar.style.display = v ? 'flex' : 'none'; },
    get visible() { return bar.style.display !== 'none'; },
  };
}

// --- level-up ----------------------------------------------------------------
// A small always-available button by the stats HUD; lit while the LEADER has
// unspent points (companions advertise theirs on the party bar). Clicking opens
// the allocation flow. main.js drives visibility via refresh().
export function createLevelUpPip({ onOpen }) {
  const b = document.createElement('button');
  b.id = 'levelup-pip';
  Object.assign(b.style, {
    position: 'fixed', left: '12px', bottom: '70px', zIndex: '22', display: 'none',
    padding: '7px 13px', borderRadius: '8px', border: '1px solid #8adf76',
    background: '#3a5a34', color: '#eafbe6', font: '13px system-ui, sans-serif',
    fontWeight: '700', cursor: 'pointer',
  });
  b.onmousedown = (e) => e.stopPropagation();
  b.onclick = onOpen;
  document.body.appendChild(b);
  return {
    refresh(points) {
      if (points > 0) { b.textContent = `⬆ Level Up (${points})`; b.style.display = 'block'; }
      else b.style.display = 'none';
    },
    setVisible(v) { if (!v) b.style.display = 'none'; },
  };
}

// The allocation screen: attribute steppers + the class ability track. Dumb
// like the dialogue panel - main.js owns spendAttrPoint/spendClassPoint and
// hands over the sheet + callbacks (and a `nodesFor()` returning the current
// track view-models); we re-read the mutated sheet to redraw. onDone fires when
// the player closes it.
const LEVELUP_ATTRS = [
  { key: 'grit', label: 'Grit', blurb: 'Toughness — raises max HP.' },
  { key: 'hustle', label: 'Hustle', blurb: 'Tempo — raises max AP (move + actions).' },
  { key: 'savvy', label: 'Savvy', blurb: 'Precision — raises attack damage.' },
  { key: 'composure', label: 'Composure', blurb: 'Poise — softens incoming hits.' },
];

export function showLevelUpScreen(sheet, { onSpend, onLearn, nodesFor, onDone } = {}) {
  document.getElementById('levelup-screen')?.remove();
  const host = document.createElement('div');
  host.id = 'levelup-screen';
  Object.assign(host.style, {
    position: 'fixed', inset: '0', zIndex: '41', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10,10,18,.82)', color: '#f0f0f5', font: '14px system-ui, sans-serif',
  });
  host.onmousedown = (e) => e.stopPropagation();
  document.body.appendChild(host);

  function render() {
    const ap = sheet.attrPoints || 0;
    const cp = sheet.classPoints || 0;
    const nodes = nodesFor ? nodesFor() : [];
    const pending = ap + cp;
    host.innerHTML = `
      <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
        padding:22px 26px; min-width:380px; max-width:460px; max-height:86vh; overflow:auto;
        box-shadow:0 12px 40px rgba(0,0,0,.6);">
        <div style="font-weight:700; letter-spacing:1px; color:#8adf76;">LEVEL UP</div>
        <div style="opacity:.8; margin:2px 0 12px;">${sheet.name} · Level ${sheet.level}</div>
        <div style="font-size:12px; opacity:.75; margin-bottom:6px;">Attribute points:
          <b id="lvlup-points">${ap}</b></div>
        <div id="lvlup-rows" style="display:flex; flex-direction:column; gap:8px;"></div>
        <div style="margin-top:10px; opacity:.65; font-size:12px;">Derived: HP ${sheet.maxHp} · AP ${sheet.maxAp}</div>
        ${nodes.length ? `<div style="font-size:12px; opacity:.75; margin:16px 0 6px;
            border-top:1px solid #3a3a52; padding-top:12px;">Class points: <b id="lvlup-cp">${cp}</b></div>
          <div id="lvlup-track" style="display:flex; flex-direction:column; gap:6px;"></div>` : ''}
        <div style="margin-top:16px; text-align:right;">
          ${button('lvlup-done', pending > 0 ? 'Spend later' : 'Done')}</div>
      </div>`;
    const rows = host.querySelector('#lvlup-rows');
    for (const info of LEVELUP_ATTRS) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '7px 10px', borderRadius: '7px', background: '#2a2a3e',
      });
      row.innerHTML = `<div style="flex:1;">
        <div style="font-weight:600;">${info.label}
          <span style="opacity:.85;">${sheet.attr?.[info.key] ?? 0}</span></div>
        <div style="opacity:.6; font-size:12px;">${info.blurb}</div></div>`;
      const plus = document.createElement('button');
      plus.id = 'lvlup-attr-' + info.key;
      plus.textContent = '+';
      Object.assign(plus.style, BUTTON_CHROME, {
        width: '32px', height: '32px', borderRadius: '7px', fontSize: '19px', lineHeight: '1',
        opacity: ap > 0 ? '1' : '.4', cursor: ap > 0 ? 'pointer' : 'default',
      });
      plus.disabled = ap <= 0;
      plus.onclick = () => {
        if ((sheet.attrPoints || 0) <= 0) return;
        onSpend?.(info.key);
        render();
      };
      row.appendChild(plus);
      rows.appendChild(row);
    }
    const track = host.querySelector('#lvlup-track');
    if (track) {
      for (const n of nodes) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '6px 9px', borderRadius: '7px', background: '#2a2a3e',
          opacity: n.taken ? '.6' : '1',
        });
        row.innerHTML = `<div style="flex:1;">
          <div style="font-weight:600;">${n.name}</div>
          <div style="opacity:.6; font-size:12px;">${n.desc}</div></div>`;
        const btn = document.createElement('button');
        btn.id = 'lvlup-node-' + n.id;
        Object.assign(btn.style, BUTTON_CHROME, { padding: '5px 10px', borderRadius: '7px', fontSize: '12px' });
        if (n.taken) {
          btn.textContent = '✓ Taken';
        } else if (n.locked) {
          btn.textContent = 'Locked';
        } else if (!n.affordable) {
          btn.textContent = `Learn (${n.cost})`;
        } else {
          btn.textContent = `Learn (${n.cost})`;
          btn.onclick = () => { onLearn?.(n.id); render(); };
        }
        const actionable = !n.taken && !n.locked && n.affordable;
        btn.disabled = !actionable;
        btn.style.opacity = actionable ? '1' : '.45';
        btn.style.cursor = actionable ? 'pointer' : 'default';
        row.appendChild(btn);
        track.appendChild(row);
      }
    }
    host.querySelector('#lvlup-done').onclick = () => { host.remove(); onDone?.(); };
  }
  render();
  return { close: () => host.remove(), get open() { return !!document.getElementById('levelup-screen'); } };
}

// A read-only character sheet (toggle with C): attributes, the stats they
// derive, talent, and learned perks. main.js hands over a plain view-model
// (it owns the derived math); a "Spend points" button routes back to the
// level-up screen when points are banked.
const CHARSHEET_ATTRS = [['grit', 'Grit'], ['hustle', 'Hustle'], ['savvy', 'Savvy'], ['composure', 'Composure']];

export function createCharacterSheet({ onLevelUp } = {}) {
  const host = document.createElement('div');
  host.id = 'character-sheet';
  Object.assign(host.style, PANEL_CHROME, {
    position: 'fixed', right: '12px', top: '54px', zIndex: '24', display: 'none',
    width: '250px', maxHeight: '82vh', overflow: 'auto', borderRadius: '12px',
    padding: '15px 17px', userSelect: 'none', font: '13px system-ui, sans-serif',
  });
  host.onmousedown = (e) => e.stopPropagation();
  document.body.appendChild(host);

  const label = 'font-size:11px; letter-spacing:1px; opacity:.55; margin:12px 0 4px;';
  const row = (name, val) => `<div style="display:flex; justify-content:space-between; padding:1px 0;">
    <span style="opacity:.85;">${name}</span><b>${val}</b></div>`;

  function render(vm) {
    const pending = (vm.attrPoints || 0) + (vm.classPoints || 0);
    const xpPct = Math.max(0, Math.min(100, Math.round((vm.xp / vm.xpNext) * 100)));
    const attrRows = CHARSHEET_ATTRS.map(([k, l]) =>
      `<div style="display:flex; justify-content:space-between; padding:1px 0;">
        <span style="opacity:.85;">${l}</span><b id="charsheet-attr-${k}">${vm.attr[k] ?? 0}</b></div>`).join('');
    const perks = vm.perks.length
      ? vm.perks.map((n) => `<div style="opacity:.82;">• ${n}</div>`).join('')
      : '<div style="opacity:.45;">None yet</div>';
    host.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
        <div style="font-weight:700; color:#8adf76;">${vm.name}</div>
        <button id="charsheet-close" style="border:none; background:none; color:#aaa;
          font-size:15px; cursor:pointer; line-height:1;">✕</button></div>
      <div style="opacity:.7; font-size:12px; margin-bottom:8px;">${vm.className} · Level ${vm.level}</div>
      <div style="height:4px; background:#1a1a28; border-radius:2px;">
        <div style="height:100%; width:${xpPct}%; background:#6f87d8; border-radius:2px;"></div></div>
      <div style="opacity:.5; font-size:11px; margin-top:3px;">XP ${vm.xp}/${vm.xpNext}</div>
      <div style="${label}">ATTRIBUTES</div>${attrRows}
      <div style="${label}">DERIVED</div>
      ${row('HP', `${vm.hp}/${vm.maxHp}`)}${row('AP', vm.maxAp)}
      ${row('Damage bonus', `+${vm.damageBonus}`)}${row('Deflect', vm.deflect)}
      ${vm.talent ? `<div style="${label}">TALENT</div><div style="opacity:.85;">${vm.talent.name}</div>` : ''}
      <div style="${label}">PERKS</div>${perks}
      ${pending ? `<button id="charsheet-levelup" style="margin-top:12px; width:100%; padding:7px;
        border-radius:8px; border:1px solid #8adf76; background:#3a5a34; color:#eafbe6;
        font:inherit; font-weight:700; cursor:pointer;">⬆ Spend ${pending} point${pending === 1 ? '' : 's'}</button>` : ''}
      <div style="opacity:.4; font-size:11px; margin-top:10px;">Press C to close</div>`;
    host.querySelector('#charsheet-close').onclick = () => hide();
    const lu = host.querySelector('#charsheet-levelup');
    if (lu && onLevelUp) lu.onclick = () => { hide(); onLevelUp(); };
  }
  function hide() { host.style.display = 'none'; }
  function toggle(vm) {
    if (host.style.display !== 'none') { hide(); return; }
    render(vm);
    host.style.display = 'block';
  }
  return {
    toggle, hide,
    refresh(vm) { if (host.style.display !== 'none') render(vm); },
    get visible() { return host.style.display !== 'none'; },
  };
}

// --- dialogue -----------------------------------------------------------------
// The minimal talking layer: a bottom panel with the speaker's name, a line,
// and one button per response. Dumb by design - main.js owns the dialogue tree
// (data/npcs.js) and hands over a rendered view each step. Options carry an
// `action` the caller supplies (advance to the next node, or close).
export function createDialoguePanel() {
  const panel = document.createElement('div');
  panel.id = 'dialogue-panel';
  Object.assign(panel.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)',
    zIndex: '28', width: 'min(560px, 92vw)', display: 'none', borderRadius: '12px',
    padding: '16px 18px', userSelect: 'none',
  });
  panel.onmousedown = (e) => e.stopPropagation(); // clicks stay off the canvas
  document.body.appendChild(panel);

  function show({ name, text, options }) {
    panel.innerHTML = '';
    const nm = document.createElement('div');
    Object.assign(nm.style, { fontWeight: '700', letterSpacing: '1px', marginBottom: '6px', color: '#8adf76' });
    nm.textContent = name;
    panel.appendChild(nm);
    const tx = document.createElement('div');
    Object.assign(tx.style, { margin: '0 0 12px', lineHeight: '1.5' });
    tx.textContent = text;
    panel.appendChild(tx);
    const opts = document.createElement('div');
    Object.assign(opts.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'dialogue-option';
      b.id = 'dialogue-option-' + i;
      Object.assign(b.style, BUTTON_CHROME, { textAlign: 'left', padding: '8px 10px', borderRadius: '7px' });
      b.textContent = o.label;
      b.onclick = () => o.action();
      opts.appendChild(b);
    });
    panel.appendChild(opts);
    panel.style.display = 'block';
  }
  function hide() { panel.style.display = 'none'; panel.innerHTML = ''; }
  return { show, hide, get visible() { return panel.style.display !== 'none'; } };
}

// --- end-of-game overlays ----------------------------------------------------
function overlay(id, inner) {
  const div = document.createElement('div');
  div.id = id;
  Object.assign(div.style, {
    position: 'fixed', inset: '0', zIndex: '40', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10, 10, 18, 0.82)', color: '#f0f0f5',
    font: '15px system-ui, sans-serif', textAlign: 'center',
  });
  div.innerHTML = `
    <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
      padding:28px 40px; box-shadow:0 12px 40px rgba(0,0,0,.6);">${inner}</div>`;
  document.body.appendChild(div);
  return div;
}

const button = (id, label) =>
  `<button id="${id}" style="padding:10px 26px; border-radius:8px; border:1px solid #3a3a52;
    background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">${label}</button>`;

export function showWinScreen({ level, defeated }) {
  const div = overlay('win-screen', `
    <div style="font-size:26px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">YOU ESCAPED WORK</div>
    <div style="opacity:.85; margin-bottom:4px;">The parking garage has never smelled sweeter.</div>
    <div style="opacity:.7; margin-bottom:18px;">Level ${level} &middot; ${defeated} coworker${defeated === 1 ? '' : 's'} out-officed</div>
    ${button('again', 'Clock In Again')}`);
  div.querySelector('#again').onclick = () => location.reload();
}

export function showFloorClear({ nextName }, onNext) {
  const div = overlay('floor-clear', `
    <div style="font-size:24px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">FLOOR CLEAR</div>
    <div style="opacity:.85; margin-bottom:4px;">You take the stairs. Nobody takes the stairs. Smart.</div>
    <div style="opacity:.7; margin-bottom:18px;">Next: ${nextName}</div>
    ${button('next-floor', 'Keep Climbing')}`);
  div.querySelector('#next-floor').onclick = onNext;
}

export function showLoseScreen(message) {
  const div = overlay('lose-screen', `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">STUCK AT WORK</div>
    <div style="opacity:.85; margin-bottom:16px;">${message}</div>
    ${button('restart', 'Try Again')}`);
  div.querySelector('#restart').onclick = () => location.reload();
}

// --- class picker -------------------------------------------------------------
// A hiring-desk carousel: one resume at a time on the right, and the
// candidate themselves idling on the office floor to the left (main.js drives
// the 3D preview via onPreview). Arrows, dots, and arrow keys browse; the
// ACTIVE slide's hire button is #pick-<classId>, so muscle memory and tests
// address classes directly.
export function showClassPicker(classes, actions, onPick, onEditor, onPreview) {
  // Only playable careers reach the desk - archetypes like the summoned
  // applicant (playable: false) are units, not résumés (SUMMON_PLAN.md).
  const ids = Object.keys(classes).filter((id) => classes[id].playable !== false);
  let index = 0;

  const root = document.createElement('div');
  root.id = 'class-picker';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '40', pointerEvents: 'none',
    color: '#f0f0f5', font: '15px system-ui, sans-serif',
  });
  // Dim hardest under the resume so the candidate stays lit on the left.
  const dim = document.createElement('div');
  Object.assign(dim.style, {
    position: 'absolute', inset: '0',
    background: 'linear-gradient(90deg, rgba(8,8,16,.28) 0%, rgba(8,8,16,.22) 46%, rgba(8,8,16,.8) 74%)',
  });
  root.appendChild(dim);

  // The picker owns the top of the screen: the game's HUD banner steps aside
  // until a class is hired.
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';

  const title = document.createElement('div');
  Object.assign(title.style, { position: 'absolute', top: '26px', left: '0', right: '0', textAlign: 'center' });
  title.innerHTML = `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px;">CHOOSE YOUR CAREER MISTAKE</div>
    <div style="opacity:.8; margin-top:4px;">${ids.length} r&eacute;sum&eacute;s on the desk. You will be living one of them.</div>`;
  root.appendChild(title);

  // Bottom-anchored so the nav and hire buttons never move between slides -
  // a taller resume grows upward instead of shifting the controls.
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', right: 'min(6vw, 84px)', bottom: '46px',
    width: '308px', pointerEvents: 'auto', textAlign: 'center',
  });
  root.appendChild(panel);

  const section = (t) =>
    `<div style="font:700 10px system-ui, sans-serif; letter-spacing:2px; color:#8a8577;
      border-bottom:1px solid #d8d2c2; padding-bottom:2px; margin:10px 0 5px;">${t}</div>`;
  const resumeHtml = (id) => {
    const cls = classes[id];
    return `
      <div style="font-size:17px; font-weight:700; letter-spacing:.5px;">${cls.name}</div>
      <div style="font-size:11px; color:#8a8577; margin-top:2px;">Applying for: Former Employee</div>
      ${section('EXPERIENCE')}
      <div>${cls.experience}</div>
      ${section('SKILLS')}
      <div style="line-height:1.55;">
        ${cls.actions.map((a) => '&bull; ' + actions[a].label).join('<br>')}
      </div>
      ${section('TALENTS')}
      <div>${cls.talent ? `<b>${cls.talent.name}.</b> ${cls.talent.blurb}` : '&mdash;'}</div>
      <div style="position:absolute; top:10px; right:12px; font:700 9px system-ui, sans-serif;
        letter-spacing:1px; color:#b0392e; border:1px solid #b0392e; border-radius:2px;
        padding:2px 5px; transform:rotate(6deg); opacity:.85;">CONFIDENTIAL</div>`;
  };

  const card = document.createElement('div');
  card.id = 'resume-card';
  Object.assign(card.style, {
    textAlign: 'left', background: '#f6f3ea', border: '1px solid #d8d2c2', borderRadius: '3px',
    padding: '18px 16px 14px', color: '#2b2a26', font: "13px Georgia, 'Times New Roman', serif",
    boxShadow: '0 10px 30px rgba(0,0,0,.55)', position: 'relative',
    // Every resume gets the same sheet of paper - roomy enough that longer
    // future write-ups still won't shove the controls around.
    minHeight: '360px', boxSizing: 'border-box',
  });
  panel.appendChild(card);

  const nav = document.createElement('div');
  Object.assign(nav.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '12px', margin: '12px 0 10px',
  });
  const navBtn = (id, label) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, BUTTON_CHROME, { padding: '6px 14px', borderRadius: '7px', fontSize: '15px' });
    return b;
  };
  const prev = navBtn('carousel-prev', '‹');
  const next = navBtn('carousel-next', '›');
  const dots = document.createElement('div');
  dots.id = 'carousel-dots';
  Object.assign(dots.style, { display: 'flex', gap: '7px' });
  nav.append(prev, dots, next);
  panel.appendChild(nav);

  const hire = document.createElement('button');
  Object.assign(hire.style, BUTTON_CHROME, {
    width: '100%', padding: '11px', borderRadius: '8px', fontWeight: '700',
    letterSpacing: '1px', borderColor: '#5a8a4e', background: '#31452c', fontSize: '13px',
  });
  panel.appendChild(hire);

  if (onEditor) {
    const ed = document.createElement('button');
    ed.id = 'open-editor';
    ed.textContent = 'or open the level editor';
    Object.assign(ed.style, {
      background: 'none', border: 'none', color: '#8a8ac0', marginTop: '12px',
      font: '12px system-ui, sans-serif', cursor: 'pointer', textDecoration: 'underline',
    });
    ed.onclick = () => { cleanup(); onEditor(); };
    panel.appendChild(ed);
  }

  function render() {
    const id = ids[index];
    card.innerHTML = resumeHtml(id);
    dots.innerHTML = '';
    ids.forEach((_, i) => {
      const d = document.createElement('button');
      Object.assign(d.style, {
        width: '9px', height: '9px', borderRadius: '50%', border: 'none', padding: '0',
        cursor: 'pointer', background: i === index ? '#8adf76' : '#4a4a66',
      });
      d.onclick = () => { index = i; render(); };
      dots.appendChild(d);
    });
    hire.id = `pick-${id}`;
    hire.dataset.class = id;
    hire.textContent = `START AS ${classes[id].name.toUpperCase()}`;
    onPreview && onPreview(id);
  }
  const step = (d) => { index = (index + d + ids.length) % ids.length; render(); };
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  hire.onclick = () => { cleanup(); onPick(ids[index]); };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Enter') hire.onclick();
  };
  window.addEventListener('keydown', onKey);
  function cleanup() {
    window.removeEventListener('keydown', onKey);
    if (hud) hud.style.display = '';
    root.remove();
  }

  document.body.appendChild(root);
  render();
}

// Always-available corner menu (restart the run, open the editor) - the class
// picker is skipped mid-campaign, so these need a home that is always there.
// `hints` (optional) are non-clickable shortcut reminders tucked below the
// actions, so the HUD itself stays clean.
export function showGameMenu(items, hints = null) {
  const btn = document.createElement('button');
  btn.id = 'game-menu-btn';
  btn.textContent = '☰';
  Object.assign(btn.style, {
    position: 'fixed', top: '12px', left: '12px', zIndex: '25',
    background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
    borderRadius: '7px', padding: '6px 10px', font: '14px system-ui, sans-serif',
    cursor: 'pointer',
  });
  const menu = document.createElement('div');
  menu.id = 'game-menu';
  Object.assign(menu.style, {
    position: 'fixed', top: '46px', left: '12px', zIndex: '25', display: 'none',
    minWidth: '160px', background: '#232334', color: '#f0f0f5',
    border: '1px solid #3a3a52', borderRadius: '7px', padding: '5px',
    font: '13px system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
  });
  for (const it of items) {
    const row = document.createElement('div');
    row.id = it.id;
    row.textContent = it.label;
    Object.assign(row.style, { padding: '7px 11px', borderRadius: '5px', cursor: 'pointer' });
    row.onmouseenter = () => { row.style.background = '#34344f'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    row.onclick = () => { menu.style.display = 'none'; it.action(); };
    menu.appendChild(row);
  }
  // Shortcut reminders live here now, out of the HUD's way - a muted,
  // non-clickable block under a divider.
  if (hints && hints.length) {
    const divider = document.createElement('div');
    Object.assign(divider.style, { borderTop: '1px solid #3a3a52', margin: '5px 6px' });
    menu.appendChild(divider);
    const title = document.createElement('div');
    title.textContent = 'SHORTCUTS';
    Object.assign(title.style, {
      padding: '2px 11px 4px', font: '700 10px system-ui, sans-serif',
      letterSpacing: '1.5px', opacity: '.5',
    });
    menu.appendChild(title);
    for (const h of hints) {
      const row = document.createElement('div');
      row.textContent = h;
      Object.assign(row.style, {
        padding: '3px 11px', opacity: '.65', whiteSpace: 'nowrap', cursor: 'default',
      });
      menu.appendChild(row);
    }
  }
  btn.onclick = () => { menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; };
  window.addEventListener('mousedown', (e) => {
    if (e.target !== btn && !menu.contains(e.target)) menu.style.display = 'none';
  });
  document.body.appendChild(btn);
  document.body.appendChild(menu);
}

// Small corner badge shown while playtesting an editor level.
export function showPlaytestBadge(onBack) {
  const b = document.createElement('button');
  b.id = 'playtest-badge';
  b.textContent = '⏸ PLAYTEST — back to editor';
  Object.assign(b.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '25',
    background: '#3a2e46', color: '#e8d8f5', border: '1px solid #6a5a80',
    borderRadius: '7px', padding: '7px 11px', font: '12px system-ui, sans-serif',
    cursor: 'pointer',
  });
  b.onclick = onBack;
  document.body.appendChild(b);
}
