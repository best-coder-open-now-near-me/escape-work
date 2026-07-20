// Actors: things that live on the grid and own a 3D entity. GridActor handles
// the shared mechanics (a logical tile position, an entity that slides smoothly
// toward it, eased turning) plus two animation layers that can't fight the
// movement code or each other: baked skeletal clips (idle/walk/attack, wired
// up in scene.js) play on the bones, while a procedural layer on the model
// child adds the attack lunge push, hit flinches and death topples.
// PlayerActor follows smoothed any-angle paths; EnemyActor adds wander AI.
// New actor kinds extend GridActor the same way.
const pc = window.pc;

const wrapAngle = (a) => (((a + 180) % 360) + 360) % 360 - 180;
const TURN_RATE = 10; // how quickly facing eases toward the heading
const FLASH_COLOR = [0.75, 0.09, 0.05];

export class GridActor {
  constructor(x, z, { speed = 2.2 } = {}) {
    this.x = x;
    this.z = z;
    this.speed = speed;
    this.entity = null;
    this.visual = null; // the model child that animation moves
    this.yaw = 0;
    this.targetYaw = 0;
    // animation state
    this.animC = null; // anim component driving the baked clips
    this.clip = null; // current clip state name
    this.fx = null; // { kind: 'lunge'|'flinch'|'death', t }
    this.flashT = 0;
    this.mats = []; // per-instance cloned materials (for damage flashes)
  }

  attach(entity) {
    this.entity = entity;
    this.visual = entity.children[0] || entity;
    this.animC = entity.findComponent('anim') || null;
    // The idle clip animates only torso/arms/head - it has NO leg channels,
    // so nothing ever writes the legs back after a walk stops mid-stride.
    // updateAnim eases these home manually whenever we're idling.
    this.legL = entity.findByName('leg-left');
    this.legR = entity.findByName('leg-right');
    this.yaw = this.targetYaw = entity.getEulerAngles().y;
    // Clone materials so damage flashes hit THIS character, not every
    // character instantiated from the same .glb.
    this.mats = [];
    for (const rc of entity.findComponents('render')) {
      for (const mi of rc.meshInstances) {
        const clone = mi.material.clone();
        clone.update();
        mi.material = clone;
        this.mats.push({ mat: clone, emissive: clone.emissive.clone() });
      }
    }
  }

  faceToward(tx, tz) {
    this.targetYaw = Math.atan2(tx - this.x, tz - this.z) * pc.math.RAD_TO_DEG;
  }

  // Ease the model's facing toward targetYaw - no more snap turns.
  easeYaw(dt) {
    if (!this.entity) return;
    this.yaw += wrapAngle(this.targetYaw - this.yaw) * Math.min(1, dt * TURN_RATE);
    this.entity.setEulerAngles(0, this.yaw, 0);
  }

  // --- animation triggers ------------------------------------------------------
  lunge(tx, tz) {
    if (this.fx?.kind === 'death') return;
    if (tx !== undefined) this.faceToward(tx, tz);
    this.fx = { kind: 'lunge', t: 0 };
  }

  flinch() {
    if (this.fx?.kind === 'death') return;
    this.fx = { kind: 'flinch', t: 0 };
    this.flashT = 0.16;
    for (const { mat } of this.mats) {
      mat.emissive.set(FLASH_COLOR[0], FLASH_COLOR[1], FLASH_COLOR[2]);
      mat.update();
    }
  }

