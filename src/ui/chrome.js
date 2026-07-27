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
  hudRail.push(btn);
  layoutHudRail();
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
window.addEventListener('resize', layoutHudRail);

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
