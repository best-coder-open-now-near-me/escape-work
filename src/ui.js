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
// Shown once at boot. Cards are generated from the class registry plus the
// action registry, so new classes appear here automatically.
export function showClassPicker(classes, actions, onPick) {
  const cards = Object.entries(classes).map(([id, cls]) => `
    <button id="pick-${id}" data-class="${id}" style="flex:1; min-width:190px; text-align:left;
      background:#2a2a40; border:1px solid #3a3a52; border-radius:10px; padding:16px;
      color:#f0f0f5; font:inherit; cursor:pointer;">
      <div style="font-size:16px; font-weight:700; margin-bottom:6px;">${cls.name}</div>
      <div style="opacity:.75; min-height:44px; margin-bottom:10px;">${cls.tagline}</div>
      <div style="opacity:.9; font-size:12px;">HP ${cls.maxHp}</div>
      <div style="opacity:.65; font-size:12px; margin-top:4px;">
        ${cls.actions.map((a) => actions[a].label).join(' · ')}
      </div>
    </button>`).join('');
  const div = overlay('class-picker', `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px; margin-bottom:6px;">CHOOSE YOUR CAREER MISTAKE</div>
    <div style="opacity:.8; margin-bottom:18px;">Every escape starts with a bad job title.</div>
    <div style="display:flex; gap:12px; flex-wrap:wrap; max-width:680px;">${cards}</div>`);
  for (const card of div.querySelectorAll('button[data-class]')) {
    card.onmouseenter = () => { card.style.borderColor = '#7a7ab8'; };
    card.onmouseleave = () => { card.style.borderColor = '#3a3a52'; };
    card.onclick = () => { div.remove(); onPick(card.dataset.class); };
  }
}
