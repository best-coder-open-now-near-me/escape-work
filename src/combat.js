// Turn-based combat - the Baldur's Gate moment, reskinned for office life.
// Self-contained: builds its own HTML overlay, runs the fight, and reports the
// result through onWin/onLose. Pure DOM, no PlayCanvas dependency.
//
// `playerState` is the shared, persistent character sheet owned by main.js
// ({ hp, maxHp, bonusDmg, ... }); combat mutates hp in place so wounds carry
// over between fights. Coffee is per-fight.

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const ENEMY_ATTACKS = [
  '%s schedules a "quick sync".',
  '%s asks for "just one more thing".',
  '%s CCs your skip-level.',
  '"Per my last email..."',
];

export function startCombat({ enemyName = 'The Manager', enemyHp = 16, playerState, onChange, onWin, onLose } = {}) {
  const player = playerState;
  const enemy = { hp: enemyHp, max: enemyHp };
  let coffee = 3;
  let defending = false;
  let over = false;

  const panel = document.createElement('div');
  panel.id = 'combat-panel';
  Object.assign(panel.style, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
    zIndex: '30', width: 'min(560px, 92vw)', background: '#232334',
    border: '1px solid #3a3a52', borderRadius: '10px', padding: '12px 14px',
    color: '#f0f0f5', font: '13px system-ui, sans-serif', userSelect: 'none',
    boxShadow: '0 10px 30px rgba(0,0,0,.5)',
  });
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:8px;">
      <div style="flex:1">
        <div style="margin-bottom:3px;">You <span id="hp-player-text"></span></div>
        <div style="height:8px; background:#171722; border-radius:4px; overflow:hidden;">
          <div id="hp-player-bar" style="height:100%; width:100%; background:#4dcc74;"></div>
        </div>
      </div>
      <div style="flex:1">
        <div style="margin-bottom:3px;">${enemyName} <span id="hp-enemy-text"></span></div>
        <div style="height:8px; background:#171722; border-radius:4px; overflow:hidden;">
          <div id="hp-enemy-bar" style="height:100%; width:100%; background:#e05555;"></div>
        </div>
      </div>
    </div>
    <div id="combat-log" style="min-height:34px; opacity:.9; margin-bottom:9px;"></div>
    <div style="display:flex; gap:8px;">
      <button id="act-attack">Passive-Aggressive Email</button>
      <button id="act-defend">Deflect Blame</button>
      <button id="act-coffee">Coffee Break (3)</button>
    </div>`;
  document.body.appendChild(panel);
  for (const b of panel.querySelectorAll('button')) {
    Object.assign(b.style, {
      flex: '1', padding: '9px 6px', borderRadius: '7px', border: '1px solid #3a3a52',
      background: '#2e2e46', color: '#f0f0f5', font: 'inherit', cursor: 'pointer',
    });
  }
  const el = (id) => panel.querySelector('#' + id);
  const buttons = ['act-attack', 'act-defend', 'act-coffee'].map(el);

  function refresh() {
    el('hp-player-text').textContent = `${player.hp}/${player.maxHp}`;
    el('hp-enemy-text').textContent = `${enemy.hp}/${enemy.max}`;
    el('hp-player-bar').style.width = (100 * player.hp) / player.maxHp + '%';
    el('hp-enemy-bar').style.width = (100 * enemy.hp) / enemy.max + '%';
    el('act-coffee').textContent = `Coffee Break (${coffee})`;
    onChange && onChange();
  }
  function log(text) { el('combat-log').textContent = text; }
  function setEnabled(on) {
    for (const b of buttons) {
      b.disabled = !on;
      b.style.opacity = on ? '1' : '.45';
      b.style.cursor = on ? 'pointer' : 'default';
    }
    if (on && coffee <= 0) {
      el('act-coffee').disabled = true;
      el('act-coffee').style.opacity = '.45';
    }
  }

  function win() {
    over = true;
    setEnabled(false);
    log(`${enemyName} retreats to "circle back offline". You are victorious.`);
    setTimeout(() => { panel.remove(); onWin && onWin(); }, 1500);
  }
  function lose() {
    over = true;
    panel.innerHTML = `
      <div style="text-align:center; padding:10px 0;">
        <div style="font-size:17px; font-weight:700; margin-bottom:6px;">STUCK AT WORK</div>
        <div style="opacity:.85; margin-bottom:12px;">${enemyName} assigns you weekend on-call. Darkness falls.</div>
        <button id="restart" style="padding:9px 22px; border-radius:7px; border:1px solid #3a3a52;
          background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">Try Again</button>
      </div>`;
    panel.querySelector('#restart').onclick = () => location.reload();
    onLose && onLose();
  }

  function enemyTurn() {
    if (over) return;
    setTimeout(() => {
      if (over) return;
      let dmg = rand(2, 4);
      let line = ENEMY_ATTACKS[rand(0, ENEMY_ATTACKS.length - 1)].replace('%s', enemyName);
      if (defending) {
        dmg = Math.ceil(dmg / 2);
        defending = false;
        line += ` You deflect - only ${dmg} damage.`;
      } else {
        line += ` ${dmg} damage.`;
      }
      player.hp = Math.max(0, player.hp - dmg);
      refresh();
      log(line);
      if (player.hp <= 0) { lose(); return; }
      setEnabled(true);
    }, 850);
  }

  el('act-attack').onclick = () => {
    if (over || el('act-attack').disabled) return;
    const dmg = rand(3, 5) + (player.bonusDmg || 0);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    refresh();
    log(`You send a passive-aggressive email. ${dmg} damage!`);
    if (enemy.hp <= 0) { win(); return; }
    setEnabled(false);
    enemyTurn();
  };
  el('act-defend').onclick = () => {
    if (over || el('act-defend').disabled) return;
    defending = true;
    log('You pre-emptively deflect blame. Incoming damage halved.');
    setEnabled(false);
    enemyTurn();
  };
  el('act-coffee').onclick = () => {
    if (over || el('act-coffee').disabled || coffee <= 0) return;
    coffee -= 1;
    player.hp = Math.min(player.maxHp, player.hp + 6);
    refresh();
    log('You chug lukewarm coffee. +6 HP.');
    setEnabled(false);
    enemyTurn();
  };

  refresh();
  // Initiative roll, CRPG style.
  if (Math.random() < 0.5) {
    log('You seize the initiative. Your move.');
    setEnabled(true);
  } else {
    log(`${enemyName} strikes first...`);
    setEnabled(false);
    enemyTurn();
  }
}
