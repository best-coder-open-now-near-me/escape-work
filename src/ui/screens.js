// Screens that TAKE OVER: the level-up allocation, the win / floor-clear /
// lose overlays, the boot-time class picker, the game menu and the playtest
// badge. Each owns the frame it is in, so they share the `overlay` shell and
// its button below rather than each inventing one.
import { BUTTON_CHROME, esc,
} from './chrome.js';
import { TALENTS, STARTING_TALENT_BY_CLASS } from '../data/talents.js';

// --- end-of-game overlays ----------------------------------------------------
function overlay(id, inner) {
  const div = document.createElement('div');
  div.id = id;
  Object.assign(div.style, {
    position: 'fixed', inset: '0', zIndex: '40', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10, 10, 18, 0.82)', color: '#f0f0f5',
    font: '15px system-ui, sans-serif', textAlign: 'center',
  });
  div.innerHTML = `
    <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
      padding:28px 40px; box-shadow:0 12px 40px rgba(0,0,0,.6);">${inner}</div>`;
  document.body.appendChild(div);
  return div;
}

// Escape a value before it is interpolated into an innerHTML template. Most of
// what these screens print is authored registry text, but `sheet.name` is not:
// it is about to become player-typed at character creation, and a name is
// rendered on the level-up card, the party bar and the résumé. Escaping at the
// interpolation site means the rule holds wherever the string came from, rather
// than depending on every future caller having sanitised it first.
// (moved to chrome.js so every ui/ module can reach it - see the note there)

const button = (id, label) =>
  `<button id="${id}" style="padding:10px 26px; border-radius:8px; border:1px solid #3a3a52;
    background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">${label}</button>`;

export function showWinScreen({ level, defeated }) {
  const div = overlay('win-screen', `
    <div style="font-size:26px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">YOU ESCAPED WORK</div>
    <div style="opacity:.85; margin-bottom:4px;">The parking garage has never smelled sweeter.</div>
    <div style="opacity:.7; margin-bottom:18px;">Level ${level} &middot; ${defeated} coworker${defeated === 1 ? '' : 's'} out-officed</div>
    ${button('again', 'Clock In Again')}`);
  div.querySelector('#again').onclick = () => location.reload();
}

export function showFloorClear({ nextName }, onNext) {
  const div = overlay('floor-clear', `
    <div style="font-size:24px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">FLOOR CLEAR</div>
    <div style="opacity:.85; margin-bottom:4px;">You take the stairs. Nobody takes the stairs. Smart.</div>
    <div style="opacity:.7; margin-bottom:18px;">Next: ${nextName}</div>
    ${button('next-floor', 'Keep Climbing')}`);
  div.querySelector('#next-floor').onclick = onNext;
}

export function showLoseScreen(message) {
  const div = overlay('lose-screen', `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">STUCK AT WORK</div>
    <div style="opacity:.85; margin-bottom:16px;">${message}</div>
    ${button('restart', 'Try Again')}`);
  div.querySelector('#restart').onclick = () => location.reload();
}

const LEVELUP_ATTRS = [
  { key: 'grit', label: 'Grit', blurb: 'Toughness — raises max HP.' },
  { key: 'hustle', label: 'Hustle', blurb: 'Tempo — raises max AP (move + actions).' },
  { key: 'savvy', label: 'Savvy', blurb: 'Precision — raises attack damage.' },
  { key: 'composure', label: 'Composure', blurb: 'Poise — softens incoming hits.' },
];

