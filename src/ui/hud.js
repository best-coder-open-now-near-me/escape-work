// The persistent HUD: the things on screen while you play, as opposed to the
// panels you open (ui/panels.js) and the screens that take over (ui/screens.js).
// The bottom-left profile card and its status chips, the rail's tactical
// button, the always-on attack hotbar, the party bar and the level-up pip.
import { statusList } from '../statuses.js';
import { pendingPoints } from '../stats.js';
import { PANEL_CHROME, BUTTON_CHROME, HUD_BUTTON_CHROME, registerHudButton, layoutHudRail } from './chrome.js';

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
  // Any active status renders a chip generically (STATUS_PLAN): buffs green,
  // debuffs amber, remaining count trailing. Gum and bleed out of combat, plus
  // Deflect and the rest during a fight.
  return statusList(sheet).map((s) => ({ icon: s.icon, label: s.name, left: s.left, good: !s.harmful, sev: s.sev }));
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
    // One your Composure blunted (statuses.js severity) wears a dashed, dimmer
    // chip and says how much by. A defence the player cannot see is a defence
    // they will not spend a point on - and the narration line that reported the
    // shrug is four messages up the log by the time it matters.
    if (c.sev < 0.999) {
      chip.textContent += ` −${Math.round((1 - c.sev) * 100)}%`;
      chip.style.opacity = '0.78';
      chip.style.borderStyle = 'dashed';
    }
    el.appendChild(chip);
  }
}

// The bottom-left readout for whoever you're controlling. HP was a run of text
// among other text, which is no good as a thing you have to track under
// pressure - it is a real bar now, with XP as a thin rule beneath it, and it
// changes colour as you get hurt. `portrait` is an optional <canvas> the
// caller keeps updated (a live headshot); it is slotted in on the left.
// The portrait is STICKY: pass it when it changes (a new leader, or a portrait
// that just finished rendering) and omit it everywhere else. Without this,
// every incidental refresh - using an item, taking a hit - would have to know
// about portraits just to avoid blanking one.
let lastPortrait = null;
export function updateStatsHud(sheet, portraitUrl = undefined) {
  if (portraitUrl !== undefined) lastPortrait = portraitUrl || null;
  const el = document.getElementById('stats');
  if (!el || !sheet) return;
  const portrait = lastPortrait;
  const hpFrac = Math.max(0, Math.min(1, sheet.maxHp ? sheet.hp / sheet.maxHp : 0));
  const xpFrac = Math.max(0, Math.min(1, sheet.xpNext ? sheet.xp / sheet.xpNext : 0));
  // Green while healthy, amber under half, red when it is nearly over.
  const hpColor = hpFrac > 0.5 ? '#8adf76' : hpFrac > 0.25 ? '#ffd76b' : '#ff6b5e';
  // Banked points are easy to forget you have - the character sheet (C) is
  // where they're spent, so say so where you'll actually see it.
  const points = pendingPoints(sheet);
  el.innerHTML = `
    <span style="display:flex; align-items:center; gap:9px;">
      <span id="stats-portrait-slot" style="display:${portrait ? 'block' : 'none'};
        width:46px; height:46px; border-radius:8px; overflow:hidden;
        border:1px solid #3a3a52; background:#15151f; flex:none;">
        ${portrait ? `<img src="${portrait}" alt="" style="width:100%; height:100%; display:block;">` : ''}
      </span>
      <span style="display:block; min-width:172px;">
        <span style="display:flex; justify-content:space-between; font-size:12px; opacity:.85;">
          <b style="letter-spacing:.5px;">${sheet.name || ''}</b><span>Lv ${sheet.level}</span>
        </span>
        <span style="display:block; position:relative; height:13px; margin:3px 0 2px;
          background:#241f28; border:1px solid #3a3a52; border-radius:7px; overflow:hidden;">
          <span style="display:block; height:100%; width:${hpFrac * 100}%; background:${hpColor};
            transition:width .18s ease, background .18s ease;"></span>
          <span style="position:absolute; inset:0; display:flex; align-items:center;
            justify-content:center; font-size:10px; font-weight:700; letter-spacing:.4px;
            color:#12121c; text-shadow:0 1px 0 rgba(255,255,255,.25);">
            HP ${sheet.hp}/${sheet.maxHp}</span>
        </span>
        <span style="display:block; height:3px; background:#241f28; border-radius:2px; overflow:hidden;">
          <span style="display:block; height:100%; width:${xpFrac * 100}%; background:#6fa8ff;"></span>
        </span>
        ${points ? `<span style="display:block; margin-top:4px; font-size:11px; font-weight:700;
          color:#8adf76;">⬆ ${points} unspent point${points === 1 ? '' : 's'} — press C</span>` : ''}
      </span>
    </span>`;
  renderStatusEffects(sheet);
  layoutHudRail(); // the rail rides the card's right edge, whose width just changed
}

// The overhead tactical camera toggle - second slot on the rail, beside the
// bag. `isOn` is read back after every click so the lit state follows the
// camera even when something else drops out of the view (an orbit drag, the
// class carousel), rather than tracking a flag of its own that can drift.
export function createTacticalButton({ onToggle, isOn }) {
  const btn = document.createElement('button');
  btn.id = 'tactical-btn';
  btn.textContent = '⊹';
  Object.assign(btn.style, HUD_BUTTON_CHROME, { fontSize: '16px' });
  const paint = () => {
    const on = !!isOn();
    btn.style.borderColor = on ? '#8adf76' : '#3a3a52';
    btn.style.background = on ? '#2c3b2c' : '#232334';
    btn.title = on
      ? 'Tactical view: straight down, no foreshortening. Click to return (T)'
      : 'Tactical view: look straight down for precise moves (T)';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  btn.onclick = () => { onToggle(); paint(); };
  document.body.appendChild(btn);
  registerHudButton(btn);
  paint();
  return { refresh: paint, setVisible: (v) => { btn.style.display = v ? '' : 'none'; layoutHudRail(); } };
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
      const pending = pendingPoints(s);
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
