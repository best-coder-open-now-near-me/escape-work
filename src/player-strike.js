// ONE PLAYER SWING, AND WHAT IT DID TO WHOEVER TOOK IT.
//
// A slice off `startCombat` (Q037): the strike a player verb lands, and the
// victim facade that lets one resolver treat a coworker, a summon and a party
// member alike.
//
// `victimView` is the whole reason this is one function instead of three. A
// party member counts HP on a sheet, an AI unit counts it on itself, and a
// summon is a member that leaves rather than dies - so the resolver asks the
// view for `hurt`, `onDeath` and a name, and never branches on what it hit.
//
// Two parameters in here were named `d`, which is the deps bag's name; they are
// `dmg` now. That is the shadow trap documented in tools/check-extractions.mjs,
// and it is the same one that silently broke every out-of-combat status dot in
// floor-effects.js earlier - a `d.applyDamage` resolving against a NUMBER.
import { posOf } from './combat-geometry.js';
import { ACTIONS } from './data/actions.js';
import { MISS_COLOR } from './hit-resolution.js';
import { applyDamage, damageBonus, equippedAction, rangeOf, roundAp, weaponProc } from './stats.js';
import { applyStatus, blockedBy, clearStatuses, hasStatus, statusFx, statusList } from './statuses.js';

