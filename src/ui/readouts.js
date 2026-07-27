// The passive readouts: things the game SAYS, with nothing to click. The
// narrator box, the focus banner naming whatever the cursor is over, and the
// loot toast. All of them are pointer-events:none by design - narration must
// never be able to swallow a click meant for the world.
export function say(text) {
  const el = document.getElementById('subtitle');
  if (el) el.textContent = text;
  narrate(text);
}

// --- narrator box (Divinity / BG3 style general narration) --------------------
// General narration surfaces in a dialogue-style box near the bottom, like the
// narrator in Divinity/BG3 - the top #subtitle is display:none, so this box is
// the ONLY place say() is visible. It is purely cosmetic: pointer-events pass
// through so play never stalls.
//
// It used to auto-fade after ~5s, replace its text on every line, and be
// gated off entirely during combat - which meant every examine description
// during a fight went nowhere at all, and out of combat you had five seconds
// to read one. Now it is always on screen once a class is in play and it
// ACCUMULATES: new lines append, the oldest scroll off, and the box holds the
// last NARRATION_KEEP lines so you can read back what just happened.
const NARRATION_KEEP = 8;
let narratorEl = null;
let narrationOk = false;
const narrationLines = [];

function ensureNarrator() {
  if (narratorEl) return narratorEl;
  narratorEl = document.createElement('div');
  narratorEl.id = 'narration-box';
  Object.assign(narratorEl.style, {
    position: 'fixed', right: '14px', bottom: '20px',
    zIndex: '27', width: 'min(360px, 46vw)', maxHeight: '30vh', boxSizing: 'border-box',
    pointerEvents: 'none', textAlign: 'left', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4px',
    background: 'rgba(18,18,30,.9)', border: '1px solid #3a3a52', borderRadius: '12px',
    padding: '11px 16px', color: '#e9e7f2',
    font: 'italic 14px Georgia, "Times New Roman", serif', lineHeight: '1.45',
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    opacity: '0', transition: 'opacity .2s ease',
  });
  document.body.appendChild(narratorEl);
  return narratorEl;
}

// main.js flips this each frame: the box lives whenever a class is in play.
// It deliberately STAYS UP during combat and conversations now - combat has
// its own log, but examine text and incidental narration were going nowhere
// while a fight or a dialogue was open.
export function setNarrationGate(ok) {
  narrationOk = ok;
  if (!narratorEl) return;
  narratorEl.style.opacity = ok && narrationLines.length ? '1' : '0';
}

// Append a line and re-render. The newest sits at the bottom, like a chat log.
//
// A line identical to the one above it does NOT get swallowed. It used to:
// repeats returned early as "no stutter", which meant examining the same desk
// twice in a row printed nothing the second time and read as a dead button -
// the one case where the player is deliberately asking again. Instead the
// repeat stays a single row carrying a count, and the row flashes, so asking
// twice looks like asking twice rather than like nothing happening.
function narrate(text) {
  if (!text) return;
  const line = String(text);
  const last = narrationLines[narrationLines.length - 1];
  if (last && last.text === line) last.count += 1;
  else {
    narrationLines.push({ text: line, count: 1 });
    while (narrationLines.length > NARRATION_KEEP) narrationLines.shift();
  }
  const el = ensureNarrator();
  el.innerHTML = '';
  narrationLines.forEach((t, i) => {
    const p = document.createElement('div');
    p.textContent = t.count > 1 ? `${t.text} (×${t.count})` : t.text;
    // Older lines recede so the newest reads first.
    p.style.opacity = String(0.35 + (0.65 * (i + 1)) / narrationLines.length);
    el.appendChild(p);
  });
  el.style.opacity = narrationOk ? '1' : '0';
  el.lastElementChild?.animate?.([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

// The narration box's current lines, newest last - for the e2e suite.
export const narrationLog = () => narrationLines.map((t) => (t.count > 1 ? `${t.text} (×${t.count})` : t.text));

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
