// All DOM-facing UI: the HUD lines, the right-click context menu, and the
// win/lose overlays. Nothing in here knows about PlayCanvas.

export function say(text) {
  const el = document.getElementById('subtitle');
  if (el) el.textContent = text;
}

export function updateStatsHud(sheet) {
  const el = document.getElementById('stats');
  if (el) el.textContent = `Lv ${sheet.level} · HP ${sheet.hp}/${sheet.maxHp} · XP ${sheet.xp}/${sheet.xpNext}`;
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

export function showLoseScreen(message) {
  const div = overlay('lose-screen', `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">STUCK AT WORK</div>
    <div style="opacity:.85; margin-bottom:16px;">${message}</div>
    ${button('restart', 'Try Again')}`);
  div.querySelector('#restart').onclick = () => location.reload();
}

// --- class picker -------------------------------------------------------------
// Shown once at boot, styled as a stack of resumes on the hiring desk. Cards
// are generated from the class registry plus the action registry, so new
// classes appear here automatically.
export function showClassPicker(classes, actions, onPick, onEditor) {
  const section = (title) =>
    `<div style="font:700 10px system-ui, sans-serif; letter-spacing:2px; color:#8a8577;
      border-bottom:1px solid #d8d2c2; padding-bottom:2px; margin:10px 0 5px;">${title}</div>`;
  const cards = Object.entries(classes).map(([id, cls]) => `
    <button id="pick-${id}" data-class="${id}" style="flex:1; min-width:210px; max-width:240px;
      text-align:left; background:#f6f3ea; border:1px solid #d8d2c2; border-radius:3px;
      padding:18px 16px 14px; color:#2b2a26; font:13px Georgia, 'Times New Roman', serif;
      cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,.45); position:relative;">
      <div style="font-size:17px; font-weight:700; letter-spacing:.5px;">${cls.name}</div>
      <div style="font-size:11px; color:#8a8577; margin-top:2px;">Applying for: Former Employee</div>
      ${section('OBJECTIVE')}
      <div style="font-style:italic; min-height:44px;">${cls.objective}</div>
      ${section('EXPERIENCE')}
      <div style="min-height:34px;">${cls.experience}</div>
      ${section('SKILLS')}
      <div style="line-height:1.55;">
        ${cls.actions.map((a) => '&bull; ' + actions[a].label).join('<br>')}
      </div>
      ${section('BENEFITS BALANCE')}
      <div>Sick days remaining: <b>${cls.maxHp}</b></div>
      <div style="position:absolute; top:10px; right:12px; font:700 9px system-ui, sans-serif;
        letter-spacing:1px; color:#b0392e; border:1px solid #b0392e; border-radius:2px;
        padding:2px 5px; transform:rotate(6deg); opacity:.85;">CONFIDENTIAL</div>
    </button>`).join('');
  const div = overlay('class-picker', `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px; margin-bottom:6px;">CHOOSE YOUR CAREER MISTAKE</div>
    <div style="opacity:.8; margin-bottom:18px;">Three r&eacute;sum&eacute;s on the desk. You will be living one of them.</div>
    <div style="display:flex; gap:14px; flex-wrap:wrap; justify-content:center; max-width:800px;">${cards}</div>
    ${onEditor ? `<div style="margin-top:16px;"><button id="open-editor" style="background:none; border:none;
      color:#8a8ac0; font:12px system-ui, sans-serif; cursor:pointer; text-decoration:underline;">
      or open the level editor</button></div>` : ''}`);
  for (const card of div.querySelectorAll('button[data-class]')) {
    card.onmouseenter = () => { card.style.boxShadow = '0 10px 26px rgba(0,0,0,.6)'; card.style.transform = 'translateY(-3px)'; };
    card.onmouseleave = () => { card.style.boxShadow = '0 6px 18px rgba(0,0,0,.45)'; card.style.transform = 'none'; };
    card.onclick = () => { div.remove(); onPick(card.dataset.class); };
  }
  if (onEditor) div.querySelector('#open-editor').onclick = () => { div.remove(); onEditor(); };
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
