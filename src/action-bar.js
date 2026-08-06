// PRESSING A SLOT: the tooltip, the press, and the instants that need a second
// click.
//
// A slice off `startCombat` (Q037). What the bar SAYS about a verb and what
// pressing it does, kept together because they answer the same question at two
// moments and must not disagree - a tip that promises a reach the press then
// refuses is worse than no tip.
//
// `actionTip` binds the shared action-tooltip.js presentation to the acting
// member. The unlock screen, exploration hotbar and combat bar therefore read
// the same authored `desc`; only live numbers (damage bonus, paper, uses left)
// vary with the character who would press it.
//
// The second click is the interesting rule: an instant that lands on YOU has no
// target to pick, so pressing it once arms it and pressing it again commits.
// That is what stops a stance or a self-buff from firing on the press that was
// meant to read its tooltip.
import { ACTIONS, arrivalLine } from './data/actions.js';
import { actionTooltip } from './action-tooltip.js';
import { aimsAtAlly, isControl, isFriendly, isMobility, isPull, isPurge, isStance, isZone } from './powers.js';
import { roundAp } from './stats.js';
import { applyStatus, hasStatus } from './statuses.js';
import { summonSpotProblem as spotProblem } from './summon-rules.js';
import { dist } from './tactics.js';

export function createActionBar(d) {
  // Bind the shared presentation to the acting member's live resources. The
  // unlock screen and exploration hotbar call the same formatter with their
  // own context; only this thin adapter is combat-specific.
  const actionTip = (id) => {
    const a = ACTIONS[id];
    if (!a) return '';
    return actionTooltip(id, {
      sheet: d.active.sheet,
      ammoCost: a.ammoCost ? d.ammoCostOf(id) : null,
      ammoRemaining: d.active.sheet.paper,
      usesLeft: a.uses ? d.active.usesLeft[id] : null,
    });
  };

  function pressAction(id) {
    if (d.phase !== 'player') return;
    const a = ACTIONS[id];
    if (!a) return;
    // Lowering an armed action must ALWAYS work, even once its slot has gone
    // unaffordable: spending your AP while a cone was armed used to disable the
    // only control that could unarm it, stranding you (the slot is inert, and
    // a ground click just re-tried the cone).
    if (d.armed === id) {
      d.cancelArmed();
      d.refresh();
      return;
    }
    const st = d.actionState(id);
    // Same rule the bar renders: unaffordable is uncommittable, except for the
    // one awaiting its confirm click. It still ANSWERS rather than doing
    // nothing - the slot stays pressable precisely so it can say why, which is
    // the bar's own rule and used to be lost the moment a button went dead.
    if (!st) return;
    if (!st.affordable && id !== d.pendingConfirm) { d.log(st.reason); return; }
    // ONE live slot at a time (designer, 2026-07-31): pressing a DIFFERENT
    // slot while one is up - armed, or awaiting its confirm - lowers what was
    // up and does nothing else; arming the new one takes a second, deliberate
    // press. Arming straight over the top is how the bar came to show two lit
    // buttons: an armed attack survived an instant's first press, so the
    // attack's target rings (a breakable partition included) kept painting
    // under a bar that read as Deflect Blame.
    if (d.armed || (d.pendingConfirm && d.pendingConfirm !== id)) {
      d.cancelArmed();
      d.refresh();
      return;
    }
    // Past the gate, the only confirm that can be pending is this slot's own.
    const wasPending = d.pendingConfirm;
    d.setPendingConfirm(null);
    if (a.type === 'attack' || a.type === 'shove' || a.type === 'summon' || a.type === 'cover'
      || isPull(a) || isFriendly(a) || isControl(a) || isZone(a) || isMobility(a) || isPurge(a)) {
      d.setArmed(id); // arm it; clicking a ringed target (or a spot) fires it
      d.hidePreview(); // aiming now - the movement trail yields to targets
      d.log(a.type === 'summon'
        ? `${a.label} armed. Click where they should report.`
        : a.type === 'cover'
          ? `${a.label} armed. Click something solid - or somebody brave.`
          : isPull(a)
          ? `${a.label} armed. Click a coworker dug in behind cover.`
          : isZone(a)
          ? `${a.label} armed. Click where it should land.`
          : isMobility(a) && !aimsAtAlly(a)
            ? `${a.label} armed. Click where you want to be.`
            : aimsAtAlly(a)
          // Naming the SIDE matters on the one verb that points the other way:
          // armed the same way an attack is, aimed at the opposite half of the
          // board, and nothing else on the bar behaves like that yet.
          ? `${a.label} armed. Click a teammate - or yourself.`
          : `${a.label} armed. Click a target.`);
      d.refresh();
    } else if (d.INSTANT_CONFIRM.has(a.type)) {
      // Instant self-actions (Deflect and stances) used to fire the moment you
      // touched the button - easy to spend a turn's AP by accident. First
      // press ARMS it, second press commits (right-click, or the button
      // again, backs out). Targeted actions already worked this way.
      if (wasPending !== id) {
        d.setPendingConfirm(id);
        d.log(`${a.label} - click again to confirm.`);
        d.refresh();
        return;
      }
      commitInstant(id, a);
    }
  }

  // The self-cast actions, once confirmed. Every branch re-checks AP: a
  // pending confirm survives the movement that happens between the two
  // clicks (arm Coffee, walk, confirm), so the button being enabled when it
  // was armed proves nothing about affordability NOW. Committing anyway drove
  // AP negative, and a negative AP wrecked refresh()'s pip repeat().
  function commitInstant(id, a) {
    if (d.active.ap < a.ap) { d.log('Not enough AP any more.'); d.refresh(); return; }
    if (a.type === 'defend') {
      if (hasStatus(d.active.sheet, 'deflecting')) { d.log('You are already deflecting. Save the AP.'); return; }
      d.active.ap = roundAp(d.active.ap - a.ap);
      applyStatus(d.active.sheet, 'deflecting');
      d.statusFxAt(d.active, 'deflecting');
      d.log(a.log);
      d.refresh();
    } else if (isStance(a)) {
      // A stance is the one action that spends nothing NOW and everything
      // later: it costs the AP up front and then sits on the reaction budget
      // until the holder's next turn. Re-taking one you already hold is a
      // refusal rather than a refresh, because the only thing it could buy is
      // a second reaction, and the round budget is what stops overwatch from
      // being a blender.
      if (d.watching.has(d.active)) { d.log('You are already holding that.'); return; }
      if (a.uses && d.active.usesLeft[id] <= 0) return;
      if (a.uses) d.active.usesLeft[id] -= 1;
      d.active.ap = roundAp(d.active.ap - a.ap);
      d.watching.set(d.active, id);
      const chip = a.mode === 'guard' ? 'guarding' : 'watching';
      applyStatus(d.active.sheet, chip);
      d.statusFxAt(d.active, chip);
      d.log(a.log);
      d.refresh();
    }
  }

  // --- targeted summoning -------------------------------------------------------
  // Post the role AT a spot you pick (Divinity-style placement) rather than
  // wherever the summoner happens to stand: arm the action, then click a tile
  // within `range` with a clear line to it. The employees take that tile and
  // the free tiles ringing outward from it, so a click into open floor puts
  // them exactly where you wanted them - flanking, or screening a corridor.
  // Why a spot is unusable, or null when it's good. Shared by the click and the
  // hover preview so the ring you see is the rule that runs.
  // The same ladder main.js runs out of combat - with the two legs a FIGHT owns
  // (the AP pool, the per-fight ration) supplied here and simply absent there.
  const summonSpotProblem = (a, tx, tz) => spotProblem(a, {
    ap: d.active.ap,
    usesLeft: d.active.usesLeft[d.armed],
    dist: d.distToTile(d.active, tx, tz),
    los: d.losToTile(d.active, tx, tz),
    hasRoomToStand: d.world.summonSpots(tx, tz, 1).length > 0,
    // The live headcount. main.js's out-of-combat twin has always passed this;
    // combat's did not, so the shared rule's cap leg was skipped in a fight -
    // the rings promised spots a maxed-out req could not fill, and the click
    // then blamed the FLOOR ("can't find a free desk") for a limit that is
    // about the roster. The module's own `room` - headcount still free, which
    // is the number its predicate is written against - not the arrivals count
    // `resolveSummon` acts on. The two go to zero together, so the ring says
    // the same thing either way; they are asked separately because they are
    // separate questions.
    room: d.summonRoomFor(d.active.actor, a),
  });
  function placeSummon(tx, tz) {
    const a = ACTIONS[d.armed];
    const problem = summonSpotProblem(a, tx, tz);
    if (problem) { d.log(problem); return; }
    const n = d.resolveSummon(d.active.actor, 'player', a, { x: tx, z: tz });
    if (n <= 0) { d.log('No room - the employees can\'t find a free desk there.'); return; }
    if (a.uses) d.active.usesLeft[d.armed] -= 1;
    d.active.ap = roundAp(d.active.ap - a.ap);
    d.active.actor.lunge(tx, tz);
    d.faceTarget(d.active, tx, tz); // you gesture at where you posted them
    d.log(`${a.log} ${arrivalLine(n)}`);
    d.disarm();
    d.refresh();
  }

  return { actionTip, pressAction, commitInstant, summonSpotProblem, placeSummon };
}
