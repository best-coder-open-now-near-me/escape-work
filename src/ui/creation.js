// The creation screen (CHARACTER_PLAN.md). Joins `ui/` as "what TAKES OVER the
// frame", alongside screens.js.
//
// One structural rule, and it is about the 3D body: this screen never builds
// its own preview. The desk has already put the candidate on the spawn tile, on
// a turntable, under a dollied-in camera, and that body stays exactly where it
// is - the CARD beside them is what gets replaced. Tearing the overlay down and
// rebuilding it would cost a .glb reload, which is the cost this whole design
// is shaped around.
//
// This card used to be two panes carrying a typed name, a colour palette, two
// build sliders, an eight-entry "so why are you still here" background axis and
// a wardrobe of every rig in the game. All of it is gone. What a precut
// character gets is what they always should have got: their job, their body,
// their name, and two points to say what they are good at.
import {
  PRONOUNS, NAME_MAX, draftAttr, draftName, pointsLeft, spendDraftPoint,
  unspendDraftPoint, spentOn,
} from '../creation.js';
import { CUSTOM_RIGS } from '../data/looks.js';
import { ATTR_KEYS } from '../stats.js';

const PRONOUN_LABEL = { she: 'she/her', he: 'he/him', they: 'they/them' };

// The same four descriptions the level-up screen shows. Creation used to print
// the bare lowercase keys, so the one screen where a player has never seen
// these words was the one that explained them least.
const ATTR_BLURB = {
  grit: 'Toughness — raises max HP.',
  hustle: 'Tempo — raises max AP (move + actions).',
  savvy: 'Precision — raises attack damage.',
  composure: 'Poise — softens incoming hits.',
};

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

