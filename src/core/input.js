import * as THREE from 'three';

const CLICK_MOVE_PX = 6;
const CLICK_MS = 350;
const HOLD_MS = 450;

// Pointer → ray, click/hold discrimination, pickables, ground/sky dispatch.
export function createInput(ctx) {
  const { canvas, camera, events, world } = ctx;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const pickables = new Map(); // Object3D -> handlers
  let hovered = null;
  let hoverDirty = false;
  let lastPointerType = 'mouse';
  let down = null; // { x, y, t, id, holdTimer, holding, moved }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpV = new THREE.Vector3();

  function setNdc(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function payload(e, extra) {
    return {
      ndc: pointer.clone(),
      ray: raycaster.ray.clone(),
      clientX: e.clientX,
      clientY: e.clientY,
      isTouch: e.pointerType === 'touch',
      ...extra,
    };
  }

  function pickRoots() {
    return [...pickables.keys()].filter((o) => o.visible !== false && o.parent);
  }

  function findRoot(obj) {
    let o = obj;
    while (o) {
      if (pickables.has(o)) return o;
      o = o.parent;
    }
    return null;
  }

  function pick() {
    const roots = pickRoots();
    if (!roots.length) return null;
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const root = findRoot(hit.object);
      if (root) return { root, hit };
    }
    return null;
  }

  function markActivity() {
    ctx.state.idleTime = 0;
  }

  let firstInteraction = false;
  function gesture() {
    if (!firstInteraction) {
      firstInteraction = true;
      ctx.state.started = true;
      ctx.audio.unlock();
      events.emit('festival:first-interaction', {});
    } else {
      ctx.audio.unlock();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    lastPointerType = e.pointerType;
    markActivity();
    setNdc(e);
    const d = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, holding: false, moved: false };
    d.holdTimer = setTimeout(() => {
      if (down === d && !d.moved) {
        d.holding = true;
        events.emit('hold:start', { ndc: pointer.clone(), ray: raycaster.ray.clone(), heldMs: HOLD_MS });
      }
    }, HOLD_MS);
    down = d;
    events.emit('pointer:down', payload(e));
  });

  window.addEventListener('pointermove', (e) => {
    lastPointerType = e.pointerType;
    setNdc(e);
    if (down && e.pointerId === down.id) {
      markActivity();
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > CLICK_MOVE_PX && !down.moved) {
        down.moved = true;
        clearTimeout(down.holdTimer);
      }
    }
    if (e.target === canvas || down) {
      hoverDirty = true;
      events.emit('pointer:move', payload(e));
    }
  });

  function finish(e, cancelled) {
    if (!down || e.pointerId !== down.id) return;
    const d = down;
    down = null;
    clearTimeout(d.holdTimer);
    setNdc(e);
    const heldMs = performance.now() - d.t;
    const isClick = !cancelled && !d.moved && !d.holding && heldMs < CLICK_MS;
    events.emit('pointer:up', payload(e, { isClick, heldMs }));
    if (d.holding) events.emit('hold:end', { ndc: pointer.clone(), ray: raycaster.ray.clone(), heldMs });
    if (!cancelled) gesture();
    if (isClick) dispatchClick();
  }

  window.addEventListener('pointerup', (e) => finish(e, false));
  window.addEventListener('pointercancel', (e) => finish(e, true));

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    markActivity();
    gesture();
    events.emit('key', { key: e.key, code: e.code, repeat: e.repeat });
  });

  function dispatchClick() {
    const picked = pick();
    const groundHits = world.groundMeshes?.length ? raycaster.intersectObjects(world.groundMeshes, false) : [];
    const groundHit = groundHits[0];

    if (picked && (!groundHit || picked.hit.distance <= groundHit.distance + 0.01)) {
      const h = pickables.get(picked.root);
      try {
        h.onClick?.(picked.hit);
      } catch (err) {
        console.error('[input] pickable onClick threw', err);
      }
      events.emit('click:pickable', { object: picked.root, hit: picked.hit });
      return;
    }

    if (groundHit) {
      const normal = groundHit.face
        ? groundHit.face.normal.clone().transformDirection(groundHit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      events.emit('click:ground', { point: groundHit.point.clone(), normal });
      return;
    }

    if (!world.groundMeshes?.length) {
      // No terrain registered: approximate the ground with a plane at heightAt(0,0).
      plane.constant = -(world.heightAt?.(0, 0) ?? 0);
      if (raycaster.ray.intersectPlane(plane, tmpV) && tmpV.length() < 400) {
        tmpV.y = world.heightAt?.(tmpV.x, tmpV.z) ?? tmpV.y;
        events.emit('click:ground', { point: tmpV.clone(), normal: new THREE.Vector3(0, 1, 0) });
        return;
      }
    }

    const direction = raycaster.ray.direction.clone().normalize();
    const point = camera.position.clone().addScaledVector(direction, (world.skyRadius ?? 1500) * 0.6);
    events.emit('click:sky', { direction, point });
  }

  function setCursor(css) {
    canvas.style.cursor = css || '';
  }

  function update() {
    if (!hoverDirty || lastPointerType === 'touch' || down) return;
    hoverDirty = false;
    const picked = pick();
    const root = picked ? picked.root : null;
    if (root !== hovered) {
      if (hovered) {
        try {
          pickables.get(hovered)?.onHoverEnd?.();
        } catch (err) {
          console.error('[input] onHoverEnd threw', err);
        }
      }
      hovered = root;
      setCursor(root ? 'pointer' : '');
    }
    if (root) {
      try {
        pickables.get(root)?.onHover?.(picked.hit);
      } catch (err) {
        console.error('[input] onHover threw', err);
      }
    }
  }

  function addPickable(object3D, handlers = {}) {
    pickables.set(object3D, handlers);
    return () => {
      if (hovered === object3D) {
        hovered = null;
        setCursor('');
      }
      pickables.delete(object3D);
    };
  }

  return {
    pointer,
    raycaster,
    addPickable,
    setCursor,
    update,
    get hovered() {
      return hovered;
    },
  };
}
