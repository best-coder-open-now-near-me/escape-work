// Actors: things that live on the grid and own a 3D entity. GridActor handles
// the shared mechanics (following smoothed any-angle waypoint paths at a
// continuous position, a logical tile derived from that position, straight
// slides for shoves, eased turning) plus two animation layers that can't
// fight the movement code or each other: baked skeletal clips
// (idle/walk/attack, wired up in models.js) play on the bones, while a
// procedural layer on the model child adds the attack lunge push, hit
// flinches and death topples. EnemyActor adds wander AI on top. New actor
// kinds extend GridActor the same way.
import { rollLoot } from './data/items.js';
import { unitCombat } from './stats.js';
import { applyStatus, hasStatus, statusFx, tickStep } from './statuses.js';
import { slips, speedUnderStatus, surfaceEffect } from './step-rules.js';
import { cloneMaterials, tintMaterials } from './models.js';

// The engine handle, resolved LAZILY rather than read at module scope.
//
// `const pc = window.pc` ran on import, which meant this module could not be
// imported at all without a browser - so the movement state machine, the one
// piece of logic here that is pure arithmetic over a path, had no way to be
// unit-tested. Nothing about it needs a renderer; it just lived next to code
// that did. Reading through a function defers the dependency to the first call
// that genuinely needs the engine, so `node --test` can import this and drive
// the path logic while the rendering half simply never runs.
const pcRuntime = () => globalThis.window?.pc;

// Radians to degrees. Spelled out rather than reached for through the engine
// (`pc.math.RAD_TO_DEG`): it is a mathematical constant, not a renderer
// service, and reading it off the engine was one of the things keeping the
// facing arithmetic from being testable without a browser.
const RAD_TO_DEG = 180 / Math.PI;

const wrapAngle = (a) => (((a + 180) % 360) + 360) % 360 - 180;
const TURN_RATE = 10; // how quickly facing eases toward the heading
const FLASH_COLOR = [0.75, 0.09, 0.05];
// Built on first use for the same reason: a module-scope `new pc.Quat()` is an
// engine call at import time.
let _settleQuat = null;
const settleQuat = () => (_settleQuat ||= new (pcRuntime().Quat)());

export class GridActor {
  constructor(x, z, { speed = 2.2 } = {}) {
    this.x = x; // logical tile - tracked from the continuous position
    this.z = z;
    this.speed = speed;
    this.entity = null;
    this.visual = null; // the model child that animation moves
    this.visualLift = 0; // baseline y of the visual (proportion foot lift)
    this.path = null; // waypoints [[x, z], ...] - free points, not just centres
    this.pathIndex = 0;
    this.slideTo = null; // straight-line glide target (shoves) - {x, z}
    this.onTile = null; // optional (x, z, pathDone, changed) per-tile hook
    this.yaw = 0;
    this.targetYaw = 0;
    // animation state
    this.animC = null; // anim component driving the baked clips
    this.clip = null; // current clip state name
    this.legSettle = null; // { t, l, r } ease from the stop pose into stance
    this.fx = null; // { kind: 'lunge'|'flinch'|'death', t }
    this.crouched = false; // held take-cover pose (TACTICS_PLAN M6) - combat/main set it
    this.crouchK = 0; // eased 0..1 toward `crouched`, so the tuck reads as motion
    this.flashT = 0;
    this.mats = []; // per-instance cloned materials (for damage flashes)
  }

  attach(entity) {
    this.entity = entity;
    this.visual = entity.children[0] || entity;
    // applyCharacterProportions lifts the visual so the stretched legs keep
    // the feet on the floor. updateAnim rewrites the visual's position every
    // frame, so capture that lift as the baseline it composes onto - zeroing
    // it would sink the feet through the floor.
    this.visualLift = this.visual.getLocalPosition().y;
    this.animC = entity.findComponent('anim') || null;
    // The idle clip animates only torso/arms/head - it has NO leg channels,
    // so nothing ever writes the legs back after a walk stops mid-stride.
    // updateAnim eases these home manually whenever we're idling.
    this.legL = entity.findByName('leg-left');
    this.legR = entity.findByName('leg-right');
    this.yaw = this.targetYaw = entity.getEulerAngles().y;
    // Clone materials so damage flashes and tints hit THIS character, not every
    // character instantiated from the same .glb. Shared with the picker preview
    // (models.js), which has no actor but needs the identical rule.
    this.mats = cloneMaterials(entity);
  }

