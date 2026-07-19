// Actors: things that live on the grid and own a 3D entity. GridActor handles
// the shared mechanics (a logical tile position, an entity that slides smoothly
// toward it, eased turning) plus the procedural animation layer: the HOLDER
// entity carries position/facing, while the model child inside it gets the
// walk bob, attack lunges, hit flinches and death topples - so animation can
// never fight the movement code. PlayerActor follows smoothed any-angle paths;
// EnemyActor adds wander AI. New actor kinds extend GridActor the same way.
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
    this.stride = 0; // accumulated distance, drives the walk bob
    this.bobAmp = 0; // eases in/out so stopping doesn't cut the bob mid-air
    this.fx = null; // { kind: 'lunge'|'flinch'|'death', t }
    this.flashT = 0;
    this.mats = []; // per-instance cloned materials (for damage flashes)
  }

  attach(entity) {
    this.entity = entity;
    this.visual = entity.children[0] || entity;
    // Skeletal clips shipped in the .glb (see placeModel). When present they
    // replace the procedural walk bob/topple with the real thing.
    this.clips = entity._animCtl || null;
    this.dead = false;
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
    if (this.dead || this.fx?.kind === 'death') return;
    if (tx !== undefined) this.faceToward(tx, tz);
    let clip = null;
    let T = 0.28;
    if (this.clips) {
      this._lungeSide = !this._lungeSide;
      clip = this._lungeSide ? 'attack-melee-right' : 'attack-melee-left';
      T = Math.min(this.clips.duration(clip) || 0.8, 0.9);
    }
    this.fx = { kind: 'lunge', t: 0, T, clip };
  }

  flinch() {
    if (this.dead || this.fx?.kind === 'death') return;
    // no "hit" clip exists, so the squash + red flash carries this even on
    // top of a playing skeletal clip
    this.fx = { kind: 'flinch', t: 0 };
    this.flashT = 0.16;
    for (const { mat } of this.mats) {
      mat.emissive.set(FLASH_COLOR[0], FLASH_COLOR[1], FLASH_COLOR[2]);
      mat.update();
    }
  }

  // One-shot flavor clip (emote-yes for a coffee break, interact-right for
  // arson...), then back to whatever locomotion wants.
  gesture(clip) {
    if (!this.clips || this.dead || this.fx?.kind === 'death') return;
    this.fx = { kind: 'gesture', clip, t: 0, T: Math.min(this.clips.duration(clip) || 1, 1.5) };
  }

  // Start dying: with clips, play `die` and leave the body where it falls;
  // without, the procedural topple runs and removes the entity.
  playDeath() {
    if (this.dead || this.fx?.kind === 'death') return;
    this.fx = { kind: 'death', t: 0 };
  }

  // Which looping clip (and playback speed) to use while moving.
  locomotion() {
    return ['walk', Math.max(0.5, this.speed / 2.2)];
  }

  // Drives the visual child (and the skeletal clip state) each frame.
  // `moved` is world distance covered this frame.
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
    if (this.dead) return;
    // hysteresis so a single coasting frame doesn't flicker walk -> idle
    this.moveT = moved > 0 ? 0.14 : Math.max(0, (this.moveT || 0) - dt);
    const moving = this.moveT > 0;

    let forward = 0;
    let sx = 1;
    let sy = 1;
    let topplePitch = 0;
    let bobY = 0;
    let roll = 0;
    if (this.fx) {
      this.fx.t += dt;
      const { kind, t } = this.fx;
      if (kind === 'lunge') {
        // small forward push for contact even when the melee clip plays
        forward = Math.sin(Math.PI * Math.min(1, t / this.fx.T)) * (this.clips ? 0.16 : 0.42);
        if (t >= this.fx.T) this.fx = null;
      } else if (kind === 'flinch') {
        const T = 0.24;
        if (t >= T) this.fx = null;
        else {
          const k = Math.sin((Math.PI * t) / T);
          sx = 1 + 0.13 * k;
          sy = 1 - 0.2 * k;
          forward = -0.1 * k; // recoil
        }
      } else if (kind === 'gesture') {
        if (t >= this.fx.T) this.fx = null;
      } else if (kind === 'death') {
        if (this.clips) {
          // the real `die` clip plays below; freeze on its last pose and
          // leave the body on the carpet
          if (t >= (this.clips.duration('die') || 1) - 0.05) {
            this.clips.pause();
            this.dead = true;
          }
        } else {
          const T = 0.7;
          const k = Math.min(1, t / T);
          topplePitch = -88 * k * (2 - k); // ease-out topple onto their back
          bobY = -Math.max(0, k - 0.7) * 0.5; // then sink into the carpet
          if (t >= T + 0.35) {
            this.entity.destroy();
            this.entity = null;
            this.visual = null;
            return;
          }
        }
      }
    }

    if (this.clips) {
      // resolve the clip state: death > gesture > attack > locomotion > idle
      let want = 'idle';
      let spd = 1;
      if (this.fx?.kind === 'death') {
        want = 'die';
      } else if (this.fx?.kind === 'gesture' || this.fx?.kind === 'lunge') {
        if (this.fx.clip) want = this.fx.clip;
        else if (moving) [want, spd] = this.locomotion();
      } else if (moving) {
        [want, spd] = this.locomotion();
      }
      this.clips.transition(want);
      this.clips.setSpeed(spd);
      this.visual.setLocalPosition(0, 0, forward);
      this.visual.setLocalScale(sx, sy, sx);
      return;
    }

    // procedural fallback for clip-less models: distance-driven bob + sway
    this.stride += moved * 4.4;
    const target = moving ? 1 : 0;
    this.bobAmp += (target - this.bobAmp) * Math.min(1, dt * 9);
    bobY += Math.abs(Math.sin(this.stride)) * 0.055 * this.bobAmp;
    roll = this.fx?.kind === 'death' ? 0 : Math.sin(this.stride * 0.5) * 3.2 * this.bobAmp;
    this.visual.setLocalPosition(0, bobY, forward);
    this.visual.setLocalEulerAngles(topplePitch, 0, roll);
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

  // Hustling out of the office at full speed reads as a jog; sticky coffee
  // (which halves this.speed) drops it back to a trudge.
  locomotion() {
    return this.speed >= 3.4 ? ['sprint', this.speed / 4] : ['walk', this.speed / 2.6];
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
    if (this.entity) this.playDeath();
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
