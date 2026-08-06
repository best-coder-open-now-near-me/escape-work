// The persistent HUD: the things on screen while you play, as opposed to the
// panels you open (ui/panels.js) and the screens that take over (ui/screens.js).
// The bottom-left profile card and its status chips, the rail's tactical
// button, the always-on attack hotbar, the party bar and the level-up pip.
import { statusList } from '../statuses.js';
import { pendingPoints, fmtAp } from '../stats.js';
import {
  PANEL_CHROME, BUTTON_CHROME, HUD_BUTTON_CHROME, registerHudButton, layoutHudRail,
  actionDock, refreshDockVisibility, esc,
} from './chrome.js';

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
    chip.textContent = `${c.icon} ${c.label} ·${c.left}`;
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
// How full an HP bar is: clamped to 0..1, and guarded against a maxHp of 0.
//
// The profile card did both of these and the party bar did neither, two hundred
// lines apart. Overheal (a revive item that heals past max, a buff that raises
// maxHp after the fact) drew a bar wider than its track; a sheet with maxHp 0 -
// which is what a half-built or wiped sheet looks like for one frame - divided
// by zero and drew `NaN%`, and the browser silently keeps the previous width, so
// the bar freezes at whatever it last showed rather than looking broken.
const hpFracOf = (s) => Math.max(0, Math.min(1, s?.maxHp ? s.hp / s.maxHp : 0));

export function updateStatsHud(sheet, portraitUrl = undefined) {
  if (portraitUrl !== undefined) lastPortrait = portraitUrl || null;
  const el = document.getElementById('stats');
  if (!el || !sheet) return;
  const portrait = lastPortrait;
  const hpFrac = hpFracOf(sheet);
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
          <b style="letter-spacing:.5px;">${esc(sheet.name)}</b><span>Lv ${sheet.level}</span>
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
  // No setVisible: the rail button is up whenever the HUD is, and the one it
  // used to offer had no caller (Q178). Add it back beside a caller, not ahead
  // of one - an untested show/hide that also re-runs layoutHudRail is exactly
  // the sort of thing that works until the first time it is used.
  return { refresh: paint };
}

// --- persistent action hotbar -------------------------------------------------
// Always-on out-of-combat action bar: the player's WHOLE kit, so the character
// you picked is legible without a fight running. Arming a slot and clicking a
// coworker opens combat with that move; a summon posts where you click (main.js
// wires the arming + targeting). Ids are `#hotbar-act-<id>` - deliberately NOT
// the combat bar's `#act-<id>`, so the two never collide in the DOM or tests.
//
// It is an ICON GRID, not a row of named buttons. Spelled out in words a full
// kit ran ~900px wide: the leftmost slots sat UNDER the bottom-left HUD rail and
// could not be clicked at all (the bag button ate them), and the right end slid
// beneath the narrator box. Square slots fit between the two with the name in
// the tooltip - and they are what a hotbar looks like in the games this one is
// borrowing from. `unavailable` is why a slot can't act with no fight on
// (Deflect Blame, a heal): it dims the slot and titles it with the reason, but
// leaves it CLICKABLE - the host answers a press with that reason, and a listed
// power you can ask about beats a power that isn't there. Resource exhaustion
// is exposed through aria-disabled but remains mouse-addressable, so the slot
// can explain itself and still be right-clicked for reassignment.
// Slots per ROW. The bar holds one row at a time and pages through the rest,
// which is what lets a kit grow - perks, a talent, a weapon swing, whatever the
// player assigns - without the row growing until it spans the screen and the
// number keys stop lining up with it.
//
// Ten, because every class's whole kit fits in ten today - nine actions
// since Pull Over joined Shove and Take Cover as the third universal cover
// verb (TACTICS_PLAN M8, designer: "all cover related moves are universal"),
// plus the deliberate empty slot: a row that pages what a character ALREADY
// HAS would hide the weapon swing behind a pager on a fresh Office Drone,
// which is a worse trade than an unused pager. Rows arrive when the player
// builds past one (the host pads the layout with an empty slot so there is
// always somewhere to assign to - see main.js layoutOf). Ten is the hard
// ceiling the NUMBER KEYS can address (1-9, then 0 for the tenth) - the row
// genuinely cannot widen again, so the NEXT universal verb has to earn its
// slot by retiring one.
export const HOTBAR_ROW_SLOTS = 10;