  // Tint this character's own materials. Must run AFTER attach(), which clones
  // the .glb's shared materials per instance - tinting before the clone would
  // recolour every character built from the same rig. Emissive is left alone so
  // the damage flash still works.
  //
  // The multiply reads the PRISTINE diffuse, not whatever the material is
  // currently holding. Multiplying the live value compounds: re-tinting an
  // already-tinted body multiplies again, so clicking along a row of swatches
  // walks it toward black instead of between colours. `attach` already keeps a
  // per-instance baseline for this exact reason on the emissive channel; the
  // diffuse now gets the same treatment, which is what lets a live swatch row
  // drive this safely. Passing no rgb RESTORES the untinted body rather than
  // doing nothing, so "none" is a reachable choice rather than a dead end.
  applyTint(rgb) {
    tintMaterials(this.mats, rgb);
  }

  faceToward(tx, tz) {
    this.targetYaw = Math.atan2(tx - this.x, tz - this.z) * RAD_TO_DEG;
  }

  // Ease the model's facing toward targetYaw - no more snap turns.
  easeYaw(dt) {
    if (!this.entity) return;
    this.yaw += wrapAngle(this.targetYaw - this.yaw) * Math.min(1, dt * TURN_RATE);
    this.entity.setEulerAngles(0, this.yaw, 0);
  }

  // --- animation triggers ------------------------------------------------------
  lunge(tx, tz) {
    if (this.fx?.kind === 'death' || this.fx?.kind === 'corpse') return;
    if (tx !== undefined) this.faceToward(tx, tz);
    this.fx = { kind: 'lunge', t: 0 };
  }

  flinch() {
    if (this.fx?.kind === 'death' || this.fx?.kind === 'corpse') return;
    this.fx = { kind: 'flinch', t: 0 };
    this.flashT = 0.16;
    for (const { mat } of this.mats) {
      mat.emissive.set(FLASH_COLOR[0], FLASH_COLOR[1], FLASH_COLOR[2]);
      mat.update();
    }
  }

  // Switch the skeletal clip (states assigned in models.js setupAnim). The
  // procedural fx layer rides on the visual node above the bones, so clips
  // and fx compose instead of fighting.
  setClip(name, blend = 0.15, speed = 1) {
    if (!this.animC) return;
    this.animC.speed = speed;
    if (this.clip === name) return;
    this.clip = name;
    this.animC.baseLayer.transition(name, blend);
  }

