// Things that appear AT the cursor and are clicked through: the right-click
// context menu, and the Alt-held loot labels floating over everything nearby.
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
      // A label can name several things on one tile (looting.js groups a pile
      // into one entry), so it is a LIST: the first line is the headline, the
      // rest are the other items under it.
      chip.textContent = `${en.icon || '📦'} ${en.text}`;
      for (const extra of en.also || []) {
        const line = document.createElement('div');
        line.textContent = extra;
        Object.assign(line.style, { opacity: '.75', fontSize: '11px' });
        chip.appendChild(line);
      }
      Object.assign(chip.style, {
        // Floated well clear of the thing it names (-170% instead of sitting on
        // it) so the item, body or container underneath stays visible, and
        // translucent for the same reason - a solid chip on a floor tile hid
        // exactly the loot it was advertising. Hovering makes it solid again.
        position: 'absolute', transform: 'translate(-50%, -170%)', whiteSpace: 'nowrap',
        background: 'rgba(22,22,36,.58)', border: '1px solid rgba(120,120,160,.55)',
        borderRadius: '6px', opacity: '.85',
        padding: '3px 9px', color: '#f0f0f5', font: '12px system-ui, sans-serif',
        textShadow: '0 1px 2px rgba(0,0,0,.9)', // legible over any carpet
        cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none', display: 'none',
        transition: 'opacity .1s linear, background .1s linear',
      });
      chip.onmouseenter = () => {
        chip.style.borderColor = '#8adf76';
        chip.style.background = 'rgba(22,22,36,.95)';
        chip.style.opacity = '1';
      };
      chip.onmouseleave = () => {
        chip.style.borderColor = 'rgba(120,120,160,.55)';
        chip.style.background = 'rgba(22,22,36,.58)';
        chip.style.opacity = '.85';
      };
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
