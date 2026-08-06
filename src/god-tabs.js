// The bespoke World and Spawn tabs. They do not participate in the generic
// reflection renderer, so keeping their controls and status-picker state in
// the panel closure only braided two independent UI systems together.
import { ITEMS } from './data/items.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { COMPANIONS } from './data/companions.js';
import { STATUSES } from './data/statuses.js';
import { applyStatus, clearStatuses, statusList, severityFor } from './statuses.js';

export function createGodTabs({
  api, body, el, button, selectStyle, itemSelect, sectionTitle, readout,
  afterEdit, render, armPlace,
}) {
  // Kept here across re-renders so Apply -> inspect -> adjust does not reset
  // the selection to the first registry entry each time.
  const statusPick = { id: Object.keys(STATUSES)[0], dur: 3, res: 0 };

  function renderWorld() {
    body.append(sectionTitle('TIME'));
    const timeRow = el('div', {
      display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '6px',
    });
    const scales = [['Pause', 0], ['¼', 0.25], ['½', 0.5], ['1×', 1], ['2×', 2]];
    for (const [label, value] of scales) {
      const active = Math.abs(api.timeScale - value) < 1e-6;
      const control = button(label, () => { api.timeScale = value; render(); }, {
        flex: '1',
        minWidth: '46px',
        borderColor: active ? '#8adf76' : '#3a3a52',
        background: active ? '#31452c' : '#2e2e46',
      });
      control.id = `god-timescale-${value}`;
      timeRow.append(control);
    }
    body.append(timeRow);

    body.append(sectionTitle('READOUTS'));
    readout('timeScale', () => fmt(api.timeScale));
    readout('inCombat', () => String(api.inCombat));
    readout('gameOver', () => String(api.gameOver));
    readout('tiles burning', () => String(api.burningCount));

    if (api.doors.length) {
      body.append(sectionTitle('DOORS'));
      for (const door of api.doors) {
        const row = el('div', {
          display: 'flex', alignItems: 'center', gap: '7px', padding: '3px 2px',
          font: '11px system-ui',
        });
        row.append(el('div', { flex: '1' }, { textContent: door.key }));
        const box = el('input', { cursor: 'pointer' }, { type: 'checkbox', checked: door.open });
        box.onchange = () => api.setDoorOpen(door.key, box.checked);
        row.append(el('span', { opacity: '.6' }, { textContent: 'open' }), box);
        body.append(row);
      }
    }
  }

  function renderStatuses() {
    body.append(sectionTitle('STATUSES'));
    if (!api.player) {
      body.append(el('div', { opacity: '.55', font: '11px system-ui' }, {
        textContent: 'Needs a character - pick a class first.',
      }));
      return;
    }
    const row = el('div', {
      display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap',
    });
    const select = el('select', selectStyle());
    for (const id of Object.keys(STATUSES)) {
      select.append(el('option', null, {
        value: id,
        textContent: `${STATUSES[id].icon || ''} ${STATUSES[id].name}`,
      }));
    }
    select.id = 'god-status';
    select.value = statusPick.id;
    const duration = el('input', { ...numberStyle(), width: '52px' }, {
      type: 'number', min: '1', step: '1', value: String(statusPick.dur), title: 'Ticks / steps to apply',
    });
    const resist = el('input', { ...numberStyle(), width: '52px' }, {
      type: 'number', min: '0', step: '1', value: String(statusPick.res),
      title: "Composure's statusResist - shortens AND blunts a resistable status",
    });
    const severity = el('div', { font: '11px system-ui', opacity: '.7', minWidth: '96px' });
    const paintSeverity = () => {
      const value = severityFor(select.value, Number(resist.value) || 0);
      severity.textContent = STATUSES[select.value]?.resistable
        ? `severity ${value.toFixed(2)}` : 'not resistable';
    };
    const remember = () => {
      statusPick.id = select.value;
      statusPick.dur = Math.max(1, Number(duration.value) || 1);
      statusPick.res = Math.max(0, Number(resist.value) || 0);
    };
    select.onchange = () => { remember(); paintSeverity(); };
    duration.oninput = remember;
    resist.oninput = () => { remember(); paintSeverity(); };
    paintSeverity();
    const apply = button('Apply', () => {
      remember();
      applyStatus(api.player, statusPick.id, { duration: statusPick.dur }, statusPick.res);
      afterEdit();
      render();
    });
    apply.id = 'god-apply-status';
    row.append(select, duration, resist, apply,
      button('Clear all', () => { clearStatuses(api.player); afterEdit(); render(); }));
    body.append(row, severity);

    const live = statusList(api.player);
    body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '6px' }, {
      textContent: live.length
        ? live.map((status) => `${status.icon} ${status.name} ·${status.left}${status.sev < 1 ? ` ·${Math.round(status.sev * 100)}%` : ''}`).join('   ')
        : 'Nothing live.',
    }));
  }

  function renderSpawn() {
    renderStatuses();
    body.append(sectionTitle('SPAWN ENEMY'));
    const enemyRow = el('div', { display: 'flex', gap: '5px', marginBottom: '8px' });
    const enemySelect = el('select', selectStyle());
    for (const id of Object.keys(ENEMY_TYPES)) {
      enemySelect.append(el('option', null, { value: id, textContent: ENEMY_TYPES[id].name }));
    }
    enemyRow.append(enemySelect,
      button('At player', () => {
        const actor = api.playerActor;
        api.spawnEnemy(enemySelect.value, actor.x, actor.z);
        render();
      }),
      button('Click', () => armPlace(
        'spawn', enemySelect.value, `Click a tile to spawn ${ENEMY_TYPES[enemySelect.value].name}`,
      )));
    body.append(enemyRow);

    body.append(sectionTitle('ITEMS'));
    const itemRow = el('div', { display: 'flex', gap: '5px' });
    const item = itemSelect();
    itemRow.append(item,
      button('Give', () => { api.giveItem(item.value); render(); }),
      button('Drop (click)', () => armPlace(
        'drop', item.value, `Click a tile to drop ${ITEMS[item.value].name}`,
      )));
    body.append(itemRow);

    body.append(sectionTitle('PARTY'));
    const companionRow = el('div', { display: 'flex', gap: '5px' });
    const companion = el('select', selectStyle());
    for (const id of Object.keys(COMPANIONS)) {
      companion.append(el('option', null, {
        value: id, textContent: `${COMPANIONS[id].name} (${id})`,
      }));
    }
    const recruit = button('Recruit', () => { api.recruit(companion.value); render(); });
    recruit.id = 'god-recruit';
    companionRow.append(companion, recruit);
    body.append(companionRow);
    body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '4px' }, {
      textContent: 'Recruits the companion if they stand on this floor and the roster has room.',
    }));
    if (!api.player) {
      body.append(el('div', { opacity: '.55', font: '11px system-ui', marginTop: '6px' }, {
        textContent: 'Give needs a character - pick a class first.',
      }));
    }
  }

  return { renderWorld, renderSpawn };
}

const fmt = (value) => (typeof value === 'number'
  ? String(Math.round(value * 1000) / 1000) : String(value));
const numberStyle = () => ({
  width: '78px', padding: '3px 6px', borderRadius: '5px',
  border: '1px solid #3a3a52', background: '#1b1b2a',
  color: '#f0f0f5', font: '11px system-ui',
});
