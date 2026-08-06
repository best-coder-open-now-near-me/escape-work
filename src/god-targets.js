// View-models for the reflective god panel. They describe what each tab may
// edit and which operations sit beside it; DOM construction stays in god.js.
import { isLivingMember } from './member-rules.js';

export function createGodTargets(api, { render, armPlace, rigInternals }) {
  function playerTargets() {
    const out = [];
    const party = api.party;
    if (!party) return [{ id: 'sheet', title: 'Character Sheet', note: 'Pick a class first.' }];

    out.push({
      id: 'purse',
      scope: 'purse',
      title: 'Petty Cash',
      obj: party,
      getObj: () => api.party,
      hide: new Set(['active']),
      setters: { cash: (n) => api.setCash(n) },
    });

    party.members.forEach((member, i) => {
      const active = i === party.active;
      const actions = [];
      if (!active && isLivingMember(member)) {
        actions.push({ label: 'Control', run: () => { api.switchTo(i); render(); } });
      }
      if (member.sheet.hp <= 0) {
        actions.push({ label: 'Revive (1 HP)', run: () => { api.reviveMember(i); render(); } });
      }
      out.push({
        id: active ? 'sheet' : `sheet-${i}`,
        scope: active ? 'sheet' : `sheet-${i}`,
        title: `${member.sheet.name}${active ? ' (active)' : ''}${member.sheet.hp <= 0 ? ' †' : ''}`,
        obj: member.sheet,
        getObj: active
          ? () => api.party?.members[api.party.active]?.sheet
          : () => api.party?.members[i]?.sheet,
        readOnly: new Set([
          'classId', 'companionId', 'className', 'model', 'xpNext', 'name', 'maxHp', 'maxAp',
        ]),
        special: active ? 'inventory' : null,
        actions,
      });
    });

    const actor = api.playerActor;
    if (actor?.entity) {
      out.push({
        id: 'body',
        scope: 'body',
        title: 'Body (position, speed)',
        obj: actor,
        getObj: () => api.playerActor,
        hide: rigInternals,
        readOnly: new Set(['x', 'z']),
        actions: [{
          label: 'Teleport (click a tile)',
          run: () => armPlace('teleport', null, 'Click a tile to teleport the player'),
        }],
      });
    }
    return out;
  }

  function enemyTargets() {
    return api.enemies.map((enemy, i) => ({
      id: `enemy-${i}`,
      scope: `enemy-${i}`,
      obj: enemy,
      // Identity, not index: removing a summon must not reattach a pin to the
      // next enemy that shifted into its old array slot.
      getObj: () => (api.enemies.includes(enemy) ? enemy : null),
      title: `${enemy.def.name} @ (${enemy.x}, ${enemy.z})${enemy.alive ? '' : ' †'}`,
      hide: rigInternals,
      readOnly: new Set(['x', 'z', 'typeId']),
      actions: [
        {
          label: 'Full heal',
          run: () => {
            enemy.hp = enemy.maxHp;
            api.combat?.refresh();
            render();
          },
        },
        { label: 'Kill', run: () => { if (enemy.alive) enemy.die(); render(); } },
      ],
    }));
  }

  function combatTargets() {
    const combat = api.combat;
    if (!combat) return [{ id: 'combat', title: 'Combat', note: 'No fight in progress.' }];
    const out = [{
      id: 'combat',
      scope: 'combat',
      title: 'Combat',
      obj: combat,
      getObj: () => api.combat,
      readOnly: new Set(['phase', 'armed', 'maxAp']),
    }];
    if (combat.usesLeft && Object.keys(combat.usesLeft).length) {
      out.push({ id: 'uses', title: 'Action uses left', usesEditor: combat });
    }
    return out;
  }

  return { playerTargets, enemyTargets, combatTargets };
}
