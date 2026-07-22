// Combat / impact FX and DOM-over-world projection. Purely cosmetic:
// gameplay resolves instantly, these just make it readable.
import { makeMaterial } from './shading.js';

const pc = window.pc;

// World point -> CSS-pixel screen point. worldToScreen works in device
// pixels while the DOM works in CSS pixels, so every DOM element tracking a
// world position (damage popups, loot labels, test helpers) must project
// through this - a raw worldToScreen drifts on HiDPI displays.
const _proj = new pc.Vec3();
export function worldToScreenCss(app, cameraEntity, wx, wy, wz) {
  cameraEntity.camera.worldToScreen(_proj.set(wx, wy, wz), _proj);
  const canvas = app.graphicsDevice.canvas;
  const s = canvas.clientWidth ? canvas.clientWidth / canvas.width : 1;
  return { x: _proj.x * s, y: _proj.y * s, behind: _proj.z < 0 };
}

let fxMats = null;
function ensureFxMats() {
  if (fxMats) return fxMats;
  fxMats = {
    paper: makeMaterial([0.97, 0.96, 0.9], { gloss: 0.3 }),
    trail: makeMaterial([1, 1, 1], { opacity: 0.4 }),
  };
  return fxMats;
}

// A thrown paper ball ('ball') or airplane ('plane') arcing from one tile to
// another, shedding a fading trail. Fire and forget.
export function throwProjectile(app, from, to, kind = 'ball') {
  const m = ensureFxMats();
  const holder = new pc.Entity('projectile');
  if (kind === 'plane') {
    const spine = new pc.Entity();
    spine.addComponent('render', { type: 'box', material: m.paper });
    spine.setLocalScale(0.06, 0.09, 0.36);
    holder.addChild(spine);
    for (const side of [-1, 1]) {
      const wing = new pc.Entity();
      wing.addComponent('render', { type: 'box', material: m.paper });
      wing.setLocalScale(0.16, 0.02, 0.3);
      wing.setLocalPosition(side * 0.09, 0.03, -0.02);
      wing.setLocalEulerAngles(0, 0, side * 24);
      holder.addChild(wing);
    }
  } else {
    const wad = new pc.Entity();
    wad.addComponent('render', { type: 'sphere', material: m.paper });
    wad.setLocalScale(0.17, 0.15, 0.16);
    holder.addChild(wad);
  }
  app.root.addChild(holder);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dur = 0.18 + dist * 0.055;
  const arc = 0.3 + dist * 0.07;
  const yaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
  const Y = 0.55; // hand height
  const parts = [];
  let t = 0;
  let acc = 0;
  let flying = true;
  const tick = (dt) => {
    if (flying) {
      t += dt;
      const k = Math.min(1, t / dur);
      const y = Y + Math.sin(Math.PI * k) * arc;
      holder.setPosition(from.x + dx * k, y, from.z + dz * k);
      if (kind === 'plane') {
        const vy = (Math.PI / dur) * Math.cos(Math.PI * k) * arc;
        const pitch = Math.atan2(vy, dist / dur) * pc.math.RAD_TO_DEG;
        holder.setEulerAngles(-pitch, yaw, 0);
      } else {
        holder.setEulerAngles(t * 640, yaw, t * 470);
      }
      acc += dt;
      while (acc > 0.024) {
        acc -= 0.024;
        const p = new pc.Entity();
        p.addComponent('render', { type: 'sphere', material: m.trail });
        p.setLocalScale(0.09, 0.09, 0.09);
        p.setPosition(holder.getPosition());
        app.root.addChild(p);
        parts.push({ e: p, life: 0.32 });
      }
      if (k >= 1) {
        flying = false;
        holder.destroy();
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.e.destroy();
        parts.splice(i, 1);
        continue;
      }
      const s = 0.09 * (p.life / 0.32);
      p.e.setLocalScale(s, s, s);
    }
    if (!flying && !parts.length) app.off('update', tick);
  };
  app.on('update', tick);
}

// Floating damage/heal number above a tile. DOM-based so it stays crisp;
// tracks the world position each frame as the camera moves.
export function spawnDamageText(app, cameraEntity, wx, wy, wz, text, color = '#ff8a76') {
  const div = document.createElement('div');
  div.className = 'dmg-pop';
  Object.assign(div.style, {
    position: 'fixed', zIndex: '26', pointerEvents: 'none', left: '-999px',
    font: '800 15px system-ui, sans-serif', color,
    textShadow: '0 1px 4px rgba(0,0,0,.85)', transform: 'translate(-50%, -100%)',
  });
  div.textContent = text;
  document.body.appendChild(div);
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const k = t / 0.9;
    if (k >= 1) {
      app.off('update', tick);
      div.remove();
      return;
    }
    const s = worldToScreenCss(app, cameraEntity, wx, wy + 0.6 + k * 0.85, wz);
    div.style.left = s.x + 'px';
    div.style.top = s.y + 'px';
    div.style.opacity = String(1 - k * k);
  };
  app.on('update', tick);
}
