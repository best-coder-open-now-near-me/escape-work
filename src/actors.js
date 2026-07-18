// Actors: things that live on the grid and own a 3D entity. GridActor handles
// the shared mechanics (a logical tile position, an entity that slides smoothly
// toward it, eased turning); PlayerActor follows smoothed any-angle paths;
// EnemyActor adds wander AI. New actor kinds extend GridActor the same way.
const pc = window.pc;

const wrapAngle = (a) => (((a + 180) % 360) + 360) % 360 - 180;
const TURN_RATE = 10; // how quickly facing eases toward the heading

export class GridActor {
  constructor(x, z, { speed = 2.2 } = {}) {
    this.x = x;
    this.z = z;
    this.speed = speed;
    this.entity = null;
    this.yaw = 0;
    this.targetYaw = 0;
  }

  attach(entity) {
    this.entity = entity;
    this.yaw = this.targetYaw = entity.getEulerAngles().y;
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

  // Slide the entity toward the logical tile, carrying any leftover movement
  // across arrivals (onArrive may set a new destination mid-frame) so speed
  // stays constant instead of hitching at each tile.
  update(dt) {
    if (!this.entity) return;
    let remaining = this.speed * dt;
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
    let remaining = this.path ? this.speed * dt : 0;
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
    return false;
  }

  die() {
    this.alive = false;
    if (this.entity) this.entity.destroy();
  }

  // world: { paused, terrainOpen, isWalkable, isHazard, playerTile }
  update(dt, world) {
    if (!this.alive) return;
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
