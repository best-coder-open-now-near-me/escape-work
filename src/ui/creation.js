// The character-creation screens (CHARACTER_PLAN.md). Joins `ui/` as "what
// TAKES OVER the frame", alongside screens.js.
//
// Two structural rules, both about the 3D body:
//
// 1. This screen never builds its own preview. The class picker has already put
//    the candidate on the spawn tile, on a turntable, under a dollied-in
//    camera, and that body stays exactly where it is - the résumé CARD is what
//    gets replaced. Every control here changes something already on screen.
//
// 2. The two steps are PANES INSIDE ONE OVERLAY, not two overlays. Tearing the
//    overlay down and rebuilding it would cost a .glb reload per step, which is
//    the binding constraint this whole design is shaped around
//    (CHARACTER_PLAN #14). Swapping panes costs nothing.
//
// Splitting into panes is also what keeps each card SHORT, and that turned out
// to be load-bearing rather than cosmetic: with every control on one card it
// ran past the viewport, and a vertically centred card that overflows does not
// merely look bad - its lower controls become genuinely unclickable, because
// scrolling them into view inside the card leaves them clipped by it.
import {
  PRONOUNS, NAME_MAX, draftModel, draftAttr, pointsLeft, spendDraftPoint, undoDraftPoint,
} from '../creation.js';
import { BACKGROUNDS } from '../data/backgrounds.js';
import { ATTR_KEYS } from '../stats.js';
import { RIGS, TINTS, BUILD_RANGE } from '../data/looks.js';

const PRONOUN_LABEL = { she: 'she/her', he: 'he/him', they: 'they/them' };

const CARD = {
  background: '#232334', border: '1px solid #3a3a52', borderRadius: '12px',
  padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,.6)',
  pointerEvents: 'auto', width: '340px',
};

const FIELD_LABEL = {
  fontSize: '11px', letterSpacing: '1px', opacity: '.6', marginBottom: '6px',
  textTransform: 'uppercase',
};

const CHIP = {
  padding: '6px 11px', borderRadius: '999px', border: '1px solid #3a3a52',
  background: '#2a2a3e', color: '#f0f0f5', font: 'inherit', fontSize: '12px',
  cursor: 'pointer',
};

const SMALL_CHIP = { ...CHIP, fontSize: '11px', padding: '4px 8px' };

const PRIMARY = {
  flex: '1', padding: '10px', borderRadius: '9px', border: '1px solid #3a3a52',
  background: '#2e4a34', color: '#f0f0f5', font: 'inherit', fontWeight: '700',
  letterSpacing: '1px', fontSize: '13px', cursor: 'pointer',
};

const QUIET = {
  display: 'block', margin: '10px auto 0', padding: '4px', border: 'none',
  background: 'none', color: '#8a8aa0', font: 'inherit', fontSize: '11px',
  textDecoration: 'underline', cursor: 'pointer',
};

const label = (text) => {
  const el = document.createElement('div');
  Object.assign(el.style, FIELD_LABEL);
  el.textContent = text;
  return el;
};

const chipRow = (gap = '6px', margin = '0 0 16px') => {
  const el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', flexWrap: 'wrap', gap, margin });
  return el;
};

const hint = () => {
  const el = document.createElement('div');
  Object.assign(el.style, { fontSize: '11px', opacity: '.55', margin: '-10px 0 14px', minHeight: '1.4em' });
  return el;
};