  // Drives the clips and the visual child each frame. `moved` is world
  // distance covered this frame - it picks walk vs idle and paces the walk
  // cycle to actual movement speed.
  updateAnim(dt, moved) {
    if (!this.visual) return;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        for (const { mat, emissive } of this.mats) {
          mat.emissive.copy(emissive);
          mat.update();
        }
      }
    }
    // Death ends the skeleton, not just the clip. A corpse used to be switched
    // to 'idle', so a body lying on its back went on breathing and shifting its
    // weight forever. Disabling the anim component stops it writing bones at
    // all, freezing the pose it fell in - the procedural topple below still
    // plays, because that rides the visual node above the bones. Re-enabled the
    // moment `fx` is cleared, which is how a downed member comes back up
    // (main.js's post-victory revive).
    const gone = this.fx?.kind === 'death' || this.fx?.kind === 'corpse';
    if (this.animC && this.animC.enabled === gone) {
      this.animC.enabled = !gone;
      this.clip = null; // whatever it was mid-blend, re-enter the state cleanly
    }
    if (gone) {
      // No clip, and no leg settle either - both write bones, and the dead
      // hold whatever pose they landed in.
      this.legSettle = null;
    } else if (this.fx?.kind === 'lunge') this.setClip('attack-melee-right', 0.05, 1.3);
    // 0.25 paces the 0.667s walk clip for the STRETCHED legs (models.js):
    // the de-chibi'd stride covers roughly twice the ground, so the cycle
    // runs at half the cadence the stubby rig wanted. Higher rates read as
    // leg-whipping ("twitchy") - most visible on wandering NPCs' short hops.
    else if (moved > 1e-5) this.setClip('walk', 0.15, this.speed * 0.25);
    else this.setClip('idle', 0.2);
    // Settle the legs into stance while idling - the idle clip has no leg
    // curves, so after a walk they'd otherwise be left mid-stride. The catch:
    // the walk clip keeps writing the legs for the length of its blend-out
    // (~0.2s) and its cycle keeps advancing, so easing from whatever the legs
    // read *this* frame just chases that fading, still-stepping pose - the
    // legs twitch as if taking one more step. Instead, snapshot the pose the
    // walk left them in the instant we go idle and drive that snapshot home on
    // a clock of our own. Because the app's 'update' fires after the anim
    // system's, this write lands last and overrides the blending-out walk, so
    // the legs ease straight from the stop pose to stance with no twitch.
    if (this.clip === 'idle') {
      if (!this.legSettle) {
        this.legSettle = {
          t: 0,
          l: this.legL ? this.legL.getLocalRotation().clone() : null,
          r: this.legR ? this.legR.getLocalRotation().clone() : null,
        };
      }
      const s = this.legSettle;
      s.t = Math.min(1, s.t + dt * 5); // ~0.2s to reach stance
      const k = s.t * s.t * (3 - 2 * s.t); // smoothstep - no abrupt start/stop
      if (this.legL && s.l) this.legL.setLocalRotation(settleQuat().slerp(s.l, pcRuntime().Quat.IDENTITY, k));
      if (this.legR && s.r) this.legR.setLocalRotation(settleQuat().slerp(s.r, pcRuntime().Quat.IDENTITY, k));
    } else {
      this.legSettle = null;
    }
    let bobY = 0;
    let forward = 0;
    let pitch = 0;
    let sx = 1;
    let sy = 1;
    if (this.fx) {
      this.fx.t += dt;
      const { kind, t } = this.fx;
      if (kind === 'lunge') {
        // Unhurried on purpose: the swing used to be over in 0.28s, which read
        // as a twitch rather than a hit landing.
        const T = 0.5;
        if (t >= T) this.fx = null;
        else forward = Math.sin((Math.PI * t) / T) * 0.42;
      } else if (kind === 'flinch') {
        const T = 0.42;
        if (t >= T) this.fx = null;
        else {
          const k = Math.sin((Math.PI * t) / T);
          sx = 1 + 0.13 * k;
          sy = 1 - 0.2 * k;
          forward = -0.1 * k; // recoil
        }
      } else if (kind === 'death') {
        const T = 1.0;
        const k = Math.min(1, t / T);
        pitch = -88 * k * (2 - k); // ease-out topple onto their back
        bobY = -Math.max(0, k - 0.7) * 0.5; // then sink into the carpet
        // The body STAYS - a lootable office casualty, not a despawn.
        if (t >= T + 0.35) this.fx = { kind: 'corpse', t: 0 };
      } else if (kind === 'corpse') {
        pitch = -88;
        bobY = -0.15;
      }
    }
    // The take-cover crouch (TACTICS_PLAN M6): a HELD squash, not a timed fx
    // - the torso drops onto the legs and stays there until the crouch
    // breaks. Eased on its own clock so tucking in and standing up read as
    // motion, and composed multiplicatively AFTER the fx block so a flinch
    // or a lunge still lands while crouched (attacking from cover is legal).
    // The dead are exempt: their pose is the topple's.
    this.crouchK += ((this.crouched ? 1 : 0) - this.crouchK) * Math.min(1, dt * 7);
    if (this.crouchK < 1e-3) this.crouchK = this.crouched ? this.crouchK : 0;
    if (this.crouchK > 0 && this.fx?.kind !== 'death' && this.fx?.kind !== 'corpse') {
      const k = this.crouchK;
      sy *= 1 - 0.38 * k; // the torso comes down onto the legs...
      sx *= 1 + 0.08 * k; // ...and the silhouette widens into the huddle
      bobY -= 0.03 * k;
    }
    this.visual.setLocalPosition(0, this.visualLift + bobY, forward);
    this.visual.setLocalEulerAngles(pitch, 0, 0);
    this.visual.setLocalScale(sx, sy, sx);
  }

  // PRECONDITION: path[0] is this body's TRUE continuous position - every
  // feeder splices it in before smoothing (smoothFromBody and its kin). It is
  // skipped, so a stale tile-centre there is harmless, but path[1] is walked
  // verbatim: a feeder that smooths from anywhere but the body sends the body
  // darting to a vertex planned from its rounded tile. Fix the feeder, not
  // this.
  setPath(path) {
    if (!path || path.length < 2) {
      // A degenerate "path" has nowhere to walk to; index 1 would read
      // undefined and crash the update loop mid-frame.
      this.path = null;
      return;
    }
    this.path = path;
    this.pathIndex = 1; // index 0 is where we already stand
    this.slideTo = null;
  }

  clearPath() {
    this.path = null;
  }

  get moving() {
    return !!this.path || !!this.slideTo;
  }

  // Teleport the logical tile and glide the body there in a straight line
  // (shoves). Free-form travel goes through setPath instead. The optional
  // rest point (px, pz) is where the body actually comes to rest - it must
  // round back to (x, z), and it is what keeps a forced move from re-centring
  // a body onto the grid mid-fight. Defaults to the tile centre for callers
  // that genuinely mean it (the test hook).
  pushTo(x, z, px = x, pz = z) {
    this.x = x;
    this.z = z;
    this.slideTo = { x: px, z: pz };
    this.path = null;
  }

  // Follows (smoothed) waypoints at any angle, consuming the whole frame's
  // movement across bends so speed is constant through corners. Because a
  // straight run crosses tiles without stopping on them, the logical tile is
  // tracked from the entity's position every frame - onTile(x, z, pathDone,
  // changed) fires on each tile entered so hazards/combat/exits react
  // mid-stride. Shove glides (slideTo) move the body without retracking the
  // logical tile - pushTo already set it.
  update(dt, onTile = null) {
    if (!this.entity) return;
    const budget = (this.path || this.slideTo) ? this.speed * dt : 0;
    let remaining = budget;
    let finished = false;
    while (this.path && remaining > 0) {
      const [wx, wz] = this.path[this.pathIndex];
      const pos = this.entity.getPosition();
      const dx = wx - pos.x;
      const dz = wz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= remaining) {
        this.entity.setPosition(wx, pos.y, wz);
        remaining -= d;
        if (++this.pathIndex >= this.path.length) {
          this.path = null;
          finished = true;
        }
      } else {
        this.entity.setPosition(pos.x + (dx / d) * remaining, pos.y, pos.z + (dz / d) * remaining);
        this.targetYaw = Math.atan2(dx, dz) * RAD_TO_DEG;
        remaining = 0;
      }
    }
    while (this.slideTo && remaining > 0) {
      const pos = this.entity.getPosition();
      const dx = this.slideTo.x - pos.x;
      const dz = this.slideTo.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= remaining) {
        this.entity.setPosition(this.slideTo.x, pos.y, this.slideTo.z);
        remaining -= Math.max(d, 1e-4);
        this.slideTo = null;
      } else {
        this.entity.setPosition(pos.x + (dx / d) * remaining, pos.y, pos.z + (dz / d) * remaining);
        this.targetYaw = Math.atan2(dx, dz) * RAD_TO_DEG;
        remaining = 0;
      }
    }
    this.easeYaw(dt);
    this.updateAnim(dt, budget - remaining);
    if (this.slideTo) return; // logical tile already set by pushTo
    const pos = this.entity.getPosition();
    const tx = Math.round(pos.x);
    const tz = Math.round(pos.z);
    // `changed` fires effects (damage once per tile entered); `finished` fires
    // arrival-only logic (the exit). Arriving on a tile you already entered
    // must not re-apply its effects.
    const changed = tx !== this.x || tz !== this.z;
    if (changed || finished) {
      this.x = tx;
      this.z = tz;
      const cb = onTile || this.onTile;
      cb && cb(tx, tz, finished, changed);
    }
  }
}

