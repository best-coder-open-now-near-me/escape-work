// The combat READOUT: whose turn it is, the AP pips, the last line of
// narration, End Turn, and the initiative strip down the right-hand side.
//
// A dumb VIEW, like everything else in ui/ (ARCHITECTURE.md): it takes a
// host-supplied view-model, renders it, and reports clicks. It reads no rule.
// Every number and every label arrives already decided by combat.js - which is
// the point, because this was the last stretch of DOM combat.js built for
// itself, and while it lived there the panel was free to re-derive things the
// rules already knew.
//
// The readout is the dock's UPPER REGION, above the slot row - not a panel of
// its own. It carries no chrome and no position: chrome.js's actionDock owns
// the box. It was a second floating box at `bottom: 92px`, and the seam showed
// once the bar became shared: the verbs moved out to the bar and what was left
// was a turn line, a log line and one End Turn button in a 640px-wide panel, so
// the gap between the two boxes was exactly the shape of what had been removed
// from this one.
//
// The ids are unchanged - #combat-panel, #combat-turn, #combat-ap,
// #combat-log, #combat-actions, #combat-end-turn, #combat-strip. Moving a
// region is not a reason to rename what is in it, and the e2e suite reads them.

import { PANEL_CHROME, actionDock, refreshDockVisibility, esc } from './chrome.js';

// One initiative row. `s` is the slot's view-model:
//   { name, hp, dead, finished, current, holds, team, icons, portrait }
function initiativeRow(s, i) {
  const col = s.team === 'player' ? '#8adf76' : '#ffb3a0';
  // Each row leads with the combatant's own rendered face (portraits.js). It
  // rides the ACTOR, so it is there for members, summons and enemies alike, and
  // simply absent until the render lands.
  const pic = s.portrait
    ? `<img src="${esc(s.portrait)}" alt="" style="width:22px; height:22px; border-radius:4px;`
      + `border:1px solid ${col}; vertical-align:middle; margin-right:5px; flex:none;">`
    : '';
  // The bracket is a left edge + a faint wash, so a shared turn reads as one
  // block without a box fighting the panel chrome; a finished holder dims
  // toward the dead but keeps its wash - done, not gone.
  const brk = s.holds
    ? 'border-left:2px solid #8adf76; padding-left:4px; margin-left:-6px;'
      + 'background:rgba(138,223,118,.07);'
    : '';
  const opacity = s.dead ? '.4' : s.finished ? '.55' : '.95';
  return `<div data-slot="${i}" style="opacity:${opacity}; color:${col};`
    + `font-weight:${s.current ? '700' : '400'}; display:flex; align-items:center;`
    + `gap:2px; margin:1px 0; cursor:pointer; ${brk}">`
    + `<span style="width:11px; flex:none;">${s.current ? '▸' : s.finished ? '✓' : ''}</span>${pic}`
    + `<span>${esc(s.name)} &middot; ${s.dead ? '—' : s.hp}`
    + (s.icons ? ` ${s.icons}` : '') + '</span></div>';
}

export function createCombatReadout({ onEndTurn, onFocusSlot }) {
  const panel = document.createElement('div');
  panel.id = 'combat-panel';
  // No width of its own - it stretches to the dock, which is sized by the slot
  // row. Giving this region a 620px width made the dock wider than its contents
  // needed and pushed its right edge under the narrator box (fixed, right: 14px,
  // 360px wide), which is precisely where End Turn sits. The narrator is
  // pointer-events:none so the button still WORKED, which is the sort of bug
  // that survives a test suite and not a glance. `minWidth` is for the other
  // end: a one-slot bar must not squash the turn line into the AP pips.
  Object.assign(panel.style, {
    display: 'flex', flexDirection: 'column', gap: '6px',
    minWidth: '360px', padding: '2px 4px 8px',
    borderBottom: '1px solid #3a3a52',
  });
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div id="combat-turn" style="font-weight:700;"></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div id="combat-ap" style="letter-spacing:2px;"></div>
        <div id="combat-actions" style="display:flex; gap:7px;"></div>
      </div>
    </div>
    <div id="combat-log" style="opacity:.9; min-height:18px;"></div>`;
  // First child, so the readout sits above the slots however they were built.
  const dock = actionDock();
  dock.insertBefore(panel, dock.firstChild);
  refreshDockVisibility();

  const el = (id) => panel.querySelector('#' + id);

  // The panel keeps the End Turn button and nothing else - the verbs live on
  // the shared bar now (main.js's hotbar, in a fight and out of one).
  const endBtn = document.createElement('button');
  endBtn.id = 'combat-end-turn';
  endBtn.textContent = 'End Turn';
  Object.assign(endBtn.style, {
    minWidth: '90px', padding: '8px 10px', borderRadius: '7px',
    border: '1px solid #6a5a30', background: '#3d3524', color: '#f5e8c8',
    font: 'inherit', cursor: 'pointer',
  });
  endBtn.onclick = () => onEndTurn();
  const actionsRow = el('combat-actions');
  actionsRow.innerHTML = '';
  actionsRow.appendChild(endBtn);

  const strip = document.createElement('div');
  strip.id = 'combat-strip';
  Object.assign(strip.style, PANEL_CHROME, {
    position: 'fixed', top: '54px', right: '12px', zIndex: '25', minWidth: '170px',
    borderRadius: '9px', padding: '9px 12px', font: '12px system-ui, sans-serif',
    // Double-click is a verb here; without this it ALSO selects the row's text.
    userSelect: 'none',
  });
  strip.title = 'Double-click a combatant to center the camera on them';
  // Double-click a row: look at that combatant (BG3's portrait recenter).
  // Delegated once - `render` rebuilds the rows wholesale on every repaint, so
  // a per-row handler would be re-wired dozens of times a fight. The rig
  // belongs to main.js; the callback only names which slot to find. The fallen
  // still resolve (their actor lies where it toppled) - "where did they go
  // down" is a fair question mid-fight.
  strip.addEventListener('dblclick', (e) => {
    const row = e.target.closest?.('[data-slot]');
    if (row) onFocusSlot(Number(row.dataset.slot));
  });
  document.body.appendChild(strip);

  return {
    // The last line of narration, shown in the panel. The chat log is the
    // narrator's own (readouts.js) and combat writes there separately.
    say(text) { el('combat-log').textContent = text; },

    // `vm` is everything on screen, already decided:
    //   { turnLabel, apText, endLabel, endEnabled, order: [row, ...] }
    render(vm) {
      el('combat-turn').textContent = vm.turnLabel;
      el('combat-ap').textContent = vm.apText;
      endBtn.disabled = !vm.endEnabled;
      endBtn.textContent = vm.endLabel;
      strip.innerHTML = '<div style="font-weight:700; margin-bottom:5px;">INITIATIVE</div>'
        + vm.order.map(initiativeRow).join('');
    },

    destroy() {
      panel.remove();
      strip.remove();
      refreshDockVisibility();
    },
  };
}

// The AP readout, as a string: full pips, a half pip for the fraction
// distance-priced movement leaves behind, and the empties. The movement
// allowance rides beside them as its own boot glyph, and only for characters
// that have one - never advertise a resource a character does not own.
//
// Here rather than in combat.js because it is purely how the number LOOKS; the
// numbers themselves arrive already computed.
export function apPips({ ap, maxAp, text, freeText = '' }) {
  const full = Math.floor(ap + 1e-6);
  const half = ap - full >= 0.05 ? 1 : 0;
  return 'AP ' + '●'.repeat(full) + (half ? '◐' : '')
    + '○'.repeat(Math.max(0, maxAp - full - half)) + ` ${text}` + freeText;
}
