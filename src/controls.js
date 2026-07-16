// Camera rig + mouse input. Translates raw events into semantic game input:
// onLeftClickTile(tile) / onRightClickTile(tile, screenX, screenY). Orbiting
// and zooming are handled entirely in here - game logic never sees them.
const pc = window.pc;

export function createControls({ app, canvas, focus, onLeftClickTile, onRightClickTile, onAnyLeftPress, onLeftDragTile }) {
  // Rig: camYaw (spins around the focus) -> camPitch (tilts) -> camera (sits
  // back at a fixed distance, looking at the focus).
  const camYaw = new pc.Entity('camYaw');
  const camPitch = new pc.Entity('camPitch');
  const cameraEntity = new pc.Entity('camera');
  camYaw.addChild(camPitch);
  camPitch.addChild(cameraEntity);
  app.root.addChild(camYaw);
  cameraEntity.addComponent('camera', {
    projection: pc.PROJECTION_ORTHOGRAPHIC,
    clearColor: new pc.Color(0.1, 0.1, 0.15),
    nearClip: 0.1,
    farClip: 1000,
  });

  const CAM = {
    yaw: 45, pitch: 34, zoom: 6, dist: 60,
    minZoom: 2.5, maxZoom: 11, minPitch: 12, maxPitch: 72,
  };
  cameraEntity.setLocalPosition(0, 0, CAM.dist);
  function apply() {
    camYaw.setLocalEulerAngles(0, CAM.yaw, 0);
    camPitch.setLocalEulerAngles(-CAM.pitch, 0, 0);
    cameraEntity.camera.orthoHeight = CAM.zoom;
  }
  apply();
  camYaw.setPosition(focus.x, 0.3, focus.z);

  app.mouse.disableContextMenu(); // the game draws its own right-click menu
  // Chromium starts autoscroll on middle-press; suppress just the default.
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  // Keep wheel events inside the game: without this the browser (or the
  // itch.io page hosting the iframe) scrolls instead of zooming.
  canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  let orbiting = false;
  let leftHeld = false; // for drag-painting in the editor
  app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
    if (e.button === pc.MOUSEBUTTON_MIDDLE) {
      orbiting = true;
    } else if (e.button === pc.MOUSEBUTTON_LEFT) {
      leftHeld = true;
      onAnyLeftPress && onAnyLeftPress();
      onLeftClickTile && onLeftClickTile(screenToTile(e.x, e.y));
    } else if (e.button === pc.MOUSEBUTTON_RIGHT) {
      onRightClickTile && onRightClickTile(screenToTile(e.x, e.y), e.x, e.y);
    }
  });
  app.mouse.on(pc.EVENT_MOUSEUP, (e) => {
    if (e.button === pc.MOUSEBUTTON_MIDDLE) orbiting = false;
    if (e.button === pc.MOUSEBUTTON_LEFT) leftHeld = false;
  });
  app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
    if (orbiting) {
      CAM.yaw -= e.dx * 0.3;
      CAM.pitch = pc.math.clamp(CAM.pitch + e.dy * 0.3, CAM.minPitch, CAM.maxPitch);
      apply();
    } else if (leftHeld && onLeftDragTile) {
      onLeftDragTile(screenToTile(e.x, e.y));
    }
  });
  app.mouse.on(pc.EVENT_MOUSEWHEEL, (e) => {
    // Scroll up (away from you) zooms in - wheelDelta is negative for
    // scroll-up, so adding it shrinks the ortho height.
    CAM.zoom = pc.math.clamp(CAM.zoom + e.wheelDelta * 0.6, CAM.minZoom, CAM.maxZoom);
    apply();
  });

  // Turn a screen pixel into the grid tile under it (ray -> ground plane).
  const _near = new pc.Vec3();
  const _far = new pc.Vec3();
  function screenToTile(sx, sy) {
    cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.nearClip, _near);
    cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.farClip, _far);
    const dir = _far.clone().sub(_near);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (0 - _near.y) / dir.y;
    if (t < 0) return null;
    const p = _near.add(dir.scale(t));
    return { x: Math.round(p.x), z: Math.round(p.z) };
  }

  // Ease the rig toward the target each frame so the camera trails the player.
  function follow(target) {
    const c = camYaw.getPosition();
    camYaw.setPosition(pc.math.lerp(c.x, target.x, 0.15), 0.3, pc.math.lerp(c.z, target.z, 0.15));
  }

  return { cameraEntity, screenToTile, follow };
}