export class PlayerActor extends GridActor {
  constructor(x, z, opts = {}) {
    super(x, z, { speed: 4, ...opts });
  }
}

// A non-hostile coworker you talk to (data/npcs.js). It just stands on its
// tile and idles - no wander, no combat, no HP. It blocks movement like any
// body (main.js layers its tile into isWalkable) and turns to face the player
// when a conversation opens. GridActor.update with no path plays the idle
// clip and eases facing, which is all an NPC needs.
export class NpcActor extends GridActor {
  constructor(x, z, typeId, def, opts = {}) {
    super(x, z, { speed: 2.2, ...opts });
    this.typeId = typeId;
    this.def = def;
  }

  update(dt) {
    if (!this.entity) return;
    super.update(dt); // idle anim + facing ease; no path, so it stays put
  }
}

// A recruitable coworker (data/companions.js). Before recruitment it stands
// and talks like any NPC - it lives in main.js's `npcs` array and blocks like
// a body. Once `recruited`, main.js moves it into the party: follow paths are
// issued by the follower logic there, per-member stepping runs through
// onMemberStep, and this actor just walks what it's given (GridActor already
// knows how). Player-grade walk speed, because it keeps up or it gets left.
export class CompanionActor extends GridActor {
  constructor(x, z, typeId, def, opts = {}) {
    super(x, z, { speed: 4, ...opts });
    this.typeId = typeId;
    this.def = def;
    this.recruited = false;
  }
}

