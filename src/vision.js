// Impaired sight: what a BLINDED (or confused) character's PLAYER sees, and
// where their aim really lands.
//
// DOS1 and DOS2 both blind you and then only ever charge you accuracy - the
// screen never changes, so a blinded party member plays exactly like a sighted
// one who has started rolling badly. This is the half those games left out:
// while the character you are steering carries a status with `aimSway` or
// `sightBlots`, the point the game aims at DRIFTS away from the mouse, three
// cursors sway over the floor instead of one, and ink swims across the world.
//
// Two rules keep it a handicap rather than a punishment:
//   - The drift is a SUM OF SINES, never random. It is a slow swim you can read
//     and lead, not a fresh dice roll on every click - a player who watches the
//     true reticle can still land the shot they mean, they just have to time it.
//     (The same reason controls.js's camera shake is deterministic: a wobble
//     driven by Math.random is one more thing that differs between two runs.)
//   - The TRUE aim point is always drawn. It is the crisp white reticle, and it
//     is exactly where a click lands; the two ghosts are colour-fringed and
//     half-transparent. Nothing is hidden from the player - it is only harder
//     to hold on to.
//
// Only the pointer's WORLD reading is bent: controls.js applies `aim` to the
// left click and the hover, and to nothing else. The hotbar, the panels and the
// right-click menu stay exact - blind makes you fumble a swing, not a button.
//
// Nothing here touches PlayCanvas or the world; it is DOM over the canvas plus
// two pure functions, which is why the sway math is unit tested.

// --- the pure part ----------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How far the aim can drift from the mouse, in CSS pixels, at full strength.
// Sized against a BODY, not a tile: about a third of a coworker's on-screen
// width at the default boom, so a hovered target slides in and out of the
// crosshair as you sway but a deliberate click on someone you are standing
// next to still lands.
export const SWAY_PX = 21;
// How far the ghosts separate from the true reticle at full strength. Wide
// enough that they read as three cursors rather than one with a colour fringe -
// which is what the first pass looked like at half this.
export const GHOST_PX = 30;

// The drift of the true aim point at time `t` (seconds), in CSS pixels.
// Two incommensurable sines per axis, so the path never reads as a loop.
export function swayAt(t, strength = 1) {
  const s = clamp01(strength);
  if (s <= 0) return { dx: 0, dy: 0 };
  const amp = SWAY_PX * s;
  const dx = (Math.sin(t * 1.7) * 0.62 + Math.sin(t * 0.83 + 2.1) * 0.38) * amp;
  const dy = (Math.sin(t * 1.31 + 1.1) * 0.58 + Math.sin(t * 2.07 + 0.4) * 0.42) * amp;
  return { dx, dy };
}

// The two ghost reticles, as offsets FROM the true aim point. They sit opposite
// each other on a slowly rotating axis whose length breathes, so double vision
// drifts apart and converges the way real double vision does - rather than two
// copies pinned at a fixed distance, which reads as a UI decoration.
export function ghostsAt(t, strength = 1) {
  const s = clamp01(strength);
  const ang = t * 0.61;
  // The breathing never closes all the way: two copies that converge exactly
  // onto the true reticle read as a rendering glitch for that half second.
  const sep = GHOST_PX * s * (0.62 + 0.38 * Math.sin(t * 1.13));
  return [0, 1].map((k) => {
    const a = ang + k * Math.PI;
    return { dx: Math.cos(a) * sep, dy: Math.sin(a) * sep * 0.72 };
  });
}

// --- the look ---------------------------------------------------------------

// Over the world, under the HUD: the ink must not cover the numbers you need to
// decide what to do. The cursors sit above everything, because a pointer does.
const HAZE_Z = '5';
const CURSOR_Z = '31';