const PRIMARY = {
  flex: '1', padding: '10px', borderRadius: '9px', border: '1px solid #3a3a52',
  background: '#2e4a34', color: '#f0f0f5', font: 'inherit', fontWeight: '700',
  letterSpacing: '1px', fontSize: '13px', cursor: 'pointer',
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

// Paint a set of chips as a single-choice group, greened where chosen.
const paintGroup = (els, isOn) => {
  for (const { id, b } of els) {
    const on = isOn(id);
    b.style.background = on ? '#2e4a34' : '#2a2a3e';
    b.style.borderColor = on ? '#8adf76' : '#3a3a52';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
};

// The creation card. `draft` is mutated in place - this is an editor for it,
// and the host owns what happens when the player commits.
//
// `onBack` returns to the desk. `onPreview` asks the host to reload the body on
// the spawn tile, which only a rig change needs and only a custom character can
// do.
export function showCreationStep(draft, { onCommit, onBack, onPreview }) {
  const custom = !!draft.custom;

  const root = document.createElement('div');
  root.id = 'creation-badge';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '40', pointerEvents: 'none',
    color: '#f0f0f5', font: '15px system-ui, sans-serif',
  });
  // Dimmed hardest on the right, matching the desk: the candidate stays lit on
  // the left, because they are what this screen is about.
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
  heading.textContent = custom ? 'NEW STARTER' : 'FIRST DAY';
  const sub = document.createElement('div');
  Object.assign(sub.style, { opacity: '.7', fontSize: '12px', margin: '2px 0 16px' });
  card.append(heading, sub);

  // --- who you are ------------------------------------------------------------
  // A precut character is not asked. They are somebody: the job is the name, the
  // rig is the body, and both are stated rather than offered.
  let name = null;
  let rigEls = [];
  let paintRigs = () => {};
  if (custom) {
    name = document.createElement('input');
    name.id = 'creation-name';
    name.type = 'text';
    name.maxLength = NAME_MAX;
    name.placeholder = 'Your name';
    Object.assign(name.style, {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px',
      border: '1px solid #3a3a52', background: '#1c1c2c', color: '#f0f0f5',
      font: 'inherit', fontSize: '14px', marginBottom: '16px',
    });
    name.oninput = () => { draft.name = name.value; repaintSummary(); };
    // The canvas binds single keys (I, T, 1-9), so typing must not reach it.
    name.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') commit.click(); };
    card.append(label('Name'), name);

    // NAMES, not renders: a thumbnail per rig would mean a .glb load per
    // thumbnail, which is the exact cost this screen is designed around. The
    // body on the spawn tile IS the render, and clicking a name is the one
    // legitimate reload.
    const rigRow = chipRow('5px', '0 0 16px');
    rigEls = CUSTOM_RIGS.map((id, i) => {
      const b = document.createElement('button');
      b.id = `creation-rig-${id}`;
      b.type = 'button';
      b.textContent = `Body ${i + 1}`;
      Object.assign(b.style, { ...CHIP, fontSize: '11px', padding: '4px 8px' });
      b.onclick = () => {
        if (draft.rig === id) return; // already worn - do not pay for a reload
        draft.rig = id;
        paintRigs();
        onPreview && onPreview();
      };
      rigRow.appendChild(b);
      return { id, b };
    });
    paintRigs = () => paintGroup(rigEls, (id) => draft.rig === id);
    card.append(label('Body'), rigRow);
  }

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
  card.append(label('Pronouns'), pronounRow);

  // --- the self-assessment ----------------------------------------------------
  // Two points, through the level-up screen's own stepper shape. No second point
  // economy: createCharacter banks them and spends them through the very same
  // spendAttrPoint.
  const saLabel = label('Self-assessment');
  card.appendChild(saLabel);
  const attrRows = ATTR_KEYS.map((key) => {
    const r = document.createElement('div');
    Object.assign(r.style, {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 9px',
      borderRadius: '7px', background: '#2a2a3e', marginBottom: '5px',
    });
    const text = document.createElement('div');
    Object.assign(text.style, { flex: '1' });
    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, { fontSize: '13px', textTransform: 'capitalize', fontWeight: '600' });
    nameEl.textContent = key;
    const blurb = document.createElement('div');
    Object.assign(blurb.style, { opacity: '.6', fontSize: '11px' });
    blurb.textContent = ATTR_BLURB[key] || '';
    text.append(nameEl, blurb);
    const value = document.createElement('span');
    Object.assign(value.style, { opacity: '.85', fontWeight: '600', minWidth: '1.2em', textAlign: 'right' });
    // A stepper, both halves of it, always present. The minus used to be a
    // single "Take one back" link under the whole list that appeared only once
    // you had spent something - so the control that undoes a row was not on the
    // row, was not there when you were deciding, and moved the four rows down
    // the card when it turned up. A pair of buttons per row is what the numbers
    // beside them lead you to expect.
    const step = (glyph, id, onPress) => {
      const b = document.createElement('button');
      b.id = id;
      b.type = 'button';
      b.textContent = glyph;
      Object.assign(b.style, { ...CHIP, padding: '1px 10px', borderRadius: '7px', fontSize: '13px' });
      b.onclick = () => { onPress(); paintAttrs(); repaintSummary(); };
      return b;
    };
    const minus = step('−', `creation-attr-minus-${key}`, () => unspendDraftPoint(draft, key));
    const plus = step('+', `creation-attr-${key}`, () => spendDraftPoint(draft, key));
    r.append(text, minus, value, plus);
    card.appendChild(r);
    return { key, value, minus, plus };
  });
  const paintAttrs = () => {
    const attr = draftAttr(draft);
    const left = pointsLeft(draft);
    saLabel.textContent = `Self-assessment · ${left} point${left === 1 ? '' : 's'} left`;
    for (const { key, value, minus, plus } of attrRows) {
      value.textContent = String(attr[key] ?? 0);
      // Dimmed rather than hidden, both directions: a control that vanishes
      // when it is unusable reflows the card under the cursor, and the reason
      // it is unusable ("nothing of yours in that row", "no points left") is
      // legible from the numbers next to it.
      const canAdd = left > 0;
      const canTake = spentOn(draft, key) > 0;
      for (const [b, on] of [[plus, canAdd], [minus, canTake]]) {
        b.style.opacity = on ? '1' : '.35';
        b.style.cursor = on ? 'pointer' : 'default';
        b.setAttribute('aria-disabled', on ? 'false' : 'true');
      }
    }
  };

  // --- the footer -------------------------------------------------------------
  const buttons = document.createElement('div');
  Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '4px' });

  const back = document.createElement('button');
  back.id = 'creation-back';
  back.type = 'button';
  back.textContent = 'BACK';
  Object.assign(back.style, { ...PRIMARY, flex: '0 0 auto', background: '#2a2a3e', fontWeight: '600' });
  back.onclick = () => { cleanup(); onBack(); };

  const commit = document.createElement('button');
  commit.id = 'creation-commit';
  commit.type = 'button';
  commit.textContent = 'START';
  Object.assign(commit.style, PRIMARY);
  commit.onclick = () => { cleanup(); onCommit(); };

  buttons.append(back, commit);
  card.appendChild(buttons);

  // The character read back in one sentence, under the button that commits
  // them.
  const summary = document.createElement('div');
  summary.id = 'creation-summary';
  Object.assign(summary.style, {
    marginTop: '10px', fontSize: '12px', opacity: '.65', lineHeight: '1.5', minHeight: '2.6em',
  });
  card.appendChild(summary);

  function repaintSummary() {
    const job = draft.className || '';
    // `draftName` and not a hand-rolled trim: it is the rule that decides the
    // name the character is actually CREATED with, and this line is a preview
    // of exactly that. The hand-rolled version disagreed with it on a blank
    // field - the summary read ", they/them, Intern." while the character you
    // got was named Intern - and on internal whitespace, which draftName
    // collapses (Q177).
    const who = draftName(draft);
    sub.textContent = custom
      ? 'Nobody here yet. Say who.'
      : `${job}. This is who you are.`;
    summary.textContent = who
      ? `${who}, ${PRONOUN_LABEL[draft.pronouns]}, ${job}.`
      : `${PRONOUN_LABEL[draft.pronouns]}, ${job}.`;
  }

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }
  // Escape goes BACK TO THE DESK. It used to commit the character instead - the
  // handler called the skip path, which started the run - so the one gesture
  // that universally means cancel was wired to the opposite of cancelling.
  // Captured, so the world's own key bindings never see it.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cleanup(); onBack(); }
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(root);
  paintPronouns();
  paintRigs();
  paintAttrs();
  repaintSummary();
  if (name) { name.focus(); name.select(); }
  return cleanup;
}