  // Switch the skeletal clip (states assigned in scene.js setupAnim). The
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
    if (this.fx?.kind === 'death') this.setClip('idle', 0.2);
    else if (this.fx?.kind === 'lunge') this.setClip('attack-melee-right', 0.05, 1.3);
    else if (moved > 1e-5) this.setClip('walk', 0.15, this.speed * 0.5);
    else this.setClip('idle', 0.2);
    // Settle the legs into stance while idling - the idle clip never touches
    // them (no leg curves), so a walk or attack would otherwise leave them
    // frozen mid-stride.
    if (this.clip === 'idle') {
      const k = Math.min(1, dt * 12);
      for (const leg of [this.legL, this.legR]) {
        if (!leg) continue;
        const q = leg.getLocalRotation();
        q.slerp(q, pc.Quat.IDENTITY, k);
        leg.setLocalRotation(q);
      }
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
        const T = 0.28;
        if (t >= T) this.fx = null;
        else forward = Math.sin((Math.PI * t) / T) * 0.42;
      } else if (kind === 'flinch') {
        const T = 0.24;
        if (t >= T) this.fx = null;
        else {
          const k = Math.sin((Math.PI * t) / T);
          sx = 1 + 0.13 * k;
          sy = 1 - 0.2 * k;
          forward = -0.1 * k; // recoil
        }
      } else if (kind === 'death') {
        const T = 0.7;
        const k = Math.min(1, t / T);
        pitch = -88 * k * (2 - k); // ease-out topple onto their back
        bobY = -Math.max(0, k - 0.7) * 0.5; // then sink into the carpet
        if (t >= T + 0.35) {
          this.entity.destroy();
          this.entity = null;
          this.visual = null;
          return;
        }
      }
    }
    this.visual.setLocalPosition(0, bobY, forward);
    this.visual.setLocalEulerAngles(pitch, 0, 0);
    this.visual.setLocalScale(sx, sy, sx);
  }

  // Slide the entity toward the logical tile, carrying any leftover movement
  // across arrivals (onArrive may set a new destination mid-frame) so speed
  // stays constant instead of hitching at each tile.
  update(dt) {
    if (!this.entity) return;
    const budget = this.speed * dt;
    let remaining = budget;
    for (let guard = 0; guard < 4 && remaining > 0; guard++) {
      const pos = this.entity.getPosition();
      const dx = this.x - pos.x;
      const dz = this.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) {
        if (!(this.onArrive && this.onArrive())) break;
        continue;
      }
      if (d <= remaining) {
        this.entity.setPosition(this.x, pos.y, this.z);
        remaining -= d;
        if (!(this.onArrive && this.onArrive())) break;
      } else {
        this.entity.setPosition(pos.x + (dx / d) * remaining, pos.y, pos.z + (dz / d) * remaining);
        this.targetYaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
        remaining = 0;
      }
    }
    this.easeYaw(dt);
    this.updateAnim(dt, budget - remaining);
  }
}

export class PlayerActor extends GridActor {
  constructor(x, z, opts = {}) {
    super(x, z, { speed: 4, ...opts });
    this.path = null;
    this.pathIndex = 0;
  }

  setPath(path) {
    this.path = path;
    this.pathIndex = 1; // index 0 is where we already stand
  }

  clearPath() {
    this.path = null;
  }

  get moving() {
    return !!this.path;
  }

  // Follows (smoothed) waypoints at any angle. Because a straight run crosses
  // tiles without stopping on them, the logical tile is tracked from the
  // entity's position every frame - onTile(x, z, pathDone) fires on each tile
  // entered so hazards/combat/exits react mid-stride.
  update(dt, onTile) {
    if (!this.entity) return;
    let finished = false;
    // Consume the whole frame's movement across waypoints - no per-bend
    // hitch, so speed is constant through corners.
    const budget = this.path ? this.speed * dt : 0;
    let remaining = budget;
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
        this.targetYaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
        remaining = 0;
      }
    }
    this.easeYaw(dt);
    this.updateAnim(dt, budget - remaining);
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
      onTile && onTile(tx, tz, finished, changed);
    }
  }
}

export class EnemyActor extends GridActor {
  constructor(x, z, typeId, def, opts = {}) {
    super(x, z, { speed: 2.2, ...opts });
    this.typeId = typeId;
    this.def = def;
    this.hp = def.hp; // map HP - damage persists outside combat too
    this.spawnX = x;
    this.spawnZ = z;
    this.alive = true;
    this.leash = 2;
    // Stagger decisions so enemies don't all step in lockstep.
    this.wanderTimer = 1 + Math.random() * 1.5;
  }

  takeDamage(amount) {
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
    if (this.entity) this.fx = { kind: 'death', t: 0 };
  }

  // world: { paused, terrainOpen, isWalkable, isHazard, stepOpen, playerTile }
  update(dt, world) {
    if (!this.alive) {
      // Play out the death topple, then the entity removes itself.
      if (this.entity) this.updateAnim(dt, 0);
      return;
    }
    super.update(dt);
    if (world.paused) return;
    this.wanderTimer -= dt;
    if (this.wanderTimer > 0) return;
    this.wanderTimer = 1.8;
    if (Math.random() < 0.45) return; // sometimes they just stand around
    const options = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = this.x + dx;
      const nz = this.z + dz;
      if (Math.abs(nx - this.spawnX) > this.leash || Math.abs(nz - this.spawnZ) > this.leash) continue;
      if (dx !== 0 && dz !== 0 && !(world.terrainOpen(this.x + dx, this.z) && world.terrainOpen(this.x, this.z + dz))) continue;
      if (!world.isWalkable(nx, nz)) continue;
      if (world.stepOpen && !world.stepOpen(this.x, this.z, nx, nz)) continue;
      if (world.isHazard(nx, nz)) continue; // they know where the puddles are
      if (nx === world.playerTile.x && nz === world.playerTile.z) continue;
      options.push([nx, nz]);
    }
    if (!options.length) return;
    const [nx, nz] = options[Math.floor(Math.random() * options.length)];
    this.x = nx;
    this.z = nz;
  }
}