// The ink in the eye. Each blot drifts on its own two-sine path and breathes on
// its own clock, so they never line up into a mask that reads as static. `x`/`y`
// are viewport fractions, `r` is its radius in vmin, `drift` is how many vmin it
// wanders, `squash` flattens it into a smear, and `alpha` is its weight at full
// strength.
//
// Deliberately NOT centred: the middle of the screen is where the character you
// are steering stands, and a blot parked there for two turns is unplayable
// rather than impaired. They crowd the edges, swim through the middle, and
// leave gaps you can aim through if you wait for them.
//
// `line` blots are the streaks - long, thin and hard-edged, the floaters that
// cut across your vision rather than pooling in it. They carry a pale rim
// (below) so they read over the dark void as well as over a lit floor: pure
// black on a near-black background is not an effect, it is nothing.
const BLOTS = [
  { x: 0.20, y: 0.28, r: 30, drift: 9, squash: 0.82, rot: -18, alpha: 0.97, fx: 0.063, fy: 0.039, ph: 0.0 },
  { x: 0.76, y: 0.22, r: 25, drift: 11, squash: 0.58, rot: 24, alpha: 0.95, fx: 0.048, fy: 0.072, ph: 1.7 },
  { x: 0.64, y: 0.74, r: 31, drift: 8, squash: 0.74, rot: 8, alpha: 0.96, fx: 0.039, fy: 0.057, ph: 3.1 },
  { x: 0.12, y: 0.80, r: 23, drift: 12, squash: 0.66, rot: -34, alpha: 0.94, fx: 0.081, fy: 0.033, ph: 4.4 },
  { x: 0.50, y: 0.44, r: 14, drift: 17, squash: 0.5, rot: 12, alpha: 0.8, fx: 0.027, fy: 0.093, ph: 2.2 },
  { x: 0.90, y: 0.56, r: 19, drift: 10, squash: 0.46, rot: 62, alpha: 0.93, fx: 0.069, fy: 0.051, ph: 5.6 },
  { x: 0.36, y: 0.16, r: 26, drift: 14, squash: 0.1, rot: -12, alpha: 0.9, fx: 0.054, fy: 0.078, ph: 0.9, line: true },
  { x: 0.68, y: 0.52, r: 30, drift: 13, squash: 0.07, rot: 27, alpha: 0.86, fx: 0.033, fy: 0.066, ph: 2.7, line: true },
  { x: 0.30, y: 0.66, r: 22, drift: 15, squash: 0.12, rot: -63, alpha: 0.84, fx: 0.075, fy: 0.042, ph: 4.9, line: true },
];
// What a blot is made of: a dead-black core that fades out, over a pale smear
// that keeps the shape legible against the void.
const BLOT_INK = 'radial-gradient(closest-side, rgba(2,2,5,0.99) 0%, rgba(2,2,5,0.97) 52%, rgba(2,2,5,0.62) 78%, rgba(2,2,5,0) 100%)';
const BLOT_RIM = 'radial-gradient(closest-side, rgba(150,154,184,0.20) 40%, rgba(150,154,184,0.10) 76%, rgba(150,154,184,0) 100%)';

// A reticle for the aiming verbs and an arrow for everything else - the same two
// shapes the OS cursors read as, so the swaying copies still say what a click
// would do. `hot` is the hotspot: the reticle points from its centre, the arrow
// from its tip.
const GLYPHS = {
  aim: {
    hot: 'translate(-50%, -50%)',
    svg: '<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="16" cy="16" r="7.2"/><path d="M16 1.5v6.5M16 24v6.5M1.5 16h6.5M24 16h6.5"/></svg>',
  },
  deny: {
    hot: 'translate(-50%, -50%)',
    svg: '<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="16" cy="16" r="8.5"/><path d="M10 10l12 12"/></svg>',
  },
  point: {
    hot: 'translate(-2px, -1px)',
    svg: '<svg viewBox="0 0 32 32" width="26" height="26" fill="currentColor"><path d="M2 1.5L2 23l5.6-5.4 3.3 7.6 4.1-1.8-3.4-7.5 8.1-.6z"/></svg>',
  },
};
const SHAPE_FOR = { crosshair: 'aim', 'not-allowed': 'deny' };

// The true reticle reads white; the ghosts are the two halves of a chromatic
// split, screened over the world so they glow rather than smudge.
const EYE_TINTS = ['#f2f4ff', '#ff6a6a', '#63d9ff'];

