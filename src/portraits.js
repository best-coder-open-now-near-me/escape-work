// Live character portraits: each one is the character's ACTUAL model, rendered
// offscreen and copied out as an image, so a portrait can never drift from
// what walks around the floor - tint and build included (data/*.js `look`).
//
// How it works. A dedicated camera renders a staged copy of the model into a
// small render target, parked FAR BELOW the world: the main camera's far clip
// is 300, so a rig at y = -1000 is invisible to it, and this camera's own far
// clip is short enough that it can never see the office either. A frame later
// the pixels are read back, flipped (GL's origin is bottom-left, a canvas's is
// top-left) and turned into a data URL.
//
// Rendering is ONE-SHOT per character type, cached by model + look, so a
// portrait costs a single 128px render for the whole session rather than a
// per-frame readback. Nothing about a character's portrait changes as it takes
// damage, so there is nothing to keep live.
//
// The scene's key lights are DIRECTIONAL, which is what makes the staging trick
// work: direction doesn't depend on position, so the staged rig is lit exactly
// as it would be on the floor.
const pc = window.pc;
import { cloneMaterials, tintMaterials, placeModel, applyCharacterProportions } from './models.js';

const SIZE = 128;
const STAGE_Y = -1000;
const HEAD_FALLBACK = 1.55; // head height if the rig has no `head` bone
const DIST = 1.15;          // camera distance - head and shoulders at fov 30

export function createPortraits(app) {
  const cache = new Map();   // key -> data URL (or null if it couldn't render)
  const inflight = new Map(); // key -> Promise
  // ONE camera and ONE render target serve every portrait, and every staged rig
  // stands on the same spot - so two renders in flight at once would read each
  // other's pixels (the whole party and every enemy are dressed in the same
  // frame at level load, so that is the normal case, not a corner). Renders are
  // therefore queued: one stages, reads, and tears down before the next begins.
  let queue = Promise.resolve();
  let rt = null;
  let cam = null;

  const keyOf = (model, look) => `${model}|${(look?.tint || []).join(',')}|`
    + `${JSON.stringify(look?.build || {})}`;

  function ensureRig() {
    if (rt) return true;
    const device = app.graphicsDevice;
    if (!device || !device.gl) return false; // no WebGL readback - skip portraits
    const colorBuffer = new pc.Texture(device, {
      width: SIZE,
      height: SIZE,
      format: pc.PIXELFORMAT_R8_G8_B8_A8,
      minFilter: pc.FILTER_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    rt = new pc.RenderTarget({ colorBuffer, depth: true });
    cam = new pc.Entity('portrait-cam');
    cam.addComponent('camera', {
      projection: pc.PROJECTION_PERSPECTIVE,
      fov: 30,
      // Matches the HUD panel behind it, so the portrait sits in its frame
      // instead of floating on a coloured square.
      clearColor: new pc.Color(0.075, 0.075, 0.105, 1),
      nearClip: 0.05,
      farClip: 8, // cannot reach the world from the staging area
      renderTarget: rt,
      priority: -1, // render before the main camera each frame
    });
    cam.enabled = false;
    app.root.addChild(cam);
    return true;
  }

  // Tint an entity's materials, through the same pair every other body uses
  // (models.js). Portrait rigs are throwaway, but the .glb's materials are
  // SHARED with every character built from it, so the clone is not optional.
  //
  // This was a fourth hand-written copy of "tint a body", and the only one left
  // doing the compounding in-place multiply the other three were rewritten to
  // remove: it multiplied the clone's CURRENT diffuse rather than a pristine
  // snapshot, so a second call darkened an already-tinted body. Safe today only
  // because a portrait rig is tinted once and thrown away - which is a fact
  // about the caller, not a property of the function.
  const tint = (entity, rgb) => tintMaterials(cloneMaterials(entity), rgb);

  function readTarget() {
    const device = app.graphicsDevice;
    const gl = device.gl;
    const px = new Uint8Array(SIZE * SIZE * 4);
    device.setRenderTarget(rt);
    device.updateBegin();
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    device.updateEnd();
    device.setRenderTarget(null);
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    // Flip rows: GL reads bottom-up, the canvas wants top-down.
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(px.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // Render one portrait. Resolves to a data URL, or null if it could not be
  // produced - callers treat that as "no portrait" and carry on.
  function portrait(model, look = null) {
    if (!model) return Promise.resolve(null);
    const key = keyOf(model, look);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    if (!ensureRig()) return Promise.resolve(null);

    const render = () => new Promise((resolve) => {
      // `remember: false` leaves the cache untouched, for a failure that says
      // nothing about the model - a slow load that ran out the clock. Caching
      // that null made the timeout permanent: the character wore no face for
      // the rest of the session and nothing would ever try again.
      const finish = (url, entity, { remember = true } = {}) => {
        cam.enabled = false;
        if (entity) entity.destroy();
        if (remember) cache.set(key, url);
        inflight.delete(key);
        resolve(url);
      };
      let settled = false;
      placeModel(app, `assets/characters/${model}.glb`, 0, 0, {
        lift: 0,
        // faceToward is atan2(dx, dz) (actors.js), so yaw 0 faces +Z - and the
        // portrait camera is parked at +DIST on Z, already in front of the
        // model. 180 spun it to face -Z: dead away from the lens, which is why
        // every portrait was the back of somebody's head.
        rotY: 0,
        animate: false,
        onReady: (e) => {
          // The timeout below may already have given up on this load - a .glb
          // that resolves afterwards has missed its render, and staging it
          // anyway did real damage: the rig was never destroyed, so it stood on
          // the portrait stage and photobombed every LATER portrait, and the
          // camera it switched back on had nothing left to switch it off.
          if (settled) { e.destroy(); return; }
          try {
            applyCharacterProportions(e, look?.build);
            tint(e, look?.tint);
            e.setPosition(0, STAGE_Y, 0);
            app.root.syncHierarchy(); // so the head bone's world position is real
            const head = e.findByName('head');
            const y = head ? head.getPosition().y : STAGE_Y + HEAD_FALLBACK;
            cam.setPosition(0, y + 0.05, DIST);
            cam.lookAt(0, y, 0);
            cam.enabled = true;
          } catch (err) {
            console.warn('portrait staging failed', model, err);
            finish(null, e);
            settled = true;
            return;
          }
          // Give the newly-enabled camera a frame to actually draw, THEN read.
          let frames = 0;
          const tick = () => {
            if (settled) { app.off('postrender', tick); return; }
            if (++frames < 2) return;
            app.off('postrender', tick);
            settled = true;
            let url = null;
            try {
              url = readTarget();
            } catch (err) {
              console.warn('portrait readback failed', model, err);
            }
            finish(url, e);
          };
          app.on('postrender', tick);
        },
      });
      // A .glb that never loads must not leave a caller waiting forever - and
      // must not wedge the queue behind it either.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        finish(null, null, { remember: false });
      }, 8000);
    });

    const p = queue.then(render);
    queue = p.catch(() => {}); // one bad render must not poison the rest
    inflight.set(key, p);
    return p;
  }

  // Convenience: render for an actor and stash the result on it. Portraits ride
  // the ACTOR, never the sheet - sheets are serialized into saves, and a base64
  // PNG has no business in localStorage.
  function forActor(actor, model, look = null, onDone = null) {
    if (!actor || actor.portraitUrl) return;
    portrait(model, look).then((url) => {
      if (!url) return;
      actor.portraitUrl = url;
      onDone?.();
    });
  }

  return { portrait, forActor };
}
