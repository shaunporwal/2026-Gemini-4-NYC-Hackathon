/* 3D voxel view of a Sim (three.js). Same interface as render.js: create() -> {fit, cellAt, draw}.
 * Reads sim state only; never changes it. The look follows web/src/render/scene.ts:
 * one box per cell, instanced. World: X = x, Z = y, Y up; 1 cell = 1 m. */
(function () {
  'use strict';
  const F = window.FireSim, T = window.THREE;

  const WALL_H = 2.2, FLOOR_T = 0.08, DRAG_PX = 5;
  const KEY_PAN = 0.06;              // one key press moves the view this share of the camera's distance
  const TILT = 55 * Math.PI / 180;   // start angle of the camera above the floor
  const COLOR = {
    sky: 0x1c2420, floor: 0xb5b5a1, wall: 0xe0decb, door: 0x4a7bd1, exit: 0x2ecc71, locked: 0xd0342c,
    route: 0x529e9a, queued: 0xe99f60, trapped: 0xff4fd8, down: 0x8a2626, head: 0xf2b880, smoke: 0xb4b4be, object: 0x8b5a2b
  };
  /* Furniture from layout.objects: [height in m, share of the cell that the voxel fills]. */
  const OBJECT = {
    table: [0.75, 0.96], desk: [0.75, 0.96], chair: [0.45, 0.6], sofa: [0.55, 0.92], counter: [1.0, 1], bar: [1.1, 1],
    stage: [0.4, 1], shelf: [1.8, 0.9], plant: [1.2, 0.5], screen: [1.8, 0.9]
  };
  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? parseInt(v.slice(1), 16) : d);
  /* Small fixed shade per cell, so flat areas read as blocks. */
  const shade = (x, y) => 0.96 + 0.04 * ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 7) / 6;

  function create(canvas, wrap) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new T.Scene();
    scene.background = new T.Color(COLOR.sky);
    scene.add(new T.HemisphereLight(0xffffff, 0x334455, 1.4));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new T.PerspectiveCamera(50, 1, 0.1, 2000);
    const controls = new window.OrbitControls(camera, canvas);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    /* Move across the map (pan): right-drag, Shift + drag, 2 fingers, or the arrow keys / W A S D.
     * Panning slides along the floor, so from above it is plain left-right and up-down on the plan. */
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    const KEY_STEP = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
    window.addEventListener('keydown', ev => {
      const step = KEY_STEP[ev.code], at = ev.target;
      if (!step || canvas.hidden || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (at && at.closest && at.closest('input, select, textarea, button, dialog, .strip')) return;   // typing, or stepping through saved frames
      ev.preventDefault();
      const ahead = new T.Vector3().subVectors(controls.target, camera.position).setY(0);
      if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);             // looking straight down: "up" is north
      ahead.normalize();
      const right = new T.Vector3(-ahead.z, 0, ahead.x);
      const move = right.multiplyScalar(step[0]).add(ahead.multiplyScalar(step[1]))
        .multiplyScalar(camera.position.distanceTo(controls.target) * KEY_PAN);
      camera.position.add(move); controls.target.add(move);
    });
    const box = new T.BoxGeometry(1, 1, 1);
    const m4 = new T.Matrix4(), col = new T.Color();
    const raycaster = new T.Raycaster(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    let group = null, built = null, size = '';
    let openings, fire, smoke, bodies, heads, limbs, walls, heat;
    const crowd = window.CrowdVisual.create();
    const sphere = new T.SphereGeometry(0.5, 8, 6);
    const rootMatrix = new T.Matrix4(), partMatrix = new T.Matrix4();
    const rotation = new T.Quaternion(), position = new T.Vector3(), scale = new T.Vector3();
    const shirts = [0x467e86, 0x9b785f, 0x6f86a0, 0x678577, 0xa78c62, 0x9c787e];
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });

    const outline = new T.LineLoop(new T.BufferGeometry().setFromPoints([
      new T.Vector3(0, 0, 0), new T.Vector3(1, 0, 0), new T.Vector3(1, 0, 1), new T.Vector3(0, 0, 1)
    ]), new T.LineBasicMaterial({ color: COLOR.queued, depthTest: false }));
    outline.renderOrder = 1;
    outline.visible = false;
    scene.add(outline);

    function instanced(count, opts, geometry = box) {
      const mesh = new T.InstancedMesh(geometry, new T.MeshLambertMaterial(Object.assign({ color: 0xffffff }, opts)), Math.max(1, count));
      mesh.count = 0;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    }

    /* Box with its base at height y0. sx, sz = footprint; h = height. */
    function put(mesh, k, x, y, y0, h, sx, sz, color, tint) {
      m4.makeScale(sx, h, sz).setPosition(x + 0.5, y0 + h / 2, y + 0.5);
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, col.setHex(color).multiplyScalar(tint == null ? 1 : tint));
    }

    function done(mesh, n) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    function build(sim) {
      if (group) { scene.remove(group); group.traverse(o => { if (o.isInstancedMesh) { o.material.dispose(); o.dispose(); } }); }
      group = new T.Group();
      scene.add(group);
      const { W, H, N } = sim, L = sim.L, wallColor = hex(L.wallColor, COLOR.wall);
      const floors = instanced(N); walls = instanced(N);
      let nf = 0, nw = 0;
      for (let i = 0; i < N; i++) {
        if (!sim.covered[i]) continue;
        const x = i % W, y = (i / W) | 0;
        if (sim.type[i] === F.WALL && sim.tagOf[i] < 0) put(walls, nw++, x, y, 0, WALL_H, 1, 1, wallColor, shade(x, y));
        else put(floors, nf++, x, y, 0, FLOOR_T, 1, 1, COLOR.floor, shade(x, y));
      }
      done(floors, nf); done(walls, nw);

      const objects = instanced(sim.furniture.length);
      sim.furniture.forEach(({ x, y, object }, k) => {
        const spec = OBJECT[object.type] || OBJECT.table;
        put(objects, k, x, y, FLOOR_T, spec[0], spec[1], spec[1], hex(object.color, COLOR.object), shade(x, y));
      });
      done(objects, sim.furniture.length);

      openings = instanced(sim.openings.reduce((n, o) => n + o.cells.length, 0));
      fire = instanced(N, { emissive: 0xff5a00, emissiveIntensity: 0.6 });
      smoke = instanced(N, { transparent: true, opacity: 0.5, depthWrite: false });
      bodies = instanced(sim.people.length);
      heads = instanced(sim.people.length, {}, sphere);
      limbs = instanced(sim.people.length * 4);
      heat = instanced(N, { transparent: true, opacity: 0.65, depthWrite: false });

      built = sim;
    }

    /* Put the whole building in view, seen from the south at TILT above the floor. */
    function frameCamera(W, H) {
      const half = Math.tan(camera.fov * Math.PI / 360);
      // Include the near edge’s perspective depth, with room for labels and people.
      const nearDepth = H / 2 * Math.cos(TILT);
      const d = 1.12 * Math.max(W / (2 * half * camera.aspect) + nearDepth,
        H / 2 * Math.sin(TILT) / half + nearDepth);
      camera.position.set(W / 2, d * Math.sin(TILT), H / 2 + d * Math.cos(TILT));
      controls.target.set(W / 2, 0, H / 2);
      controls.update();
    }

    function fit(sim) {
      if (built !== sim) build(sim);
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const key = sim.W + 'x' + sim.H;
      if (size !== key) { size = key; frameCamera(sim.W, sim.H); }   // same building size: keep the user's angle
    }

    /* Click -> cell. A drag (orbit) is not a click. Doors and exits are picked on their block. */
    function cellAt(sim, ev) {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > DRAG_PX) return null;
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new T.Vector2((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1), camera);
      const hit = raycaster.intersectObject(openings)[0], p = new T.Vector3();
      if (hit) openings.getMatrixAt(hit.instanceId, m4), p.setFromMatrixPosition(m4);
      else if (!raycaster.ray.intersectPlane(floorPlane, p)) return null;
      const x = Math.floor(p.x), y = Math.floor(p.z);
      return x < 0 || y < 0 || x >= sim.W || y >= sim.H ? null : { x, y, i: y * sim.W + x };
    }

    function draw(sim, t, extra) {
      const trackedOpening = extra ? extra.tracked : -1;
      if (built !== sim) fit(sim);
      const { W, N } = sim;
      let n = 0;
      for (const o of sim.openings) for (const i of o.cells) {
        const x = i % W, y = (i / W) | 0;
        if (o.ref.locked) put(openings, n++, x, y, 0, WALL_H, 1, 1, COLOR.locked);
        else put(openings, n++, x, y, 0, FLOOR_T + 0.04, 1, 1, o.kind === 'exit' ? COLOR.exit : COLOR.door);
      }
      done(openings, n);
      const tracked = sim.openings[trackedOpening];
      outline.visible = !!tracked;
      if (tracked) {
        const o = tracked.ref;
        outline.position.set(o.x - 0.1, FLOOR_T + 0.05, o.y - 0.1);
        outline.scale.set(o.w + 0.2, 1, o.h + 0.2);
      }

      let nf = 0, ns = 0;
      for (let i = 0; i < N; i++) {
        const x = i % W, y = (i / W) | 0;
        if (sim.fire[i]) {
          const f = 0.5 + 0.5 * Math.sin(t / 90 + i * 1.7);
          put(fire, nf++, x, y, FLOOR_T, 0.5 + 1.1 * f, 0.9, 0.9, col.setRGB(1, 0.27 + 0.55 * f, 0.08 + 0.15 * f).getHex());
        } else if (sim.smoke[i] > 0.05 && sim.type[i] !== F.WALL) {
          const h = Math.min(1, sim.smoke[i]) * 1.6;   // smoke fills the room from the ceiling down
          put(smoke, ns++, x, y, WALL_H - h, h, 1, 1, COLOR.smoke);
        }
      }
      done(fire, nf); done(smoke, ns);

      walls.scale.y = extra?.cutaway ? 0.35 : 1;
      const visual = crowd.update(sim, t, extra || {});
      let nh = 0;
      if (extra?.congestion) {
        for (let i = 0; i < N; i++) {
          if (!sim.covered[i] || sim.solid(i) || sim.fire[i]) continue;
          const count = visual.crowding[i], waiting = visual.queued[i];
          if (count < 3 && !waiting) continue;
          const color = waiting >= 2 || count >= 6 ? 0xdf7667 : count >= 4 ? 0xe5a56c : 0xdbca79;
          put(heat, nh++, i % W, Math.floor(i / W), FLOOR_T + 0.015, 0.015, 0.97, 0.97, color);
        }
      }
      done(heat, nh);

      // Articulated figures follow engine positions. Animation never changes their route or speed.
      function part(mesh, index, x, y, z, sx, sy, sz, pitch, color) {
        position.set(x, y, z); scale.set(sx, sy, sz);
        rotation.setFromAxisAngle(new T.Vector3(1, 0, 0), pitch);
        partMatrix.compose(position, rotation, scale);
        m4.multiplyMatrices(rootMatrix, partMatrix);
        mesh.setMatrixAt(index, m4); mesh.setColorAt(index, col.setHex(color));
      }
      let np = 0, nl = 0;
      sim.people.forEach((p, index) => {
        if (p.state === F.OUT) return;
        const track = visual.tracks[index], isDown = p.state === F.DOWN;
        const color = isDown ? COLOR.down : p.queueOpening >= 0 ? COLOR.queued : sim.trapped(p) ? COLOR.trapped : shirts[index % shirts.length];
        rotation.setFromAxisAngle(new T.Vector3(0, 1, 0), track.heading);
        rootMatrix.compose(position.set(track.x + 0.5, FLOOR_T, track.y + 0.5), rotation, scale.set(1, 1, 1));
        if (isDown) {
          part(bodies, np, 0, 0.17, 0, 0.38, 0.25, 0.9, 0, color);
          part(heads, np, 0, 0.18, 0.6, 0.29, 0.29, 0.29, 0, COLOR.head);
        } else {
          const stride = p.queueOpening >= 0 ? 0 : track.phase;
          part(bodies, np, 0, 0.88, 0, 0.42, 0.57, 0.28, 0, color);
          part(heads, np, 0, 1.35, 0, 0.33, 0.36, 0.33, 0, p.knowsSecond ? 0xc4a0ff : COLOR.head);
          part(limbs, nl++, -0.12, 0.31, stride * 0.15, 0.15, 0.57, 0.17, stride, 0x34464b);
          part(limbs, nl++, 0.12, 0.31, -stride * 0.15, 0.15, 0.57, 0.17, -stride, 0x34464b);
          part(limbs, nl++, -0.29, 0.84, -stride * 0.15, 0.13, 0.49, 0.14, -stride, color);
          part(limbs, nl++, 0.29, 0.84, stride * 0.15, 0.13, 0.49, 0.14, stride, color);
        }
        np++;
      });
      done(bodies, np); done(heads, np); done(limbs, nl);

      controls.update();
      renderer.render(scene, camera);
    }

    function focusOpening(sim, index) {
      const opening = sim.openings[index].ref;
      const target = new T.Vector3(opening.x + opening.w / 2, 0, opening.y + opening.h / 2);
      const offset = camera.position.clone().sub(controls.target).normalize().multiplyScalar(22);
      controls.target.copy(target); camera.position.copy(target).add(offset); controls.update();
    }
    return { fit, cellAt, draw, focusOpening, home: sim => frameCamera(sim.W, sim.H) };
  }

  window.FireRender3D = { create };
})();
