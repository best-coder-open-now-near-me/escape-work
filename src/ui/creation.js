// The character-creation screens (CHARACTER_PLAN.md). Joins `ui/` as "what
// TAKES OVER the frame", alongside screens.js.
//
// The one structural rule: this screen never builds its own 3D preview. The
// class picker has already put the candidate on the spawn tile, on a turntable,
// under a dollied-in camera - and that body stays exactly where it is while the
// résumé card is replaced by this form. Every control here changes something
// the player is already looking at, and rebuilding the preview would cost a
// .glb reload per step (CHARACTER_PLAN #14, the binding constraint).
import { PRONOUNS, NAME_MAX } from '../creation.js';

const PRONOUN_LABEL = { she: 'she/her', he: 'he/him', they: 'they/them' };

const CARD = {
  background: '#232334', border: '1px solid #3a3a52', borderRadius: '12px',
  padding: '22px 24px', boxShadow: '0 12px 40px rgba(0,0,0,.6)',
  pointerEvents: 'auto', width: '340px',
};

const FIELD_LABEL = {
  fontSize: '11px', letterSpacing: '1px', opacity: '.6', marginBottom: '6px',
  textTransform: 'uppercase',
};

const CHIP = {
  padding: '7px 12px', borderRadius: '999px', border: '1px solid #3a3a52',
  background: '#2a2a3e', color: '#f0f0f5', font: 'inherit', fontSize: '13px',
  cursor: 'pointer',
};

// Step 2 - THE BADGE PHOTO. Returns a cleanup function.
//
// `draft` is mutated in place: this screen is an editor for it, and the host
// owns what happens when the player commits. `onCommit` receives nothing - the
// caller already holds the draft.
export function showBadgeStep(draft, { onCommit, onSkip }) {
  const root = document.createElement('div');
  root.id = 'creation-badge';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '40', pointerEvents: 'none',
    color: '#f0f0f5', font: '15px system-ui, sans-serif',
  });
  // Dimmed hardest on the right, matching the picker: the candidate stays lit
  // on the left, because they are the thing this screen is about.
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
  heading.textContent = 'EMPLOYEE BADGE';
  const sub = document.createElement('div');
  Object.assign(sub.style, { opacity: '.7', fontSize: '13px', margin: '2px 0 18px' });
  sub.textContent = 'Photo on file. The rest is up to you.';
  card.append(heading, sub);

  // --- name ---------------------------------------------------------------
  const nameLabel = document.createElement('div');
  Object.assign(nameLabel.style, FIELD_LABEL);
  nameLabel.textContent = 'Name';
  const name = document.createElement('input');
  name.id = 'creation-name';
  name.type = 'text';
  name.maxLength = NAME_MAX;
  name.value = draft.name;
  Object.assign(name.style, {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '8px',
    border: '1px solid #3a3a52', background: '#1c1c2c', color: '#f0f0f5',
    font: 'inherit', marginBottom: '18px',
  });
  // Live, not on-commit: the read-back line under the button quotes it, and a
  // name that only appears after you press the button is a name you cannot
  // check before committing to it.
  name.oninput = () => { draft.name = name.value; repaintSummary(); };
  // The canvas must not see typing - the world binds single keys (I, T, 1-9).
  name.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit.click();
  };
  card.append(nameLabel, name);

  // --- pronouns -----------------------------------------------------------
  const pronounLabel = document.createElement('div');
  Object.assign(pronounLabel.style, FIELD_LABEL);
  pronounLabel.textContent = 'Pronouns';
  const chips = document.createElement('div');
  Object.assign(chips.style, { display: 'flex', gap: '8px', marginBottom: '20px' });
  const chipEls = PRONOUNS.map((p) => {
    const b = document.createElement('button');
    b.id = `creation-pronoun-${p}`;
    b.type = 'button';
    b.textContent = PRONOUN_LABEL[p];
    Object.assign(b.style, CHIP);
    b.onclick = () => { draft.pronouns = p; paintChips(); repaintSummary(); };
    chips.appendChild(b);
    return { p, b };
  });
  const paintChips = () => {
    for (const { p, b } of chipEls) {
      const on = draft.pronouns === p;
      b.style.background = on ? '#2e4a34' : '#2a2a3e';
      b.style.borderColor = on ? '#8adf76' : '#3a3a52';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  card.append(pronounLabel, chips);

  // --- commit -------------------------------------------------------------
  const commit = document.createElement('button');
  commit.id = 'creation-commit';
  commit.type = 'button';
  commit.textContent = 'SIGN THE PAPERWORK';
  Object.assign(commit.style, {
    width: '100%', padding: '11px', borderRadius: '9px', border: '1px solid #3a3a52',
    background: '#2e4a34', color: '#f0f0f5', font: 'inherit', fontWeight: '700',
    letterSpacing: '1px', cursor: 'pointer',
  });
  commit.onclick = () => { cleanup(); onCommit(); };
  card.appendChild(commit);

  // The read-back: the character in one sentence, under the button that
  // commits them. Deliberately not a fourth step - a summary you cannot act on
  // is a dead click, and it belongs where the acting happens.
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
  Object.assign(skip.style, {
    display: 'block', margin: '12px auto 0', padding: '4px', border: 'none',
    background: 'none', color: '#8a8aa0', font: 'inherit', fontSize: '12px',
    textDecoration: 'underline', cursor: 'pointer',
  });
  skip.onclick = () => { cleanup(); onSkip(); };
  card.appendChild(skip);

  function repaintSummary() {
    // Read back what they typed, not what they will get if they leave it blank
    // - the fallback happens at commit, and showing it here would look like the
    // field had rejected their input.
    const shown = draft.name.trim() || draft.className || '';
    summary.textContent = `${shown}, ${PRONOUN_LABEL[draft.pronouns]}, ${draft.className}.`;
  }

  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }
  // Escape backs out to the desk the same way right-click backs out of an aimed
  // action - captured, so the world's own key bindings never see it.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cleanup(); onSkip(); }
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(root);
  paintChips();
  repaintSummary();
  name.focus();
  name.select();
  return cleanup;
}