export function showLevelUpScreen(sheet, { onSpend, onLearn, nodesFor, onDone } = {}) {
  document.getElementById('levelup-screen')?.remove();
  const host = document.createElement('div');
  host.id = 'levelup-screen';
  Object.assign(host.style, {
    position: 'fixed', inset: '0', zIndex: '41', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10,10,18,.82)', color: '#f0f0f5', font: '14px system-ui, sans-serif',
  });
  host.onmousedown = (e) => e.stopPropagation();
  document.body.appendChild(host);

  function render() {
    const ap = sheet.attrPoints || 0;
    const cp = sheet.classPoints || 0;
    const nodes = nodesFor ? nodesFor() : [];
    const pending = ap + cp;
    host.innerHTML = `
      <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
        padding:22px 26px; min-width:380px; max-width:460px; max-height:86vh; overflow:auto;
        box-shadow:0 12px 40px rgba(0,0,0,.6);">
        <div style="font-weight:700; letter-spacing:1px; color:#8adf76;">LEVEL UP</div>
        <div style="opacity:.8; margin:2px 0 12px;">${esc(sheet.name)} · Level ${esc(sheet.level)}</div>
        <div style="font-size:12px; opacity:.75; margin-bottom:6px;">Attribute points:
          <b id="lvlup-points">${ap}</b></div>
        <div id="lvlup-rows" style="display:flex; flex-direction:column; gap:8px;"></div>
        <div style="margin-top:10px; opacity:.65; font-size:12px;">Derived: HP ${sheet.maxHp} · AP ${sheet.maxAp}</div>
        ${nodes.length ? `<div style="font-size:12px; opacity:.75; margin:16px 0 6px;
            border-top:1px solid #3a3a52; padding-top:12px;">Class points: <b id="lvlup-cp">${cp}</b></div>
          <div id="lvlup-track" style="display:flex; flex-direction:column; gap:6px;"></div>` : ''}
        <div style="margin-top:16px; text-align:right;">
          ${button('lvlup-done', pending > 0 ? 'Spend later' : 'Done')}</div>
      </div>`;
    const rows = host.querySelector('#lvlup-rows');
    for (const info of LEVELUP_ATTRS) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '7px 10px', borderRadius: '7px', background: '#2a2a3e',
      });
      row.innerHTML = `<div style="flex:1;">
        <div style="font-weight:600;">${esc(info.label)}
          <span style="opacity:.85;">${esc(sheet.attr?.[info.key] ?? 0)}</span></div>
        <div style="opacity:.6; font-size:12px;">${esc(info.blurb)}</div></div>`;
      const plus = document.createElement('button');
      plus.id = 'lvlup-attr-' + info.key;
      plus.textContent = '+';
      Object.assign(plus.style, BUTTON_CHROME, {
        width: '32px', height: '32px', borderRadius: '7px', fontSize: '19px', lineHeight: '1',
        opacity: ap > 0 ? '1' : '.4', cursor: ap > 0 ? 'pointer' : 'default',
      });
      plus.disabled = ap <= 0;
      plus.onclick = () => {
        if ((sheet.attrPoints || 0) <= 0) return;
        onSpend?.(info.key);
        render();
      };
      row.appendChild(plus);
      rows.appendChild(row);
    }
    const track = host.querySelector('#lvlup-track');
    if (track) {
      for (const n of nodes) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '6px 9px', borderRadius: '7px', background: '#2a2a3e',
          opacity: n.taken ? '.6' : '1',
        });
        row.innerHTML = `<div style="flex:1;">
          <div style="font-weight:600;">${esc(n.name)}</div>
          <div style="opacity:.6; font-size:12px;">${esc(n.desc)}</div></div>`;
        const btn = document.createElement('button');
        btn.id = 'lvlup-node-' + n.id;
        Object.assign(btn.style, BUTTON_CHROME, { padding: '5px 10px', borderRadius: '7px', fontSize: '12px' });
        if (n.taken) {
          btn.textContent = '✓ Taken';
        } else if (n.locked) {
          btn.textContent = 'Locked';
        } else if (!n.affordable) {
          btn.textContent = `Learn (${n.cost})`;
        } else {
          btn.textContent = `Learn (${n.cost})`;
          btn.onclick = () => { onLearn?.(n.id); render(); };
        }
        const actionable = !n.taken && !n.locked && n.affordable;
        btn.disabled = !actionable;
        btn.style.opacity = actionable ? '1' : '.45';
        btn.style.cursor = actionable ? 'pointer' : 'default';
        row.appendChild(btn);
        track.appendChild(row);
      }
    }
    host.querySelector('#lvlup-done').onclick = () => { host.remove(); onDone?.(); };
  }
  render();
  return { close: () => host.remove(), get open() { return !!document.getElementById('levelup-screen'); } };
}

// A read-only character sheet (toggle with C): attributes, the stats they
// derive, talent, and learned perks. main.js hands over a plain view-model
// (it owns the derived math); a "Spend points" button routes back to the
// level-up screen when points are banked.

// --- the desk -----------------------------------------------------------------
// A hiring-desk carousel: one resume at a time on the right, and the candidate
// themselves idling on the office floor to the left (main.js drives the 3D
// preview via onPreview). Arrows, dots, and arrow keys browse; the ACTIVE
// slide's button is #pick-<classId>, so muscle memory and tests address
// characters directly.
//
// The last card is not one of them. It is the CUSTOM door - a blank résumé for
// somebody who does not work here yet - and it sits alongside the six rather
// than behind them, because that is the actual choice: be one of these people,
// or be your own. It used to be neither: every card led into the same
// customization form, so the six could not be played as written and the seventh
// did not exist.
export const CUSTOM_ID = '__custom__';