export class EnemyActor extends GridActor {
  constructor(x, z, typeId, def, opts = {}) {
    super(x, z, { speed: 2.2, ...opts });
    this.typeId = typeId;
    this.def = def;
    // The unit's combat stats, NORMALIZED once at construction (stats.js
    // `unitCombat`). This is the seam SUMMON_PLAN.md and PROGRESSION_PLAN.md
    // describe, and it is load-bearing rather than decorative: an AI unit can
    // be backed by an ENEMY_TYPES entry OR by a CLASS (an enemy-side summon
    // resolves its archetype from CLASSES first), and the two registries do not
    // agree - a class spells max HP `maxHp` where an enemy spells it `hp`, and
    // a class states no `accuracy`, `dodge` or `reach` at all. Reading `def`
    // directly meant every consumer re-implemented those defaults; combat.js
    // had three such copies, and its attack picker indexed `def.attacks`
    // with no fallback at all.
    this.combat = unitCombat(def);
    this.maxHp = this.combat.maxHp;
    this.hp = this.maxHp; // map HP - damage persists outside combat too
    this.spawnX = x;
    this.spawnZ = z;
    this.alive = true;
    this.leash = 2;
    // Faction + summon lifecycle. A hand-placed coworker is a permanent enemy
    // on the enemy team; a summoned unit carries its summoner (for live-count
    // caps) and the `summoned` marker (no loot, no XP, gone at combat end).
    this.team = opts.team || 'enemy';
    this.summonedBy = opts.summonedBy || null;
    this.summoned = !!opts.summoned;
    // Turns of assignment left before a summon files out on its own (set by
    // combat.js from the summon descriptor's `lifetimeTurns`). null = forever,
    // which is every hand-placed coworker.
    this.summonTurns = opts.summonTurns ?? null;
    // Stagger decisions so enemies don't all step in lockstep.
    this.wanderTimer = 1 + Math.random() * 1.5;
  }

  takeDamage(amount) {
    // A non-finite amount is always a bug upstream (an action with no damage
    // dice reaching a damage roll: `rand(undefined, undefined)` is NaN). Let
    // it through and `hp` becomes NaN, which is never `<= 0` - the unit can
    // never die, so a fight that requires it dead can never end. Degrade to a
    // visible no-op instead: the caller is told nothing died, and the bug
    // shows up as an attack that does nothing rather than as a soft-lock.
    if (!Number.isFinite(amount)) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    this.flinch();
    return false;
  }

  die() {
    this.alive = false;
    this.path = null;
    this.slideTo = null;
    this.onTile = null;
    // Summoned minions leave nothing to rummage - they're spent, not slain
    // (SUMMON_PLAN #6). A hand-placed coworker rolls their loot table.
    this.loot = this.summoned ? [] : rollLoot(this.combat.loot); // body carry (lootable)
    if (this.entity) this.fx = { kind: 'death', t: 0 };
  }