// Paint a set of chips as a single-choice group, greened where chosen.
const paintGroup = (els, isOn) => {
  for (const { id, b } of els) {
    const on = isOn(id);
    b.style.background = on ? '#2e4a34' : '#2a2a3e';
    b.style.borderColor = on ? '#8adf76' : '#3a3a52';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
};

// The creation flow. `draft` is mutated in place - these panes are an editor
// for it, and the host owns what happens when the player commits.
//
// `onPreview(kind)` asks the host to reflect the draft on the live body: 'rig'
// is the one kind that costs a .glb load, 'look' mutates in place so a slider
// can drive it every frame.
export function showBadgeStep(draft, { onCommit, onSkip, onPreview }) {
  const preview = (kind) => onPreview && onPreview(kind);

  const root = document.createElement('div');
  root.id = 'creation-badge';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '40', pointerEvents: 'none',
    color: '#f0f0f5', font: '15px system-ui, sans-serif',
  });
  // Dimmed hardest on the right, matching the picker: the candidate stays lit
  // on the left, because they are what this screen is about.
  const dim = document.createElement('div');
  Object.assign(dim.style, {
    position: 'absolute', inset: '0',
    background: 'linear-gradient(90deg, rgba(8,8,16,.28) 0%, rgba(8,8,16,.22) 46%, rgba(8,8,16,.8) 74%)',
  });
  root.appendChild(dim);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', right: '6vw', top: '50%', transform: 'translateY(-50%)',
  });
  const card = document.createElement('div');
  Object.assign(card.style, CARD);
  panel.appendChild(card);
  root.appendChild(panel);

  const heading = document.createElement('div');
  Object.assign(heading.style, { fontSize: '11px', letterSpacing: '2px', color: '#8adf76' });
  const sub = document.createElement('div');
  Object.assign(sub.style, { opacity: '.7', fontSize: '12px', margin: '2px 0 16px' });
  card.append(heading, sub);

  // Both panes are built up front and swapped by display, so no control is ever
  // re-created: no listener can leak, and no paint function can end up holding
  // a stale node.
  const paneOne = document.createElement('div');
  const paneTwo = document.createElement('div');
  card.append(paneOne, paneTwo);

  // ======================= PANE 1 - THE BADGE PHOTO =======================
  const name = document.createElement('input');
  name.id = 'creation-name';
  name.type = 'text';
  name.maxLength = NAME_MAX;
  name.value = draft.name;
  Object.assign(name.style, {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px',
    border: '1px solid #3a3a52', background: '#1c1c2c', color: '#f0f0f5',
    font: 'inherit', fontSize: '14px', marginBottom: '16px',
  });
  // Live, not on-commit: the read-back quotes it, and a name that only appears
  // after you press the button is a name you cannot check before committing.
  name.oninput = () => { draft.name = name.value; repaintSummary(); };
  // The canvas binds single keys (I, T, 1-9), so typing must not reach it.
  name.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') next.click();
  };
  paneOne.append(label('Name'), name);

  const pronounRow = chipRow('7px');
  const pronounEls = PRONOUNS.map((id) => {
    const b = document.createElement('button');
    b.id = `creation-pronoun-${id}`;
    b.type = 'button';
    b.textContent = PRONOUN_LABEL[id];
    Object.assign(b.style, CHIP);
    b.onclick = () => { draft.pronouns = id; paintPronouns(); repaintSummary(); };
    pronounRow.appendChild(b);
    return { id, b };
  });
  const paintPronouns = () => paintGroup(pronounEls, (id) => draft.pronouns === id);
  paneOne.append(label('Pronouns'), pronounRow);

  // NAMES, not renders: twelve thumbnails would mean twelve .glb loads, which
  // is the exact cost this screen is designed around. The body on the spawn
  // tile IS the render, and clicking a name is the one legitimate reload.
  const rigRow = chipRow('5px', '0 0 4px');
  const rigEls = Object.entries(RIGS).map(([id, def]) => {
    const b = document.createElement('button');
    b.id = `creation-rig-${id}`;
    b.type = 'button';
    b.textContent = def.name;
    b.title = def.blurb;
    Object.assign(b.style, SMALL_CHIP);
    b.onclick = () => {
      if (draftModel(draft) === id) return; // already worn - do not pay for a reload
      draft.rig = id;
      paintRigs();
      preview('rig');
    };
    rigRow.appendChild(b);
    return { id, b };
  });
  const rigHint = hint();
  const paintRigs = () => {
    const worn = draftModel(draft);
    paintGroup(rigEls, (id) => id === worn);
    rigHint.textContent = RIGS[worn]?.blurb || '';
  };
  paneOne.append(label('Wardrobe'), rigRow, rigHint);

  const tintRow = chipRow('7px');
  const tintEls = TINTS.map((t) => {
    const b = document.createElement('button');
    b.id = `creation-tint-${t.id}`;
    b.type = 'button';
    b.title = t.name;
    Object.assign(b.style, {
      width: '25px', height: '25px', borderRadius: '50%', cursor: 'pointer',
      border: '2px solid #3a3a52', padding: '0',
      // The swatch shows the colour it will PRODUCE: the tint multiplies a
      // light baked diffuse, so showing the triple against a light grey is
      // honest about the result.
      background: `rgb(${t.rgb.map((c) => Math.round(c * 214)).join(',')})`,
    });
    b.onclick = () => { draft.tint = t.rgb; paintTints(); preview('look'); };
    tintRow.appendChild(b);
    return { id: t.id, b, rgb: t.rgb };
  });
  const sameRgb = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const paintTints = () => {
    for (const { b, rgb } of tintEls) {
      const on = sameRgb(draft.tint, rgb);
      b.style.borderColor = on ? '#8adf76' : '#3a3a52';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  paneOne.append(label('Colour'), tintRow);

  // Two named dials over checked ranges, not the four raw proportion keys:
  // `head` and `arms` are counter-scales that CANCEL the torso stretch, so
  // exposing them would let a player undo the correction rather than say
  // anything about who they are (models.js documents the cautions).
  const buildEls = Object.entries(BUILD_RANGE).map(([key, range]) => {
    const slider = document.createElement('input');
    slider.id = `creation-build-${key}`;
    slider.type = 'range';
    slider.min = String(range.min);
    slider.max = String(range.max);
    slider.step = String(range.step);
    Object.assign(slider.style, { width: '100%', marginBottom: '10px', accentColor: '#8adf76' });
    slider.oninput = () => {
      draft.build = { ...(draft.build || {}), [key]: Number(slider.value) };
      preview('look'); // mutates the live body in place - no reload
    };
    slider.onkeydown = (e) => e.stopPropagation();
    paneOne.append(label(range.label), slider);
    return { key, slider, range };
  });
  const paintBuild = () => {
    for (const { key, slider, range } of buildEls) {
      const v = draft.build?.[key];
      slider.value = String(Number.isFinite(v) ? v : (range.min + range.max) / 2);
    }
  };

  // ====================== PANE 2 - THE EXIT INTERVIEW ======================
  const bgRow = chipRow('5px', '0 0 4px');
  const bgEls = Object.entries(BACKGROUNDS).map(([id, def]) => {
    const b = document.createElement('button');
    b.id = `creation-background-${id}`;
    b.type = 'button';
    b.textContent = def.name;
    b.title = def.blurb;
    Object.assign(b.style, SMALL_CHIP);
    // Clicking the chosen one again clears it - "none" has to stay reachable
    // once you have picked, or the first click is irreversible.
    b.onclick = () => {
      draft.background = draft.background === id ? null : id;
      paintBackgrounds();
      paintAttrs();
      repaintSummary();
    };
    bgRow.appendChild(b);
    return { id, b };
  });
  const bgHint = hint();
  bgHint.style.minHeight = '2.8em';
  const paintBackgrounds = () => {
    paintGroup(bgEls, (id) => draft.background === id);
    const chosen = BACKGROUNDS[draft.background];
    bgHint.textContent = chosen
      ? `${chosen.blurb} ${chosen.line}`
      : 'Optional. It costs as much as it gives.';
  };
  paneTwo.append(label('So why are you still here?'), bgRow, bgHint);

  // Two points, through the level-up screen's own stepper shape. No second
  // point economy: createCharacter banks them and spends them through the very
  // same spendAttrPoint.
  const saLabel = label('Self-assessment');
  paneTwo.appendChild(saLabel);
  const attrRows = ATTR_KEYS.map((key) => {
    const r = document.createElement('div');
    Object.assign(r.style, {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 9px',
      borderRadius: '7px', background: '#2a2a3e', marginBottom: '5px',
    });
    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, { flex: '1', fontSize: '13px', textTransform: 'capitalize' });
    nameEl.textContent = key;
    const value = document.createElement('span');
    Object.assign(value.style, { opacity: '.85', fontWeight: '600' });
    const plus = document.createElement('button');
    plus.id = `creation-attr-${key}`;
    plus.type = 'button';
    plus.textContent = '+';
    Object.assign(plus.style, { ...CHIP, padding: '1px 10px', borderRadius: '7px', fontSize: '13px' });
    plus.onclick = () => { spendDraftPoint(draft, key); paintAttrs(); repaintSummary(); };
    r.append(nameEl, value, plus);
    paneTwo.appendChild(r);
    return { key, value, plus };
  });
  const undo = document.createElement('button');
  undo.id = 'creation-undo';
  undo.type = 'button';
  undo.textContent = 'Take one back';
  Object.assign(undo.style, { ...QUIET, margin: '4px 0 12px' });
  undo.onclick = () => { undoDraftPoint(draft); paintAttrs(); repaintSummary(); };
  paneTwo.appendChild(undo);
  const paintAttrs = () => {
    const attr = draftAttr(draft);
    const left = pointsLeft(draft);
    saLabel.textContent = `Self-assessment · ${left} point${left === 1 ? '' : 's'} left`;
    for (const { key, value, plus } of attrRows) {
      value.textContent = String(attr[key] ?? 0);
      plus.style.opacity = left > 0 ? '1' : '.35';
      plus.setAttribute('aria-disabled', left > 0 ? 'false' : 'true');
    }
    undo.style.display = draft.spends.length ? 'block' : 'none';
  };

  // ============================== the footer ==============================
  const buttons = document.createElement('div');
  Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '4px' });

  const back = document.createElement('button');
  back.id = 'creation-back';
  back.type = 'button';
  back.textContent = 'BACK';
  Object.assign(back.style, { ...PRIMARY, flex: '0 0 auto', background: '#2a2a3e', fontWeight: '600' });
  back.onclick = () => showPane(1);

  const next = document.createElement('button');
  next.id = 'creation-next';
  next.type = 'button';
  next.textContent = 'NEXT: EXIT INTERVIEW';
  Object.assign(next.style, PRIMARY);
  next.onclick = () => showPane(2);

  const commit = document.createElement('button');
  commit.id = 'creation-commit';
  commit.type = 'button';
  commit.textContent = 'SIGN THE PAPERWORK';
  Object.assign(commit.style, PRIMARY);
  commit.onclick = () => { cleanup(); onCommit(); };

  buttons.append(back, next, commit);
  card.appendChild(buttons);

  // The character read back in one sentence, under the button that commits
  // them. Deliberately not a third pane: a summary you cannot act on is a dead
  // click, and it belongs where the acting happens.
  const summary = document.createElement('div');
  summary.id = 'creation-summary';
  Object.assign(summary.style, {
    marginTop: '10px', fontSize: '12px', opacity: '.65', lineHeight: '1.5', minHeight: '2.6em',
  });
  card.appendChild(summary);

  const skip = document.createElement('button');
  skip.id = 'creation-skip';
  skip.type = 'button';
  skip.textContent = 'Skip the paperwork';
  Object.assign(skip.style, QUIET);
  skip.onclick = () => { cleanup(); onSkip(); };
  card.appendChild(skip);

  function showPane(n) {
    paneOne.style.display = n === 1 ? '' : 'none';
    paneTwo.style.display = n === 2 ? '' : 'none';
    back.style.display = n === 2 ? '' : 'none';
    next.style.display = n === 1 ? '' : 'none';
    commit.style.display = n === 2 ? '' : 'none';
    heading.textContent = n === 1 ? 'EMPLOYEE BADGE' : 'EXIT INTERVIEW';
    sub.textContent = n === 1
      ? 'Photo on file. The rest is up to you.'
      : 'Two questions. Then you can go.';
  }

  function repaintSummary() {
    // Reads back what they TYPED, not what they will get if they leave it
    // blank - the fallback happens at commit, and showing it here would look
    // like the field had rejected their input.
    const shown = draft.name.trim() || draft.className || '';
    const bg = BACKGROUNDS[draft.background];
    summary.textContent = [
      `${shown}, ${PRONOUN_LABEL[draft.pronouns]}, ${draft.className}.`,
      bg ? `${bg.name}. ${bg.line}` : '',
    ].filter(Boolean).join(' ');
  }

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }
  // Escape backs out to the desk, the way right-click backs out of an aimed
  // action. Captured, so the world's own key bindings never see it.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cleanup(); onSkip(); }
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(root);
  paintPronouns();
  paintRigs();
  paintTints();
  paintBuild();
  paintBackgrounds();
  paintAttrs();
  repaintSummary();
  showPane(1);
  name.focus();
  name.select();
  return cleanup;
}
