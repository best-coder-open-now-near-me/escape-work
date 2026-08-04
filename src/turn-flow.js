// WHOSE TURN IT IS, AND WHAT OPENING ONE COSTS.
//
// A slice off `startCombat` (Q037): pressing End Turn, taking a turn, steering
// inside a shared one, skipping a turn a body cannot use, and the dot the turn
// clock bills on the way in.
//
// The rule this cluster exists to protect is INITIATIVE_PLAN #2: under a shared
// turn, each member ends their OWN. The floor passes to the next holder still
// on it, and only when every holder has pressed theirs does initiative move on.
// One press must never skip a teammate who has not acted - the accidental
// group-skip the reference game was criticised for. With a single holder this
// is exactly the advance it always was, which is why the rule is easy to lose.
//
// `applyTurnDot` carries a second one worth keeping in view: burning to death at
// the TOP of your own turn moves the bindings off the corpse before passing the
// turn on. Without that, the HUD, the party bar and the post-combat leader all
// keep pointing at a downed member through the enemies' turns - and past a
// victory that lands in that window.
import { pronounsOf, capitalize, verb } from './creation.js';
import { hasStatus } from './statuses.js';

export function createTurnFlow(d) {
  // End Turn ends the STEERED member's turn - under a shared turn the floor
  // passes to the next member still holding it, and only when every holder
  // has pressed theirs does initiative move on (INITIATIVE_PLAN #2: each
  // member ends their own; one press must never skip a teammate who hasn't
  // acted - the accidental group-skip BG3 was criticised for). With a single
  // holder this is exactly the advance it always was.
  function endTurnPressed() {
    if (d.phase !== 'player') return;
    d.advanceTurn();
  }

  // --- what the turn engine asks this file ------------------------------------
  // turn-order.js owns the walk: advance, wrap into a round, skip anyone who
  // cannot act, spend a temp's contract, tick the turn clock. These are the
  // combat-side answers it calls out for - the ones that need a body, a panel
  // or the app, and so could never live in a pure module.

  // Somebody's turn opens for real: hand a member control (full AP and their
  // movement allowance), or arm the AI's working state for a unit. Under a
  // shared turn `held` is every member holding the floor - EACH gets a full
  // budget at the top (per-member AP predates spans; several members having
  // independent pools at once is why this line is a loop and nothing else
  // changed), and the first is steered.
  function takeTurn(s, held = [s]) {
    if (s.member) {
      for (const h of held) {
        h.member.ap = h.member.sheet.maxAp; // full AP at the top of your turn
        h.member.freeAp = d.freeMoveOf(h.member); // and the movement allowance, if any
      }
      d.makeActive(s.member);
      d.setPhase('player');
      // The turn is not SAID any more - the strip and the lit End Turn carry
      // it (character-start branch's de-duplication). The one exception is a
      // SHARED turn: the strip brackets the span visually, but this line is
      // the only TEXT naming the whole span at once, and the shared-turns
      // branch landed it without knowing the announcements were going.
      if (held.length > 1) {
        d.log(`Shared turn — ${held.map((h) => h.member.sheet.name).join(', ')}.`);
      }
      d.refresh();
      return;
    }
    d.setPhase('ai');
    d.setActing({ unit: s.unit, ap: s.unit.combat.ap, freeAp: d.freeMoveOf(s.unit), wait: 0.5 });
    d.refresh();
  }

  // The floor moved to another member of the open span - `finish` passing it
  // on when one member's turn ends, or a steer the player asked for (the party
  // bar, Tab, a body click - main.js routes them here in combat).
  function steerTo(s) {
    if (!s?.member) return;
    d.makeActive(s.member);
    d.log(`${s.member.sheet.name} has the floor.`);
    d.refresh();
  }

  // A turn spent incapacitated. A member simply loses it and play moves on; an
  // AI unit HOLDS the turn for a beat, so a dazed coworker visibly stands there
  // rather than being skipped between frames.
  function skipTurnFor(s) {
    d.log(skipTurnLine(s, d.slotCarrier(s)));
    if (s.member) {
      d.refresh();
      return 'advance';
    }
    d.setPhase('ai');
    d.setActing({ unit: s.unit, ap: 0, freeAp: 0, wait: 0.6 });
    d.refresh();
    return 'hold';
  }

  // A summon's turns ran out with the fight still on: it leaves mid-battle,
  // which is the cost of fielding temps. Dismissing an enemy-side one can empty
  // the enemy list - the engine re-reads the outcome on the next attempt, so
  // this only has to take the body off the board.
  function expireSummon(s) {
    // A BORROWED coworker is RETURNED, not dismissed. They share the lifetime
    // clock with summons - one clock, nothing to keep in step - but the endings
    // are opposites: a summon is destroyed, a colleague walks away.
    if (s.member?.isCharmed) {
      d.log(`The session drops. ${s.member.sheet.name} is theirs again.`);
      d.releaseCharm(s.member);
      return;
    }
    // The house voice was already they/them here; now it ASKS the character
    // rather than assuming, which is the whole point of storing the field.
    const w = pronounsOf(s.member?.sheet);
    d.log(`${d.slotName(s)}'s assignment ends. ${capitalize(w.subject)} `
      + `${verb(w, 'gather')} ${w.possessive} things and ${verb(w, 'go', 'es')}.`);
    d.dismissSummon(s.member || s.unit);
    d.refresh();
  }

  // The line for a turn spent incapacitated - stun reads differently from the
  // surprise it generalized.
  function skipTurnLine(s, carrier) {
    const name = s.member ? s.member.sheet.name : s.unit.def.name;
    if (hasStatus(carrier, 'stunned')) return `${name} is stuck in mandatory training. Attendance is taken.`;
    return `${name} is still grabbing their lanyard.`;
  }
  // Apply a turn-start dot (burning) to the slot's owner, with the popup and
  // the death handling. Returns 'fell' if it dropped them - the engine then
  // moves past the now-empty slot, re-reading the win/lose outcome as it opens
  // the next one - or 'stands' if the turn should proceed.
  function applyTurnDot(s, damage) {
    const actor = s.member ? s.member.actor : s.unit;
    d.hitFx(actor, 'fire');
    d.fx.damageText(actor.x, actor.z, `-${damage}`, '#ff7a3c');
    if (s.member) {
      const dead = d.applyDamage(s.member.sheet, damage);
      d.log(`${s.member.sheet.name} is on fire. -${damage}.`);
      if (!dead) { d.refresh(); return 'stands'; }
      s.member.toppled = true;
      s.member.actor.clearPath();
      s.member.actor.fx = { kind: 'death', t: 0 };
      // Burning to death at the top of your own turn: move the bindings off the
      // corpse before passing the turn on, or the HUD, the party bar and the
      // post-combat leader all keep pointing at a downed member through the
      // enemies' turns (and past a victory landing in that window).
      if (s.member === d.active && d.livingParty().length) d.makeActive(d.livingParty()[0]);
      return 'fell';
    }
    const died = s.unit.takeDamage(damage);
    d.log(`${s.unit.def.name} is on fire. -${damage}.`);
    if (!died) { d.refresh(); return 'stands'; }
    d.callbacks.onEnemyKilled(s.unit);
    return 'fell';
  }

  return {
    endTurnPressed,
    takeTurn,
    steerTo,
    skipTurnFor,
    expireSummon,
    skipTurnLine,
    applyTurnDot,
  };
}