  // world: { paused, isWalkable, isHazard, blockedByParty, occupied,
  //          findWanderPath } - see the update loop in main.js
  update(dt, world) {
    if (!this.alive) {
      // Play out the death topple, then the entity removes itself.
      if (this.entity) this.updateAnim(dt, 0);
      return;
    }
    super.update(dt);
    if (world.paused) return; // combat drives enemy movement itself
    // Simultaneous wanderers can converge on the same spot - stop short
    // rather than visibly overlapping another actor. (Combat movement is
    // sequenced, so only wander needs this.)
    if (this.path && this.entity) {
      const pos = this.entity.getPosition();
      const [wx, wz] = this.path[this.pathIndex];
      const d = Math.hypot(wx - pos.x, wz - pos.z) || 1;
      const ax = Math.round(pos.x + ((wx - pos.x) / d) * 0.7);
      const az = Math.round(pos.z + ((wz - pos.z) / d) * 0.7);
      if ((ax !== this.x || az !== this.z) && world.occupied(ax, az, this)) this.clearPath();
    }
    this.wanderTimer -= dt;
    if (this.wanderTimer > 0 || this.moving) return;
    this.wanderTimer = 1.8;
    if (Math.random() < 0.45) return; // sometimes they just stand around
    // Amble to a random open spot within the leash - a real smoothed path,
    // walked in one run, instead of a one-tile hop.
    const tx = this.spawnX + Math.floor(Math.random() * (this.leash * 2 + 1)) - this.leash;
    const tz = this.spawnZ + Math.floor(Math.random() * (this.leash * 2 + 1)) - this.leash;
    if (tx === this.x && tz === this.z) return;
    if (!world.isWalkable(tx, tz) || world.isHazard(tx, tz)) return;
    if (world.blockedByParty(tx, tz)) return;
    const p = world.findWanderPath(this, tx, tz);
    if (p && p.length > 1) {
      // Wet floors are slippery for everyone - a slip ends the amble there.
      // Gum wads stick to wanderers too: slow forever, but never slip again.
      this.onTile = (x, z, done, changed) => {
        // An amble obeys the floor, the same as a walk with dice out [stated]
        // (designer, 2026-08-03, "yes all fixes"). It used to obey two rules of
        // the thirteen - gum and slipping - so a coworker could stroll through
        // flame lit across their route for nothing, on the exact tile that
        // bills a member 4 HP, and a wad picked up out here was permanent while
        // the same wad expired the moment a fight started.
        //
        // Sampled BEFORE the clock ticks, the same rule both other handlers
        // state: the tile a wad wears off on still keeps its traction.
        const wasSlipProof = !!statusFx(this).slipProof;
        if (changed && this.alive) {
          const step = tickStep(this);
          if (step.damage > 0 && this.takeDamage(step.damage)) return;
          // A lapsed wad gives the legs back. Derived, never scaled in place -
          // see the note on the pickup below.
          if (step.expired.length) {
            if (this.baseSpeed === undefined) this.baseSpeed = this.speed;
            this.speed = speedUnderStatus(this.baseSpeed, statusFx(this));
          }
        }
        // The floor's own rules, off the same fact sheet and the same pure
        // `surfaceEffect` combat and the party both read - the damage, the
        // turn-clock status it applies, and the `bleed` a paper drift leaves.
        // Silently: the surface messages are written in the player's voice, and
        // a coworker ambling past is not the player.
        if (changed && this.alive) {
          const sfx = surfaceEffect(world.floorAt(x, z));
          if (sfx?.applies && sfx.applies !== 'gum') applyStatus(this, sfx.applies);
          const amount = world.surfDamage(x, z);
          if (amount > 0) {
            if (sfx?.bleed) applyStatus(this, 'bleed', { duration: sfx.bleed });
            this.flinch();
            if (this.takeDamage(amount)) return;
          }
        }
        // Gum is a status now (statuses.js), shared with the combat unit so a
        // wanderer that steps in a wad is still gummed when a fight starts, and
        // ticking down on the step clock above wherever it was picked up.
        if (changed && !hasStatus(this, 'gum') && world.stickGum(x, z)) {
          applyStatus(this, 'gum');
          // DERIVE from a captured base, the same way combat's syncUnitSpeed
          // does, rather than scaling in place. Scaling in place applied the
          // slow twice on anyone who was gummed before a fight: combat captures
          // `baseSpeed` lazily on first sync, so it captured an already-slowed
          // speed and then multiplied the status in on top of it. Deriving is
          // idempotent, so both sides can run in any order and agree.
          if (this.baseSpeed === undefined) this.baseSpeed = this.speed;
          this.speed = speedUnderStatus(this.baseSpeed, statusFx(this));
        }
        if (changed && this.alive && slips({
          chance: world.slipChanceAt(x, z),
          roll: Math.random,
          slipProof: wasSlipProof,
        })) {
          this.clearPath();
          this.flinch();
        }
        if (done || !this.path) this.onTile = null;
      };
      this.setPath(p);
    }
  }
}