// `slots` is the whole layout, in order, as view-models the host builds:
//   { kind: 'action', id, label, icon, ap, ammoCost, ammoRemaining,
//     affordable, resourceAvailable, unavailable }
//   { kind: 'item', id, label, icon, count, affordable, resourceAvailable }
//   null                                   an empty slot, right-clickable
// The bar shows HOTBAR_ROW_SLOTS of them at a time; `startRow` restores which
// row was showing across a rebuild. onPress(i) is a left click on slot i (the
// host decides what pressing one means - arm a power, drink the coffee),
// onAssign(i, x, y) a right click on it, at the cursor.
export function createHotbar(slots, { onPress, onAssign, startRow = 0 }) {
  // A REGION of the dock, not a panel of its own: the dock owns the chrome, the
  // position and the bottom of the screen (ui/chrome.js actionDock). This is
  // just the row of slots and its pager.
  const bar = document.createElement('div');
  bar.id = 'hotbar';
  Object.assign(bar.style, {
    display: 'none', gap: '7px', userSelect: 'none', alignItems: 'center',
    justifyContent: 'center',
  });
  actionDock().appendChild(bar);

  const rowCount = Math.max(1, Math.ceil(slots.length / HOTBAR_ROW_SLOTS));
  let row = Math.min(Math.max(0, startRow), rowCount - 1);
  const rowOf = (i) => Math.floor(i / HOTBAR_ROW_SLOTS);

  // The pager: one step per click, wrapping, so a two-row bar toggles. Hidden
  // outright at one row - a control that can only do nothing is noise.
  const pagerBtn = (glyph, step, id) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = glyph;
    Object.assign(b.style, BUTTON_CHROME, { padding: '7px 9px', borderRadius: '7px', minWidth: '0' });
    b.onmousedown = (e) => e.stopPropagation();
    b.onclick = () => flip(step);
    return b;
  };
  const prev = pagerBtn('‹', -1, 'hotbar-prev');
  const next = pagerBtn('›', 1, 'hotbar-next');
  const slotsRow = document.createElement('div');
  // 6px, not 7: the row of ten (TACTICS_PLAN M8) has to clear the narrator
  // box on a 1280 viewport - the dock is centred, the narrator right-anchored,
  // and the combat-bar spec MEASURES the gap. Slot size below shrank with it.
  Object.assign(slotsRow.style, { display: 'flex', gap: '6px' });
  const pageTag = document.createElement('div');
  pageTag.id = 'hotbar-page';
  Object.assign(pageTag.style, { font: '11px system-ui, sans-serif', opacity: '.6', minWidth: '26px', textAlign: 'center' });
  bar.append(prev, slotsRow, next, pageTag);
  // The wheel over the bar pages it - the gesture everyone tries first. Stopped
  // here so it never reaches the canvas and zooms the camera instead.
  bar.onwheel = (e) => { e.preventDefault(); e.stopPropagation(); flip(e.deltaY > 0 ? 1 : -1); };

  const buttons = slots.map((slot, i) => {
    const b = document.createElement('button');
    // Named for WHAT IS IN the slot, so `#hotbar-act-<id>` still means "that
    // power is on the bar" wherever it sits; a positional id names an empty one.
    b.id = slot?.kind === 'action' ? `hotbar-act-${slot.id}`
      : slot?.kind === 'item' ? `hotbar-item-${slot.id}`
        : `hotbar-slot-${i}`;
    if (slot) b.dataset.action = slot.id;
    b.dataset.slot = String(i);
    Object.assign(b.style, BUTTON_CHROME, {
      // 44px squares: ten of them plus gaps must not run under the narrator
      // box (see the slot-row gap note above).
      position: 'relative', width: '44px', height: '44px', padding: '0',
      borderRadius: '8px', font: '20px system-ui, sans-serif', lineHeight: '1',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    });
    // The key that presses this slot, small in the corner - the number is how
    // the row is addressed, so it belongs ON the slot rather than in the label.
    const keyTag = document.createElement('span');
    Object.assign(keyTag.style, {
      position: 'absolute', top: '2px', left: '4px', font: '9px system-ui, sans-serif',
      opacity: '.55', pointerEvents: 'none',
    });
    // How many are left, for a slot holding something spendable.
    const countTag = document.createElement('span');
    Object.assign(countTag.style, {
      position: 'absolute', bottom: '1px', right: '3px', font: '700 10px system-ui, sans-serif',
      opacity: '.85', pointerEvents: 'none',
    });
    const face = document.createElement('span');
    face.style.pointerEvents = 'none';
    b.append(keyTag, face, countTag);
    b.onmousedown = (e) => e.stopPropagation(); // don't let the canvas see it
    b.onclick = () => onPress(i);
    b.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onAssign(i, e.clientX, e.clientY); };
    slotsRow.appendChild(b);
    return { b, slot, keyTag, countTag, face };
  });

  // Dim a slot WITHOUT the `disabled` property. A disabled button dispatches no
  // mouse events at all in any browser, contextmenu included - so the slot you
  // most want to reassign, the one holding something you have run out of, was
  // the one slot you could not reassign. That also contradicted the bar's own
  // rule (see the note above the layout): an unusable slot stays clickable and
  // ANSWERS, because a power you can ask about beats a power that isn't there.
  // The view-model and press path share the same availability owner.
  const setInert = (b, inert) => {
    b.disabled = false;
    b.setAttribute('aria-disabled', inert ? 'true' : 'false');
  };

  let armed = null;
  function render() {
    const many = rowCount > 1;
    prev.style.display = many ? '' : 'none';
    next.style.display = many ? '' : 'none';
    pageTag.style.display = many ? '' : 'none';
    pageTag.textContent = `${row + 1}/${rowCount}`;
    buttons.forEach(({ b, slot, keyTag, countTag, face }, i) => {
      b.style.display = rowOf(i) === row ? '' : 'none';
      const key = (i % HOTBAR_ROW_SLOTS) + 1;
      keyTag.textContent = String(key % 10); // the tenth slot answers to '0'
      countTag.textContent = '';
      if (!slot) {
        face.textContent = '—';
        setInert(b, false); // empty, but it is the slot you right-click to fill
        b.style.opacity = '.32';
        b.title = 'Empty slot - right-click to assign a power or an item';
        b.style.borderColor = '#3a3a52';
        return;
      }
      if (slot.kind === 'item') {
        const count = slot.count ?? 0;
        face.textContent = slot.icon || '❔';
        countTag.textContent = count > 1 ? `×${count}` : '';
        setInert(b, !slot.resourceAvailable);
        b.dataset.affordable = slot.affordable ? 'true' : 'false';
        b.style.opacity = slot.affordable ? '1' : '.4';
        b.title = count > 0
          ? `${slot.label} ×${count} · from your pockets · right-click to reassign`
          : `${slot.label} · none left`;
        b.style.borderColor = '#3a3a52';
        return;
      }
      face.textContent = slot.icon || '❔';
      // What the slot is counting down. A per-fight power counts its remaining
      // uses (combat supplies them); a throw counts the sheets it has to spend,
      // where an item counts itself.
      if (slot.uses != null) countTag.textContent = String(slot.uses);
      else if (slot.ammoCost) countTag.textContent = String(slot.ammoRemaining ?? 0);
      // Armed, or awaiting its confirm click. Either way the slot stays live
      // however unaffordable it has become - that press is the way to lower it.
      const live = slot.live || (slot.id === armed ? 'armed' : null);
      const usable = slot.affordable || !!live;
      // `aria-disabled` stays exactly what it always meant: there is nothing
      // left to spend. It must NOT be made to track affordability, because an
      // unusable slot deliberately stays PRESSABLE and answers (see setInert),
      // and drivers treat aria-disabled as not-clickable - which would take
      // that away silently, including the right-click that reassigns it.
      setInert(b, !slot.resourceAvailable);
      // So "can this be pressed right now" gets its own signal instead: it
      // dims the slot and tells the suite what to wait on, without ever
      // blocking the click that would explain the refusal.
      b.dataset.affordable = usable ? 'true' : 'false';
      b.style.opacity = usable ? '1' : '.4';
      // In a fight the tip comes from combat (damage, range, uses left against
      // THIS member's sheet); out of one the bar writes its own.
      b.title = slot.tip || (slot.unavailable
        ? `${slot.label} · ${slot.ap}AP · ${slot.unavailable}`
        : `${slot.label} · ${slot.ap}AP · right-click to reassign`);
      // The live one pulses - a static border was too easy to miss mid-fight.
      b.style.borderColor = live ? (live === 'confirm' ? '#ffd76b' : '#8adf76') : '#3a3a52';
      b.style.animation = live ? 'act-pulse 1.1s ease-in-out infinite' : '';
    });
  }
  function flip(step) {
    if (rowCount < 2) return;
    row = (row + step + rowCount) % rowCount;
    render();
  }
  render();

  return {
    // Called every frame from the update loop, so it only touches the DOM when
    // the answer actually changed - the dock's visibility walks its children,
    // and that is not something to do sixty times a second to learn nothing.
    setVisible: (v) => {
      const want = v ? 'flex' : 'none';
      if (bar.style.display === want) return;
      bar.style.display = want;
      refreshDockVisibility();
    },
    setArmed: (id) => { armed = id; render(); },
    flip,
    get armed() { return armed; },
    get row() { return row; },
    get rowCount() { return rowCount; },
    // The layout index the number key `n` presses right now - the keys address
    // the VISIBLE row, so 1 is always the leftmost button you can see.
    indexAtKey: (n) => {
      const i = row * HOTBAR_ROW_SLOTS + (n - 1);
      return n >= 1 && n <= HOTBAR_ROW_SLOTS && i < slots.length ? i : -1;
    },
    get visible() { return bar.style.display !== 'none'; },
    // Leader switches rebuild the bar wholesale. Only this REGION goes - the
    // dock (and combat's readout in it) is not ours to take down.
    destroy: () => { bar.remove(); refreshDockVisibility(); },
  };
}
// --- party bar ----------------------------------------------------------------
// The roster, top-left: one slot per member (#party-slot-<i> for the tests)
// with name, an HP bar, a DOWN marker, and a highlight on the member being
// controlled. Clicking a slot asks the host to switch control - the host
// decides whether that's allowed right now (combat, dialogue, downed).
// Double-clicking asks the host to point the CAMERA at that member - a
// separate verb, because a member you can't switch to (downed, waiting on
// their own initiative slot) is still somewhere worth looking.

