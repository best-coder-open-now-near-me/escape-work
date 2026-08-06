import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnFlow } from '../../src/turn-flow.js';

test('a turn-start dot returns a killed borrowed coworker through the death seam', () => {
  const member = {
    isCharmed: true,
    sheet: { name: 'Borrowed Manager', hp: 1 },
    actor: { x: 2, z: 3, clearPath() {} },
  };
  const released = [];
  const flow = createTurnFlow({
    fx: { damageText() {} },
    hitFx() {},
    applyDamage(sheet, damage) {
      sheet.hp = Math.max(0, sheet.hp - damage);
      return sheet.hp <= 0;
    },
    releaseDeadCharm(m) { released.push(m); },
    log() {},
    refresh() {},
    livingParty: () => [],
    makeActive() {},
  });

  assert.equal(flow.applyTurnDot({ member }, 1), 'fell');
  assert.deepEqual(released, [member]);
  assert.equal(member.toppled, undefined, 'the borrowed player facade is returned, not left as a corpse');
});