export function createVisionLayer({ canvas, root = document.body } = {}) {
  let target = 0; // what the statuses say
  let level = 0; // ...eased, so sight fails and returns smoothly
  let clock = 0;
  let shape = ''; // the cursor verb hover.js last asked for
  let px = 0;
  let py = 0;
  let overCanvas = false;
  let dom = null;

  // Track the REAL pointer, over UI as well as world: the ghosts are hidden
  // while the mouse is on a panel (blind must not make the hotbar a lottery),
  // and that means knowing when it left.
  window.addEventListener('mousemove', (e) => {
    px = e.clientX;
    py = e.clientY;
    overCanvas = !canvas || e.target === canvas;
  }, { passive: true });

  function build() {
    if (dom) return dom;
    const haze = document.createElement('div');
    haze.id = 'vision-haze';
    Object.assign(haze.style, {
      position: 'fixed', inset: '0', zIndex: HAZE_Z, pointerEvents: 'none',
      opacity: '0', overflow: 'hidden',
    });
    // The soft grey swim over everything: the world goes milky at the edges and
    // stays legible in the middle. backdrop-filter does the blurring, so it
    // costs no render target of ours.
    const milk = document.createElement('div');
    Object.assign(milk.style, {
      position: 'absolute', inset: '-4%',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(150,152,178,0.05) 24%, rgba(122,126,152,0.32) 70%, rgba(96,100,128,0.52) 100%)',
      // Everything softens, and the periphery softens hard: the blur is what
      // makes it read as EYES rather than as a filter laid over the picture.
      backdropFilter: 'blur(2.2px) saturate(0.72) brightness(0.86)',
      WebkitBackdropFilter: 'blur(2.2px) saturate(0.72) brightness(0.86)',
    });
    haze.appendChild(milk);
    const blots = BLOTS.map((b) => {
      const el = document.createElement('div');
      const w = b.r * 2;
      const h = b.r * 2 * b.squash;
      Object.assign(el.style, {
        position: 'absolute', left: '0', top: '0',
        width: `${w}vmin`, height: `${h}vmin`,
        marginLeft: `${-b.r}vmin`, marginTop: `${-b.r * b.squash}vmin`,
        borderRadius: '50%',
        backgroundImage: `${BLOT_INK}, ${BLOT_RIM}`,
        // Streaks stay crisp (a floater has an edge); pools stay soft.
        filter: `blur(${b.line ? 3 : 8}px)`,
      });
      haze.appendChild(el);
      return el;
    });
    const cursors = document.createElement('div');
    cursors.id = 'vision-cursors';
    Object.assign(cursors.style, {
      position: 'fixed', inset: '0', zIndex: CURSOR_Z, pointerEvents: 'none',
      display: 'none',
    });
    const eyes = EYE_TINTS.map((tint, i) => {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', left: '0', top: '0', color: tint,
        opacity: i ? '0.82' : '1', mixBlendMode: i ? 'screen' : 'normal',
        filter: i ? 'blur(0.7px)' : 'drop-shadow(0 0 3px rgba(0,0,0,.85))',
      });
      cursors.appendChild(el);
      return el;
    });
    root.appendChild(haze);
    root.appendChild(cursors);
    dom = { haze, blots, cursors, eyes, glyph: null };
    return dom;
  }

  // The native cursor is hidden while the sway is on: an arrow sitting
  // perfectly still while the world swims under it breaks the whole effect.
  // hover.js stays the one owner of WHAT the cursor says - its verb arrives
  // here through `cursorFor` - and this only decides whether the OS draws it.
  function paintCursor() {
    if (canvas) canvas.style.cursor = level > 0 ? 'none' : (shape || '');
  }

  function paint() {
    if (level <= 0) {
      if (dom) { dom.haze.style.opacity = '0'; dom.cursors.style.display = 'none'; }
      return;
    }
    const d = build();
    // Everything breathes off the same clock as the sway, so the ink and the
    // cursors read as one symptom rather than two effects that happen to be on.
    const breath = 0.86 + 0.14 * Math.sin(clock * 1.9);
    d.haze.style.opacity = String(level * breath);
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    BLOTS.forEach((b, i) => {
      const dx = Math.sin(clock * b.fx * 2 * Math.PI + b.ph) * b.drift * vmin;
      const dy = Math.cos(clock * b.fy * 2 * Math.PI + b.ph * 1.3) * b.drift * 0.7 * vmin;
      const pulse = 0.9 + 0.1 * Math.sin(clock * 0.9 + b.ph);
      const el = d.blots[i];
      el.style.opacity = String(b.alpha);
      el.style.transform = `translate(${b.x * window.innerWidth + dx}px, ${b.y * window.innerHeight + dy}px) rotate(${b.rot}deg) scale(${pulse})`;
    });

    // The cursors: the true aim first, then the two ghosts around it.
    if (!overCanvas) { d.cursors.style.display = 'none'; return; }
    d.cursors.style.display = '';
    const g = GLYPHS[SHAPE_FOR[shape] || 'point'];
    if (g !== d.glyph) {
      d.glyph = g;
      for (const el of d.eyes) el.innerHTML = g.svg;
    }
    const { dx, dy } = swayAt(clock, level);
    const ghosts = ghostsAt(clock, level);
    const at = [{ dx, dy }, { dx: dx + ghosts[0].dx, dy: dy + ghosts[0].dy },
      { dx: dx + ghosts[1].dx, dy: dy + ghosts[1].dy }];
    d.eyes.forEach((el, i) => {
      el.style.transform = `translate(${px + at[i].dx}px, ${py + at[i].dy}px) ${g.hot}`;
    });
  }

  return {
    // How impaired the character we're steering is, 0..1 (main.js feeds this
    // the merged `aimSway` of their live statuses, every frame).
    set(v) {
      const next = clamp01(v || 0);
      if (next === target) return;
      target = next;
    },
    // Ease toward it, advance the clock, redraw. Called from the frame loop.
    update(dt) {
      const d = Math.min(Math.max(dt || 0, 0), 0.1); // a backgrounded tab must not lurch
      const was = level > 0;
      level += (target - level) * (1 - Math.exp(-d * 5));
      if (target === 0 && level < 0.004) level = 0;
      if (level > 0) clock += d;
      if (was !== (level > 0)) paintCursor();
      paint();
    },
    // Where the character's aim ACTUALLY points, given where the mouse is.
    // controls.js runs the left click and the hover through this and nothing
    // else, so the crosshair, the preview and the click all sway together.
    aim(sx, sy) {
      if (level <= 0) return [sx, sy];
      const { dx, dy } = swayAt(clock, level);
      return [sx + dx, sy + dy];
    },
    // hover.js's verb, on its way to the canvas. Returns what the OS cursor
    // should be - 'none' while the swaying reticles are doing that job.
    cursorFor(c) {
      shape = c || '';
      return level > 0 ? 'none' : shape;
    },
    get strength() { return level; },
    // For the e2e suite: how far the aim is off the mouse right now, and what
    // verb the swaying reticles are wearing.
    get debug() {
      const { dx, dy } = swayAt(clock, level);
      return { strength: level, dx, dy, shape: SHAPE_FOR[shape] || 'point' };
    },
  };
}