export function createPartyBar({ onSelect, onLevelUp, onFocus }) {
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
      // Movement bills fractional AP, and float subtraction leaves dust
      // (2.8 - 2 is 0.7999999999999998). Round at the display as well as at
      // the spend sites, so no future raw write can leak a tail of nines onto
      // the party bar.
      const ap = combatInfo && !down ? ` · ${fmtAp(combatInfo[i]?.ap ?? 0)}AP` : '';
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
          <span style="font-weight:${i === party.active ? '700' : '400'};">${esc(s.name)}</span>
          <span style="opacity:.8">${down ? 'DOWN' : `${s.hp}/${s.maxHp}${ap}`}</span>
        </div>
        <div style="height:4px; margin-top:4px; background:#1a1a28; border-radius:2px;">
          <div style="height:100%; width:${Math.round(hpFracOf(s) * 100)}%;
            background:${down ? '#5a2a2a' : hpFracOf(s) > 0.4 ? '#6fc86f' : '#e0b23a'}; border-radius:2px;"></div>
        </div>`;
      slot.onclick = () => onSelect(i);
      if (onFocus) {
        slot.ondblclick = () => onFocus(i);
        slot.title = `Double-click to center the camera on ${s.name}`;
      }
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
  // `refresh` is called from main.js's per-frame update, not from a level-up
  // event, so it has to be cheap when nothing has changed - which is almost
  // always. The memo is the whole point; without it this writes textContent and
  // a style property sixty times a second for as long as a point sits banked.
  let shown = null; // the count currently painted; null = nothing painted yet
  return {
    refresh(points) {
      if (points === shown) return;
      shown = points;
      if (points > 0) { b.textContent = `⬆ Level Up (${points})`; b.style.display = 'block'; }
      else b.style.display = 'none';
    },
    // No setVisible. It existed to hide the pip behind the memo's back, and it
    // never had a caller (Q178) - because main.js hides the pip the honest way
    // instead, folding `!modalOpen()` into the count it passes to refresh(),
    // which drives `shown` rather than going around it. Two ways to hide one
    // pip, and only one of them keeps the memo true.
  };
}
// Modal allocation belongs to screens.js; this module ends with HUD affordances.
