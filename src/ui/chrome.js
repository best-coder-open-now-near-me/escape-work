// The shared look, and the HUD rail everything bottom-left queues onto.
// Imported by every other ui/ module and by combat.js and the editor, which
// build their own DOM but must not look like a different game.
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

// The dock at the bottom of the screen: ONE panel, holding the action bar and -
// while a fight is on - the turn readout above it.
//
// They used to be two floating boxes, and the seam showed. The bar became
// shared across both halves of the game (combat stopped building its own), but
// the box combat had been drawing was left behind at `bottom: 92px` with its
// contents gutted: a 640px-wide panel whose bottom row held one 90px End Turn
// button, hovering over a second panel that held everything else. The dead
// space was the shape of the verbs that had moved out of it.
//
// So there is one box now, and the two things inside it are REGIONS rather than
// panels - they carry no chrome of their own. That also fixes the lifecycle
// hazard the two-box version had: the slot row is destroyed and rebuilt often
// (a leader switch, a learned power, an ammo count), and combat's readout is
// created and removed per fight, so neither can be a child of the other. The
// dock outlives both and is created on demand by whichever arrives first.
let dockEl = null;
const DOCK_EDGE_GAP = 10;
let dockLayoutBound = false;

// Keep the action dock centered when there is room, then nudge it into the
// live strip between the bottom-left profile card and bottom-right narrator.
// Both neighbours have content-driven widths, so a fixed left offset only
// trades one overlap for another as names, filters, or the viewport change.
export function layoutActionDock() {
  if (!dockEl?.isConnected || dockEl.style.display === 'none') return;
  const width = dockEl.getBoundingClientRect().width;
  if (!width) return;

  const dockRect = dockEl.getBoundingClientRect();
  const overlapsVertically = (rect) => rect.height
    && rect.bottom > dockRect.top && rect.top < dockRect.bottom;
  const stats = document.getElementById('stats')?.getBoundingClientRect();
  const narrator = document.getElementById('narration-box')?.getBoundingClientRect();
  const viewportRight = window.innerWidth - DOCK_EDGE_GAP;
  const minLeft = stats && overlapsVertically(stats)
    ? stats.right + DOCK_EDGE_GAP
    : DOCK_EDGE_GAP;
  const rightEdge = narrator && overlapsVertically(narrator)
    ? narrator.left - DOCK_EDGE_GAP
    : viewportRight;
  const maxLeft = Math.min(viewportRight - width, rightEdge - width);
  const centered = (window.innerWidth - width) / 2;

  // On very narrow screens the two neighbours can leave less room than the
  // dock needs. Preserve the actionable dock and narrator in that case; the
  // passive profile card is the safer surface to overlap.
  const left = maxLeft >= minLeft
    ? Math.min(Math.max(centered, minLeft), maxLeft)
    : Math.max(DOCK_EDGE_GAP, maxLeft);
  dockEl.style.left = `${Math.round(left)}px`;
  dockEl.style.transform = 'none';
}

export function actionDock() {
  if (dockEl && dockEl.isConnected) return dockEl;
  dockEl = document.createElement('div');
  dockEl.id = 'action-dock';
  Object.assign(dockEl.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
    zIndex: '22', display: 'none', flexDirection: 'column', alignItems: 'stretch',
    gap: '8px', padding: '8px 10px', borderRadius: '10px', userSelect: 'none',
  });
  document.body.appendChild(dockEl);
  if (!dockLayoutBound) {
    dockLayoutBound = true;
    window.addEventListener('resize', layoutActionDock);
  }
  return dockEl;
}
// Shown only when it has something to show. Both regions call this after they
// appear or leave, so an empty dock never sits on screen as a bare rectangle -
// which is what it would do at boot, where the bar is hidden until a run starts.
export function refreshDockVisibility() {
  if (!dockEl) return;
  const showing = [...dockEl.children].some((c) => c.style.display !== 'none');
  dockEl.style.display = showing ? 'flex' : 'none';
  if (showing) layoutActionDock();
}

// --- the HUD rail -------------------------------------------------------------
// The row of square buttons that sits immediately right of the bottom-left
// profile card: the pockets bag, the tactical camera, whatever comes next. They
// queue left to right off the CARD's live right edge, because that edge moves
// with the character's name and the unspent-points line - so every stats
// repaint (and every resize) re-seats the whole rail rather than leaving a
// button overlapping the card or stranded in a gap beside it.
const HUD_RAIL_GAP = 8;
const hudRail = []; // buttons, in the order they were registered
export const railHooks = []; // extra layout passes (the pockets panel rides the rail)

export const HUD_BUTTON_CHROME = {
  position: 'fixed', left: '12px', bottom: '14px', zIndex: '25',
  background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
  borderRadius: '7px', padding: '6px 10px', font: '14px system-ui, sans-serif',
  cursor: 'pointer', lineHeight: '1',
};

export function registerHudButton(btn) {
  bindRailLayout();
  hudRail.push(btn);
  layoutHudRail();
}

// The rail re-lays itself on resize. Bound on FIRST USE rather than at module
// scope, because `window.addEventListener(...)` running at import time is what
// kept this module - and everything downstream of it - out of node.
//
// `ui.js` is the barrel every UI consumer imports, so one import-time throw
// cascaded to the whole `ui/` layer AND to doors.js, dialogue.js and
// shopping.js: the three modules TODO.md Phase 5 holds up as successfully
// carved onto host-callback seams, none of which could be unit-tested
// (REVIEW.md 2026-08-02 section 4). Same lazy treatment `actionDock` already
// gives its own `createElement`.
let railBound = false;
function bindRailLayout() {
  if (railBound || typeof window === 'undefined') return;
  railBound = true;
  window.addEventListener('resize', layoutHudRail);
}
export function layoutHudRail() {
  const r = document.getElementById('stats')?.getBoundingClientRect();
  // No card yet (pre-class-pick) - fall back to the margin the card itself
  // uses, so a button never lands in the middle of nowhere.
  let x = r && r.width ? r.right + HUD_RAIL_GAP : 12;
  const bottom = r && r.height ? Math.round(window.innerHeight - r.bottom) : 14;
  for (const b of hudRail) {
    if (b.style.display === 'none') continue;
    b.style.left = `${Math.round(x)}px`;
    b.style.bottom = `${bottom}px`;
    x += b.offsetWidth + HUD_RAIL_GAP;
  }
  for (const hook of railHooks) hook(r, bottom);
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

// Escape a value before it is interpolated into an `innerHTML` template.
//
// It lives HERE, not in screens.js where it started, because every `ui/` module
// imports chrome.js and none of them could reach it there - so the rule held on
// the résumé and the level-up card and nowhere else, while a player-typed name
// went in raw on four other surfaces (REVIEW.md, still open at the 2026-08-02
// pass). `cleanName` only collapses whitespace and clamps length, so
// `<svg onload=...>` fits inside NAME_MAX and survives to the HUD intact.
//
// Escaping at the INTERPOLATION site means the rule holds wherever the string
// came from - which now includes a shared cloud store, not just this keyboard.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
