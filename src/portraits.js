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
import { placeModel, applyCharacterProportions } from './models.js';

const SIZE = 128;
const STAGE_Y = -1000;
const HEAD_FALLBACK = 1.55; // head height if the rig has no `head` bone
const DIST = 1.15;          // camera distance - head and shoulders at fov 30

export function createPortraits(app) {
  const cache = new Map();   // key -> data URL (or null if it couldn't render)
  const inflight = new Map(); // key -> Promise
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

  // Tint an entity's materials. Portrait rigs are throwaway, but the .glb's
  // materials are SHARED with every character built from it - so clone first,
  // exactly as GridActor.attach does for the real bodies.
  function tint(entity, rgb) {
    if (!rgb) return;
    for (const rc of entity.findComponents('render')) {
      for (const mi of rc.meshInstances) {
        const m = mi.material.clone();
        m.diffuse.set(m.diffuse.r * rgb[0], m.diffuse.g * rgb[1], m.diffuse.b * rgb[2]);
        m.update();
        mi.material = m;
      }
    }
  }

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

    const p = new Promise((resolve) => {
      const finish = (url, entity) => {
        cam.enabled = false;
        if (entity) entity.destroy();
        cache.set(key, url);
        inflight.delete(key);
        resolve(url);
      };
      let settled = false;
      placeModel(app, `assets/characters/${model}.glb`, 0, 0, {
        lift: 0,
        rotY: 180, // face the camera
        animate: false,
        onReady: (e) => {
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
      // A .glb that never loads must not leave a caller waiting forever.
      setTimeout(() => { if (!settled) { settled = true; finish(null, null); } }, 8000);
    });
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