export function showClassPicker(classes, actions, onPick, onEditor, onPreview) {
  // Only playable careers reach the desk - archetypes like the summoned
  // employee (playable: false) are units, not résumés (SUMMON_PLAN.md).
  const classIds = Object.keys(classes).filter((id) => classes[id].playable !== false);
  const ids = [...classIds, CUSTOM_ID];
  // Whose kit a custom character does. Starts on the first job and is changed
  // from the blank card itself, so the one thing a custom character MUST decide
  // is decided where it is asked.
  let customClass = classIds[0];
  let index = 0;

  const root = document.createElement('div');
  root.id = 'class-picker';
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '40', pointerEvents: 'none',
    color: '#f0f0f5', font: '15px system-ui, sans-serif',
  });
  // Dim hardest under the resume so the candidate stays lit on the left.
  const dim = document.createElement('div');
  Object.assign(dim.style, {
    position: 'absolute', inset: '0',
    background: 'linear-gradient(90deg, rgba(8,8,16,.28) 0%, rgba(8,8,16,.22) 46%, rgba(8,8,16,.8) 74%)',
  });
  root.appendChild(dim);

  // The picker owns the top of the screen: the game's HUD banner steps aside
  // until a class is hired.
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';

  const title = document.createElement('div');
  Object.assign(title.style, { position: 'absolute', top: '26px', left: '0', right: '0', textAlign: 'center' });
  title.innerHTML = `
    <div style="font-size:22px; font-weight:800; letter-spacing:2px;">CHOOSE YOUR CAREER MISTAKE</div>
    <div style="opacity:.8; margin-top:4px;">${classIds.length} r&eacute;sum&eacute;s on the desk, and one blank one.</div>`;
  root.appendChild(title);

  // Bottom-anchored so the nav and hire buttons never move between slides -
  // a taller resume grows upward instead of shifting the controls.
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', right: 'min(6vw, 84px)', bottom: '46px',
    width: '308px', pointerEvents: 'auto', textAlign: 'center',
  });
  root.appendChild(panel);

  const section = (t) =>
    `<div style="font:700 10px system-ui, sans-serif; letter-spacing:2px; color:#8a8577;
      border-bottom:1px solid #d8d2c2; padding-bottom:2px; margin:10px 0 5px;">${t}</div>`;
  // The résumé's talent line reads the REGISTRY now, not the class (TALENT_PLAN
  // M1). A class does not have a talent any more; what it has is a talent it
  // STARTS you with, which is a different sentence and a temporary one - when
  // the picker lands this becomes a choice made on this screen rather than a
  // fact printed on the card.
  const kitHtml = (cls, classId) => {
    const t = TALENTS[STARTING_TALENT_BY_CLASS[classId]];
    return `
      ${section('SKILLS')}
      <div style="line-height:1.55;">
        ${cls.actions.map((a) => '&bull; ' + esc(actions[a].label)).join('<br>')}
      </div>
      ${section('STARTING TALENT')}
      <div>${t ? `<b>${esc(t.name)}.</b> ${esc(t.blurb)}` : '&mdash;'}</div>`;
  };

  const resumeHtml = (id) => {
    if (id === CUSTOM_ID) {
      const cls = classes[customClass];
      // The blank one. It shows the KIT it would inherit, because that is the
      // only decision this card actually makes - the name and the body are
      // asked for on the next screen, where the 3D preview can answer back.
      return `
        <div style="font-size:17px; font-weight:700; letter-spacing:.5px;">&mdash;</div>
        <div style="font-size:11px; color:#8a8577; margin-top:2px;">Applying for: Former Employee</div>
        ${section('EXPERIENCE')}
        <div style="opacity:.75; font-style:italic;">Blank. You have not worked here.</div>
        ${section('DOING THE JOB OF')}
        <div id="custom-jobs" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:2px;"></div>
        ${kitHtml(cls, customClass)}
        <div style="position:absolute; top:10px; right:12px; font:700 9px system-ui, sans-serif;
          letter-spacing:1px; color:#8a8577; border:1px solid #8a8577; border-radius:2px;
          padding:2px 5px; transform:rotate(6deg); opacity:.85;">BLANK</div>`;
    }
    const cls = classes[id];
    return `
      <div style="font-size:17px; font-weight:700; letter-spacing:.5px;">${esc(cls.name)}</div>
      <div style="font-size:11px; color:#8a8577; margin-top:2px;">Applying for: Former Employee</div>
      ${section('EXPERIENCE')}
      <div>${esc(cls.experience)}</div>
      ${kitHtml(cls, id)}
      <div style="position:absolute; top:10px; right:12px; font:700 9px system-ui, sans-serif;
        letter-spacing:1px; color:#b0392e; border:1px solid #b0392e; border-radius:2px;
        padding:2px 5px; transform:rotate(6deg); opacity:.85;">CONFIDENTIAL</div>`;
  };

  const card = document.createElement('div');
  card.id = 'resume-card';
  Object.assign(card.style, {
    textAlign: 'left', background: '#f6f3ea', border: '1px solid #d8d2c2', borderRadius: '3px',
    padding: '18px 16px 14px', color: '#2b2a26', font: "13px Georgia, 'Times New Roman', serif",
    boxShadow: '0 10px 30px rgba(0,0,0,.55)', position: 'relative',
    // Every resume gets the same sheet of paper - roomy enough that longer
    // future write-ups still won't shove the controls around.
    minHeight: '360px', boxSizing: 'border-box',
  });
  panel.appendChild(card);

  const nav = document.createElement('div');
  Object.assign(nav.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '12px', margin: '12px 0 10px',
  });
  const navBtn = (id, label) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, BUTTON_CHROME, { padding: '6px 14px', borderRadius: '7px', fontSize: '15px' });
    return b;
  };
  const prev = navBtn('carousel-prev', '‹');
  const next = navBtn('carousel-next', '›');
  const dots = document.createElement('div');
  dots.id = 'carousel-dots';
  Object.assign(dots.style, { display: 'flex', gap: '7px' });
  nav.append(prev, dots, next);
  panel.appendChild(nav);

  const hire = document.createElement('button');
  Object.assign(hire.style, BUTTON_CHROME, {
    width: '100%', padding: '11px', borderRadius: '8px', fontWeight: '700',
    letterSpacing: '1px', borderColor: '#5a8a4e', background: '#31452c', fontSize: '13px',
  });
  panel.appendChild(hire);

  if (onEditor) {
    const ed = document.createElement('button');
    ed.id = 'open-editor';
    ed.textContent = 'or open the level editor';
    Object.assign(ed.style, {
      background: 'none', border: 'none', color: '#8a8ac0', marginTop: '12px',
      font: '12px system-ui, sans-serif', cursor: 'pointer', textDecoration: 'underline',
    });
    ed.onclick = () => { cleanup(); onEditor(); };
    panel.appendChild(ed);
  }

  function render() {
    const id = ids[index];
    const isCustom = id === CUSTOM_ID;
    card.innerHTML = resumeHtml(id);
    // The job chips on the blank card. Wired after innerHTML, which is what
    // replaced them.
    const jobs = card.querySelector('#custom-jobs');
    if (jobs) {
      for (const cid of classIds) {
        const b = document.createElement('button');
        b.id = `custom-job-${cid}`;
        b.type = 'button';
        b.textContent = classes[cid].name;
        const on = cid === customClass;
        Object.assign(b.style, {
          font: "10px Georgia, 'Times New Roman', serif", padding: '2px 6px', borderRadius: '3px',
          cursor: 'pointer', background: on ? '#2b2a26' : 'transparent',
          color: on ? '#f6f3ea' : '#2b2a26', border: '1px solid #8a8577',
        });
        b.onclick = () => { customClass = cid; render(); };
        jobs.appendChild(b);
      }
    }
    dots.innerHTML = '';
    ids.forEach((slideId, i) => {
      const d = document.createElement('button');
      Object.assign(d.style, {
        width: '9px', height: '9px', borderRadius: '50%', padding: '0', cursor: 'pointer',
        // The blank card's dot is outlined rather than filled - it is a
        // different KIND of card, not a seventh person.
        border: slideId === CUSTOM_ID ? '1px solid #8adf76' : 'none',
        background: i === index ? '#8adf76' : (slideId === CUSTOM_ID ? 'transparent' : '#4a4a66'),
      });
      d.onclick = () => { index = i; render(); };
      dots.appendChild(d);
    });
    hire.id = isCustom ? 'pick-custom' : `pick-${id}`;
    hire.dataset.class = isCustom ? customClass : id;
    hire.textContent = isCustom ? 'MAKE YOUR OWN' : `START AS ${classes[id].name.toUpperCase()}`;
    // The blank card previews the body a custom character starts on, not the
    // class's - you are not going to be that person.
    onPreview && onPreview(isCustom ? null : id);
  }
  const step = (d) => { index = (index + d + ids.length) % ids.length; render(); };
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  hire.onclick = () => {
    const id = ids[index];
    cleanup();
    if (id === CUSTOM_ID) onPick(customClass, { custom: true });
    else onPick(id);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Enter') hire.onclick();
  };
  window.addEventListener('keydown', onKey);
  function cleanup() {
    window.removeEventListener('keydown', onKey);
    if (hud) hud.style.display = '';
    root.remove();
  }

  document.body.appendChild(root);
  render();
}

