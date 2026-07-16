// Actors: things that live on the grid and own a 3D entity. GridActor handles
// the shared mechanics (a logical tile position, an entity that slides smoothly
// toward it, facing); PlayerActor adds waypoint-path following; EnemyActor adds
// wander AI. New actor kinds (patrolling security, a chasing Deadline) extend
// GridActor the same way.
const pc = window.pc;

export class GridActor {
  constructor(x, z, { speed = 2.2 } = {}) {
    this.x = x;
    this.z = z;
    this.speed = speed;
    this.entity = null;
  }

  attach(entity) {
    this.entity = entity;
  }

  faceToward(tx, tz) {
    if (!this.entity) return;
    this.entity.setEulerAngles(0, Math.atan2(tx - this.x, tz - this.z) * pc.math.RAD_TO_DEG, 0);
  }

  // Slide the entity toward the logical tile; face the direction of travel.
  update(dt) {
    if (!this.entity) return;
    const pos = this.entity.getPosition();
    const target = new pc.Vec3(this.x, pos.y, this.z);
    const to = target.clone().sub(pos);
    const d = to.length();
    if (d < 0.001) return;
    const step = this.speed * dt;
    if (d <= step) {
      this.entity.setPosition(target);
    } else {
      to.normalize();
      this.entity.setPosition(pos.add(to.scale(step)));
      this.entity.setEulerAngles(0, Math.atan2(to.x, to.z) * pc.math.RAD_TO_DEG, 0);
    }
  }
}

export class PlayerActor extends GridActor {
  constructor(x, z, opts = {}) {
    super(x, z, { speed: 3.5, ...opts });
    this.path = null;
    this.pathIndex = 0;
  }

  setPath(path) {
    this.path = path;
    this.pathIndex = 1; // index 0 is the tile we already stand on
  }

  clearPath() {
    this.path = null;
  }

  get moving() {
    return !!this.path;
  }

  // Walks the waypoint list; calls onStep(x, z, pathDone) as each tile is
  // reached so the game can apply tile effects and combat checks.
  update(dt, onStep) {
    if (!this.entity || !this.path) return;
    const [tx, tz] = this.path[this.pathIndex];
    const pos = this.entity.getPosition();
    const target = new pc.Vec3(tx, pos.y, tz);
    const to = target.clone().sub(pos);
    const dist = to.length();
    const step = this.speed * dt;
    if (dist <= step) {
      this.entity.setPosition(target);
      this.x = tx;
      this.z = tz;
      let done = false;
      if (++this.pathIndex >= this.path.length) {
        this.path = null;
        done = true;
      }
      onStep && onStep(tx, tz, done);
    } else {
      to.normalize();
      this.entity.setPosition(pos.add(to.scale(step)));
      this.entity.setEulerAngles(0, Math.atan2(to.x, to.z) * pc.math.RAD_TO_DEG, 0);
    }
  }
}

export class EnemyActor extends GridActor {
  constructor(x, z, typeId, def, opts = {}) {
    super(x, z, { speed: 2.2, ...opts });
    this.typeId = typeId;
    this.def = def;
    this.spawnX = x;
    this.spawnZ = z;
    this.alive = true;
    this.leash = 2;
    // Stagger decisions so enemies don't all step in lockstep.
    this.wanderTimer = 1 + Math.random() * 1.5;
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
