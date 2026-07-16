// Turn-based combat - the Baldur's Gate moment, reskinned for office life.
// Fully data-driven: the player's buttons come from their character sheet's
// action list (data/actions.js), the enemy's behaviour from its type def
// (data/enemies.js). Mutates sheet.hp in place so wounds persist.
import { ACTIONS } from './data/actions.js';
import { showLoseScreen } from './ui.js';

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function startCombat({ enemyDef, sheet, onChange, onWin, onLose }) {
  const enemy = { hp: enemyDef.hp, max: enemyDef.hp };
  const usesLeft = {};
  for (const id of sheet.actions) {
    if (ACTIONS[id].uses) usesLeft[id] = ACTIONS[id].uses;
  }
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
  const actionButtons = sheet.actions
    .map((id) => `<button id="act-${id}" data-action="${id}">${ACTIONS[id].label}</button>`)
    .join('');
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:8px;">
      <div style="flex:1">
        <div style="margin-bottom:3px;">You <span id="hp-player-text"></span></div>
        <div style="height:8px; background:#171722; border-radius:4px; overflow:hidden;">
          <div id="hp-player-bar" style="height:100%; width:100%; background:#4dcc74;"></div>
        </div>
      </div>
      <div style="flex:1">
        <div style="margin-bottom:3px;">${enemyDef.name} <span id="hp-enemy-text"></span></div>
        <div style="height:8px; background:#171722; border-radius:4px; overflow:hidden;">
          <div id="hp-enemy-bar" style="height:100%; width:100%; background:#e05555;"></div>
        </div>
      </div>
    </div>
    <div id="combat-log" style="min-height:34px; opacity:.9; margin-bottom:9px;"></div>
    <div style="display:flex; gap:8px;">${actionButtons}</div>`;
  document.body.appendChild(panel);
  for (const b of panel.querySelectorAll('button')) {
    Object.assign(b.style, {
      flex: '1', padding: '9px 6px', borderRadius: '7px', border: '1px solid #3a3a52',
      background: '#2e2e46', color: '#f0f0f5', font: 'inherit', cursor: 'pointer',
    });
  }
  const el = (id) => panel.querySelector('#' + id);
  const buttons = [...panel.querySelectorAll('button[data-action]')];

  function refresh() {
    el('hp-player-text').textContent = `${sheet.hp}/${sheet.maxHp}`;
    el('hp-enemy-text').textContent = `${enemy.hp}/${enemy.max}`;
    el('hp-player-bar').style.width = (100 * sheet.hp) / sheet.maxHp + '%';
    el('hp-enemy-bar').style.width = (100 * enemy.hp) / enemy.max + '%';
    for (const b of buttons) {
      const id = b.dataset.action;
      if (ACTIONS[id].uses) b.textContent = `${ACTIONS[id].label} (${usesLeft[id]})`;
    }
    onChange && onChange();
  }
  function log(text) { el('combat-log').textContent = text; }
  function setEnabled(on) {
    for (const b of buttons) {
      const id = b.dataset.action;
      const spent = ACTIONS[id].uses && usesLeft[id] <= 0;
      const enabled = on && !spent;
      b.disabled = !enabled;
      b.style.opacity = enabled ? '1' : '.45';
      b.style.cursor = enabled ? 'pointer' : 'default';
    }
  }

  function win() {
    over = true;
    setEnabled(false);
    log(`${enemyDef.name} retreats to "circle back offline". You are victorious.`);
    setTimeout(() => { panel.remove(); onWin && onWin(); }, 1500);
  }
  function lose() {
    over = true;
    panel.remove();
    showLoseScreen(`${enemyDef.name} assigns you weekend on-call. Darkness falls.`);
    onLose && onLose();
  }

  function enemyTurn() {
    if (over) return;
    setTimeout(() => {
      if (over) return;
      const atk = enemyDef.attacks[rand(0, enemyDef.attacks.length - 1)];
      let dmg = rand(atk.min, atk.max);
      let line = atk.log;
      if (defending) {
        dmg = Math.ceil(dmg / 2);
        defending = false;
        line += ` You deflect - only ${dmg} damage.`;
      } else {
        line += ` ${dmg} damage.`;
      }
      sheet.hp = Math.max(0, sheet.hp - dmg);
      refresh();
      log(line);
      if (sheet.hp <= 0) { lose(); return; }
      setEnabled(true);
    }, 850);
  }

  function perform(id) {
    if (over) return;
    const def = ACTIONS[id];
    if (def.type === 'attack') {
      const dmg = rand(def.min, def.max) + (sheet.bonusDmg || 0);
      enemy.hp = Math.max(0, enemy.hp - dmg);
      refresh();
      log(`${def.log} ${dmg} damage!`);
      if (enemy.hp <= 0) { win(); return; }
    } else if (def.type === 'defend') {
      defending = true;
      log(def.log);
    } else if (def.type === 'heal') {
      if (usesLeft[id] <= 0) return;
      usesLeft[id] -= 1;
      sheet.hp = Math.min(sheet.maxHp, sheet.hp + def.amount);
      refresh();
      log(def.log);
    }
    setEnabled(false);
    enemyTurn();
  }

  for (const b of buttons) {
    b.onclick = () => { if (!b.disabled) perform(b.dataset.action); };
  }

  refresh();
  // Initiative roll, CRPG style.
  if (Math.random() < 0.5) {
    log('You seize the initiative. Your move.');
    setEnabled(true);
  } else {
    log(`${enemyDef.name} strikes first...`);
    setEnabled(false);
    enemyTurn();
  }
}
