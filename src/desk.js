// THE DESK: the floor-select menu the game opens on - Continue, the floor
// list, and the cloud save key.
//
// Lifted out of main.js whole (Q039). It is 160 lines of DOM with no game
// logic in it at all, and it sat at module scope above `startGame` reading and
// writing four of the module's own variables. Those four arrive as `d` now:
// the reads as plain values or getters, and the writes as named setters, so
// "the desk decided which level we are booting" is a call rather than an
// assignment from the top of a 4,500-line file.
const AGE_UNITS = [[86400e3, 'day'], [3600e3, 'hour'], [60e3, 'minute']];
function describeAge(stamp) {
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  const ms = Date.now() - stamp;
  if (ms < 60e3) return ' — just now';
  for (const [size, unit] of AGE_UNITS) {
    const n = Math.floor(ms / size);
    if (n >= 1) return ` — ${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return '';
}
export function showLevelMenu(d) {
  const overlay = document.createElement('div');
  overlay.id = 'level-menu';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: 60, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(4, 5, 12, 0.86)',
  });
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    background: '#171923', border: '1px solid #33364a', borderRadius: '12px',
    padding: '22px 26px', minWidth: '340px', color: '#d7d9e4',
    fontFamily: 'Georgia, serif', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
  });
  panel.innerHTML = '<div style="font-size:20px; margin-bottom:4px;">Escape Work</div>'
    + '<div style="font-size:13px; opacity:0.65; margin-bottom:14px;">Pick a floor to report to.</div>';
  const button = (id, label, sub, onPick) => {
    const b = document.createElement('button');
    b.id = id;
    Object.assign(b.style, {
      display: 'block', width: '100%', textAlign: 'left', margin: '6px 0',
      padding: '10px 12px', background: '#20233199', color: '#d7d9e4',
      border: '1px solid #3a3d52', borderRadius: '9px', cursor: 'pointer',
      fontFamily: 'inherit', fontSize: '15px',
    });
    b.innerHTML = label + (sub ? `<span style="display:block; font-size:12px; opacity:0.6;">${sub}</span>` : '');
    b.onmouseenter = () => { b.style.background = '#2a2e42'; };
    b.onmouseleave = () => { b.style.background = '#20233199'; };
    b.onclick = onPick;
    panel.appendChild(b);
    return b;
  };
  const boot = (fn) => { overlay.remove(); fn(); };
  if (d.restoredProgress) {
    button('level-continue', 'Continue the run',
      `${d.LEVELS[d.restoredProgress.levelId]?.name || d.restoredProgress.levelId} — this browser`
        + describeAge(d.restoredProgress.savedAt),
      () => boot(() => d.startGame(d.activeLevel)));
  }
  for (const [id, level] of Object.entries(d.LEVELS)) {
    button(`level-pick-${id}`, level.name || id,
      id === d.FIRST_LEVEL ? 'Start a fresh run' : (level.layers ? 'Dev — layered spike' : 'Standalone visit'),
      () => boot(() => {
        d.setActiveLevel(d.LEVELS[id]);
        d.setActiveLevelId(id);
        // Fresh start: a restored party must not walk into a hand-picked
        // floor. Off the campaign's first floor nothing writes progress -
        // the ?level= posture, chosen by click instead of URL.
        d.setRestoredProgress(null);
        d.setPlaytesting(id !== d.FIRST_LEVEL);
        d.startGame(d.activeLevel);
      }));
  }
  // The save key (shown only when the cloud is configured): a private phrase
  // that becomes this player's cloud identity - hashed locally, never sent
  // raw - so nobody else's device stomps their rows, and the same phrase on
  // another machine picks the same saves up. Changing it reboots the desk so
  // the cloud lookup below re-runs under the new identity.
  if (d.remote.enabled) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', gap: '6px', marginTop: '14px', paddingTop: '12px',
      borderTop: '1px solid #2b2e40', alignItems: 'center',
    });
    const input = document.createElement('input');
    input.id = 'save-key-input';
    input.type = 'password';
    input.placeholder = localStorage.getItem(d.SAVE_KEY_STORAGE)
      ? 'cloud save key is set — enter a new one to change it'
      : 'cloud save key (optional) — saves follow it anywhere';
    Object.assign(input.style, {
      flex: '1', padding: '8px 10px', background: '#12141d', color: '#d7d9e4',
      border: '1px solid #3a3d52', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
    });
    const set = document.createElement('button');
    set.id = 'save-key-set';
    set.textContent = 'Set';
    Object.assign(set.style, {
      padding: '8px 14px', background: '#20233199', color: '#d7d9e4', cursor: 'pointer',
      border: '1px solid #3a3d52', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
    });
    const apply = () => {
      try {
        const key = input.value.trim();
        // An empty Set with a key stored is a deliberate clearing - back to
        // this-browser-only saves. An empty Set with nothing stored is a no-op.
        if (key) localStorage.setItem(d.SAVE_KEY_STORAGE, key);
        else if (localStorage.getItem(d.SAVE_KEY_STORAGE)) localStorage.removeItem(d.SAVE_KEY_STORAGE);
        else return;
        location.reload();
      } catch { /* private mode: the key has nowhere to live */ }
    };
    set.onclick = apply;
    input.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    row.appendChild(input);
    row.appendChild(set);
    panel.appendChild(row);
  }
  // A cloud save can land after the desk is up: this device pushed a run
  // before, or the browser was rebuilt, or the phrase belongs to a run made
  // somewhere else entirely. Offer it as its own Continue; clicking banks it
  // locally and reboots through the restore path that already knows how to
  // rebuild a party.
  //
  // The pull runs whether or not there is a local save. It used to be gated on
  // `!restoredProgress`, which is what made the cloud copy invisible to the
  // one browser most likely to overwrite it (Q017).
  if (d.remote.enabled) {
    d.remote.pull().then((row) => {
      if (!row?.data || !document.getElementById('level-menu')) return;
      if (document.getElementById('level-continue-cloud')) return;
      // Validate with the BOOT path's own check before offering it. The
      // button banks the row and reloads, and boot then runs
      // `parseProgress` + `LEVELS[levelId]` over it - so a row this build
      // cannot read (an older save naming a level id since renamed) came back
      // to the desk with no error and no run booted, and clicking again did
      // the same thing forever (Q067). Asking the same two questions here
      // means the offer only appears when accepting it will work.
      const p = d.parseProgress(row.data);
      if (!p || !d.LEVELS[p.levelId]) return;
      // `updatedAt` is the row's own stamp and beats anything inside the save
      // blob; `savedAt` is the fallback for rows written before saves carried
      // one. And when a local run is ALSO on offer, the sub-label says what
      // taking this one costs - banking it is what replaces the local save,
      // and the player is the one choosing that.
      const age = describeAge(Date.parse(row.updatedAt) || p.savedAt);
      const b = button('level-continue-cloud',
        d.restoredProgress ? 'Continue the cloud run' : 'Continue the run',
        `${d.LEVELS[p.levelId].name || p.levelId} — your save key${age}`
          + (d.restoredProgress ? ' · replaces this browser\'s run' : ''),
        () => {
          // The reload used to sit OUTSIDE this try, so a browser that can
          // read but not write - quota gone, private mode - reloaded onto a
          // desk with nothing banked, the same loop by the other door. Say so
          // and stay put instead.
          try {
            localStorage.setItem(d.PROGRESS_KEY, JSON.stringify(row.data));
          } catch {
            d.ui.toast('This browser cannot store a save - the cloud run stays in the cloud.');
            return;
          }
          location.reload();
        });
      // Above the floor list, and BELOW the local Continue when there is one -
      // the run this browser is already in the middle of stays the top offer.
      panel.insertBefore(b, panel.children[d.restoredProgress ? 3 : 2] || null);
    });
  }
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