export function createPlayerStrike(d) {
  // --- player actions ------------------------------------------------------------
  function performOn(id, en) {
    const a = ACTIONS[id];
    // Footwork actions (the kick) need an un-gummed shoe.
    if (a.footwork && statusFx(d.active.sheet).noFootwork) {
      d.log('You wind up the kick... the gum disagrees. Pick something else.');
      d.disarm();
      d.refresh();
      return;
    }
    // Rationed attacks (Detain) are rationed HERE too, not only on heals and
    // summons: the button gate alone left the counter frozen, so Detain fired
    // as often as the AP allowed while its tooltip went on promising "2 of 2
    // uses left this fight" forever.
    if (a.uses && d.active.usesLeft[id] <= 0) {
      d.log(`No ${a.label.toLowerCase()} left this fight.`);
      d.disarm();
      d.refresh();
      return;
    }
    // A DICE-LESS PURGE with nothing to clear does nothing, so it costs
    // nothing. The friendly twin of this verb has always refused for free
    // (powers.emptyPayload, "Nothing to clear - they are running clean") while
    // the same verb aimed at a coworker billed its AP and narrated a success -
    // the player was told Reboot worked, watched nothing change, and was down
    // two AP. Only the dice-less case: a verb that also swings has a swing to
    // pay for whether or not the purge finds anything.
    if (a.purge && !Number.isFinite(a.min) && !statusList(en).length) {
      d.log('Nothing to clear - they are running clean.');
      d.disarm();
      d.refresh();
      return;
    }
    d.joinCombat(en); // attacking a bystander drags them into the fight
    // Spend the cost first: a miss still burns the AP, the paper and the use
    // (HIT_PLAN #4 - a swing that happened is spent whether or not it landed).
    // The projectile/lunge also fires either way.
    // A ranged attack flies; a melee one lunges. Keyed off rangeOf rather than
    // `ammoCost`, or a staple gun would lunge its owner across four desks into
    // the target's face - the exact thing holding a ranged weapon is for.
    if (rangeOf(id)) {
      if (a.ammoCost) d.active.sheet.paper -= d.ammoCostOf(id);
      // The action says what it looks like in flight; the default is a fired
      // pellet, flat and quick, and anything that spends paper is lobbed.
      const flight = a.flight || (a.ammoCost ? 'ball' : 'shot');
      // Body to body, like hitFx: the shot departs the shooter's actual
      // stance and lands on the target's, not on their tile centres - the
      // walk-up just stopped at a trimmed free point, and a ball spawning
      // half a tile beside the model gives the grid away.
      d.fx.projectile(posOf(d.active), posOf(en), flight);
    } else {
      d.active.actor.lunge(posOf(en).x, posOf(en).z);
    }
    d.faceTarget(d.active, en.x, en.z); // you face what you swing at
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    // The attack roll: a miss spends the cost above and does nothing else - no
    // damage, no purge, no rider. Surprise, the attacker's accMod, the
    // target's dodgeMod (and later, position) are assembled by attackMods.
    if (!d.rollAgainst(d.active, en)) {
      d.hitFx(en, 'whiff');
      d.fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
      d.log(a.missLog || `${a.log} It misses.`);
      d.disarm();
      d.refresh();
      return;
    }
    // AN ACTION WITH NO DICE IS A PURE EFFECT. Reboot is the case that forced
    // the rule: power-cycling somebody strips their statuses, it does not
    // bruise them, and the entry used to carry 4-7 damage that contradicted its
    // own description. Rolling `rand(undefined, undefined)` here produced NaN,
    // and NaN damage made hp NaN - never `<= 0`, so the target became
    // unkillable and the fight could not end. Reading the dice as the SIGNAL
    // means a dice-less verb resolves as what it is, rather than being a
    // special case bolted on beside a damage step it never wanted.
    const hasDice = Number.isFinite(a.min) && Number.isFinite(a.max);
    let dmg = 0;
    let died = false;
    if (hasDice) {
      dmg = d.rand(a.min, a.max) + damageBonus(d.active.sheet); // carried staplers count
      if (a.ammoCost) dmg += d.talentFxOf(d.active).paperDamageBonus || 0;
      dmg = d.ambushDmg(dmg);
      died = en.takeDamage(dmg);
      // Anything that arrived from over there lands as a projectile hit, not a
      // punch: light debris thrown away from the shooter.
      d.hitFx(en, rangeOf(id) ? 'paper' : 'melee', d.active);
      if (died) d.deathFx(en);
      d.fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b', { big: died });
    }
    let line = hasDice ? `${a.log} ${dmg} damage!` : a.log;
    // A purge (reboot) wipes the target's statuses - good and bad alike.
    if (a.purge && !died) {
      const woke = hasStatus(en, 'surprised');
      clearStatuses(en);
      d.syncUnitSpeed(en); // the gum goes with it, and so does the limp
      if (woke) line += ' Their surprise is power-cycled away.';
    }
    // A status the action carries lands on a live target (enemies have no
    // Composure, so no resist). This is the player-action `applies` vector.
    // A window read BEFORE the apply, so a stun Detain can't land is narrated
    // rather than swallowed - checking after would see the window this very
    // application just granted.
    if (a.applies && !died) {
      const blocked = blockedBy(en, a.applies);
      if (applyStatus(en, a.applies)) {
        d.statusFxAt(en, a.applies);
        line += ` ${d.appliesLine(a, en.def.name)}`;
      } else if (blocked) line += ` ${d.immunityLine(blocked, en.def.name)}`;
    }
    // The equipped weapon's on-hit proc - but only when this attack IS that
    // weapon's own swing (swing the gum stapler, fling gum).
    const proc = weaponProc(d.active.sheet);
    if (proc && !died && id === equippedAction(d.active.sheet)
      && d.resolveProc(proc.chance) && applyStatus(en, proc.applies)) {
      d.statusFxAt(en, proc.applies);
      line += ` ${d.appliesLine(proc, en.def.name)}`;
    }
    d.log(line);
    if (died) d.callbacks.onEnemyKilled(en);
    d.disarm(); // back to movement mode after the swing
    d.refresh();
    if (!d.hostilesRemain()) d.victory();
  }

  // --- displacement, shared (POWERS_PLAN M2) -------------------------------
  // Push a body one tile along (dx, dz): onto whatever is behind them, or into
  // the solid thing that stops them. Lifted out of the shove so a `control`
  // carrying `displace` moves people by EXACTLY the same rules - the shove's
  // occupancy check, its wall-slam, its surface damage and its anti-chain
  // narration were a paragraph of behaviour trapped inside one click handler,
  // and a second verb that moved bodies would otherwise have grown a second,
  // subtly different copy of all of it.
  //
  // Returns { slammed, died, msg }; the caller logs. It does NOT spend AP or
  // clear `armed` - displacement is a consequence, not an action.
  // Who is being displaced, as ONE shape. A shove lands on a coworker or on a
  // party member, and the two are structurally different - a coworker takes
  // damage on itself, a member takes it on a sheet - which is the whole reason
  // there used to be two resolvers (Q4-A, designer 2026-08-02). The rules are
  // identical; only these six accessors differ.
  function victimView(v) {
    if (v && v.sheet) {                       // a party member
      return {
        member: true, ref: v, body: v.actor, name: v.sheet.name,
        get x() { return v.actor.x; },
        get z() { return v.actor.z; },
        hurt: (dmg) => applyDamage(v.sheet, dmg),
        // Q1-A: a forced landing honours the victim's own talents, exactly as
        // walking onto the tile does. The enemy model consults none.
        hazardAt: (x, z) => d.world.memberSurfDamage(v.sheet, x, z),
        statusTarget: v.sheet,
        onDeath: () => d.notifyMemberDown(),
        dmgColor: undefined,
      };
    }
    return {                                   // a coworker
      member: false, ref: v, body: v, name: v.def.name,
      get x() { return v.x; },
      get z() { return v.z; },
      hurt: (dmg) => v.takeDamage(dmg),
      hazardAt: (x, z) => d.world.enemySurfDamage(x, z),
      statusTarget: v,
      onDeath: () => { d.deathFx(v); d.callbacks.onEnemyKilled(v); },
      dmgColor: '#ffd76b',
    };
  }

  return { performOn, victimView };
}