// Always-available corner menu (restart the run, open the editor) - the class
// picker is skipped mid-campaign, so these need a home that is always there.
// `hints` (optional) are non-clickable shortcut reminders tucked below the
// actions, so the HUD itself stays clean.

export function showGameMenu(items, hints = null) {
  const btn = document.createElement('button');
  btn.id = 'game-menu-btn';
  btn.textContent = '☰';
  Object.assign(btn.style, {
    position: 'fixed', top: '12px', left: '12px', zIndex: '25',
    background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
    borderRadius: '7px', padding: '6px 10px', font: '14px system-ui, sans-serif',
    cursor: 'pointer',
  });
  const menu = document.createElement('div');
  menu.id = 'game-menu';
  Object.assign(menu.style, {
    position: 'fixed', top: '46px', left: '12px', zIndex: '25', display: 'none',
    minWidth: '160px', background: '#232334', color: '#f0f0f5',
    border: '1px solid #3a3a52', borderRadius: '7px', padding: '5px',
    font: '13px system-ui, sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
  });
  for (const it of items) {
    const row = document.createElement('div');
    row.id = it.id;
    row.textContent = it.label;
    Object.assign(row.style, { padding: '7px 11px', borderRadius: '5px', cursor: 'pointer' });
    row.onmouseenter = () => { row.style.background = '#34344f'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    row.onclick = () => { menu.style.display = 'none'; it.action(); };
    menu.appendChild(row);
  }
  // Shortcut reminders live here now, out of the HUD's way - a muted,
  // non-clickable block under a divider.
  if (hints && hints.length) {
    const divider = document.createElement('div');
    Object.assign(divider.style, { borderTop: '1px solid #3a3a52', margin: '5px 6px' });
    menu.appendChild(divider);
    const title = document.createElement('div');
    title.textContent = 'SHORTCUTS';
    Object.assign(title.style, {
      padding: '2px 11px 4px', font: '700 10px system-ui, sans-serif',
      letterSpacing: '1.5px', opacity: '.5',
    });
    menu.appendChild(title);
    for (const h of hints) {
      const row = document.createElement('div');
      row.textContent = h;
      Object.assign(row.style, {
        padding: '3px 11px', opacity: '.65', whiteSpace: 'nowrap', cursor: 'default',
      });
      menu.appendChild(row);
    }
  }
  btn.onclick = () => { menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; };
  window.addEventListener('mousedown', (e) => {
    if (e.target !== btn && !menu.contains(e.target)) menu.style.display = 'none';
  });
  document.body.appendChild(btn);
  document.body.appendChild(menu);
}

// Small corner badge shown while playtesting an editor level.

// The badge carries TWO actions now. It used to offer only "back to editor",
// which meant a stale playtest stash hijacked every boot with no way out that
// did not also destroy something: the stash sits at the top of the boot cascade,
// so the floor-select desk and its Continue button never rendered while one
// existed, and the only documented escape (Restart run) wiped the campaign save.
export function showPlaytestBadge(onBack, onLeave) {
  const wrap = document.createElement('div');
  wrap.id = 'playtest-badge-wrap';
  Object.assign(wrap.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '25',
    display: 'flex', gap: '6px', alignItems: 'center',
  });
  const chrome = {
    background: '#3a2e46', color: '#e8d8f5', border: '1px solid #6a5a80',
    borderRadius: '7px', padding: '7px 11px', font: '12px system-ui, sans-serif',
    cursor: 'pointer',
  };
  const b = document.createElement('button');
  b.id = 'playtest-badge';
  b.textContent = '⏸ PLAYTEST — back to editor';
  Object.assign(b.style, chrome);
  b.onclick = onBack;
  wrap.appendChild(b);
  if (onLeave) {
    const l = document.createElement('button');
    l.id = 'playtest-leave';
    l.textContent = '✕ Leave playtest';
    l.title = 'Drop the playtest level and boot your own run. Your campaign save is untouched.';
    Object.assign(l.style, chrome);
    l.onclick = onLeave;
    wrap.appendChild(l);
  }
  document.body.appendChild(wrap);
}
