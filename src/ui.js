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
}

export function updateStatsHud(sheet) {
  const el = document.getElementById('stats');
  if (!el) return;
  let text = `Lv ${sheet.level} · HP ${sheet.hp}/${sheet.maxHp} · XP ${sheet.xp}/${sheet.xpNext}`;
  if (sheet.gum > 0) text += ' · gum on shoe';
  el.textContent = text;
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
  const ids = Object.keys(classes);
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

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', right: 'min(6vw, 84px)', top: '50%', transform: 'translateY(-50%)',
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
      ${section('OBJECTIVE')}
      <div style="font-style:italic;">${cls.objective}</div>
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
export function showGameMenu(items) {
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
