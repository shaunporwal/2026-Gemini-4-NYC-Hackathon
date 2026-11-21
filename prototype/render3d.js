/* 3D voxel view of a Sim (three.js). Same interface as render.js: create() -> {fit, cellAt, draw}.
 * Reads sim state only; never changes it. The look follows web/src/render/scene.ts:
 * one box per cell, instanced. World: X = x, Z = y, Y up; 1 cell = 1 m. */
(function () {
  'use strict';
  const F = window.FireSim, T = window.THREE;

  const WALL_H = 2.2, FLOOR_T = 0.08, DRAG_PX = 5;
  const TILT = 55 * Math.PI / 180;   // start angle of the camera above the floor
  const COLOR = {
    sky: 0x0e1116, floor: 0x3a4150, wall: 0xb8bcc6, door: 0x4a7bd1, exit: 0x2ecc71, locked: 0xd0342c,
    route: 0x5ad1ff, queued: 0xb6ef69, trapped: 0xff4fd8, down: 0x8a2626, head: 0xf2b880, smoke: 0xb4b4be, object: 0x8b5a2b
  };
  const PERSON = { bodyH: 1.1, bodyW: 0.42, head: 0.34 };
  /* Furniture from layout.objects: [height in m, share of the cell that the voxel fills]. */
  const OBJECT = {
    table: [0.75, 0.96], desk: [0.75, 0.96], chair: [0.45, 0.6], sofa: [0.55, 0.92], counter: [1.0, 1], bar: [1.1, 1],
    stage: [0.4, 1], shelf: [1.8, 0.9], plant: [1.2, 0.5], screen: [1.8, 0.9]
  };
  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? parseInt(v.slice(1), 16) : d);
  /* Small fixed shade per cell, so flat areas read as blocks. */
  const shade = (x, y) => 0.9 + 0.1 * (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7 / 6;

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
    const box = new T.BoxGeometry(1, 1, 1);
    const m4 = new T.Matrix4(), col = new T.Color();
    const raycaster = new T.Raycaster(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    let group = null, built = null, size = '';
    let openings, fire, smoke, bodies, heads;
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });

    const outline = new T.LineLoop(new T.BufferGeometry().setFromPoints([
      new T.Vector3(0, 0, 0), new T.Vector3(1, 0, 0), new T.Vector3(1, 0, 1), new T.Vector3(0, 0, 1)
    ]), new T.LineBasicMaterial({ color: COLOR.queued, depthTest: false }));
    outline.renderOrder = 1;
    outline.visible = false;
    scene.add(outline);

    function instanced(count, opts) {
      const mesh = new T.InstancedMesh(box, new T.MeshLambertMaterial(Object.assign({ color: 0xffffff }, opts)), Math.max(1, count));
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
      const floors = instanced(N), walls = instanced(N);
      let nf = 0, nw = 0;
      for (let i = 0; i < N; i++) {
        if (!sim.covered[i]) continue;
        const x = i % W, y = (i / W) | 0, room = sim.roomOf[i] >= 0 ? L.rooms[sim.roomOf[i]] : null;
        if (sim.type[i] === F.WALL && sim.tagOf[i] < 0) put(walls, nw++, x, y, 0, WALL_H, 1, 1, wallColor, shade(x, y));
        else put(floors, nf++, x, y, 0, FLOOR_T, 1, 1, hex(room && room.color, COLOR.floor), shade(x, y));
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
      heads = instanced(sim.people.length);

      built = sim;
    }

    /* Put the whole building in view, seen from the south at TILT above the floor. */
    function frameCamera(W, H) {
      const half = Math.tan(camera.fov * Math.PI / 360);
      const d = Math.max(W * 0.6 / (half * camera.aspect), H * 0.7 / half);
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

    function draw(sim, t, trackedOpening) {
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

      let np = 0;
      for (const p of sim.people) {
        if (p.state === F.OUT) continue;
        const x = p.i % W, y = (p.i / W) | 0, isDown = p.state === F.DOWN;
        const color = isDown ? COLOR.down : p.queueOpening >= 0 ? COLOR.queued : sim.trapped(p) ? COLOR.trapped : COLOR.route;
        if (isDown) {   // lying on the floor
          put(bodies, np, x, y, FLOOR_T, PERSON.bodyW, PERSON.bodyH * 0.8, PERSON.bodyW, color);
          put(heads, np++, x, y, FLOOR_T, 0.01, 0.01, 0.01, COLOR.head);
        } else {
          put(bodies, np, x, y, FLOOR_T, PERSON.bodyH, PERSON.bodyW, PERSON.bodyW, color);
          put(heads, np++, x, y, FLOOR_T + PERSON.bodyH, PERSON.head, PERSON.head, PERSON.head, COLOR.head);
        }
      }
      done(bodies, np); done(heads, np);

      controls.update();
      renderer.render(scene, camera);
    }

    return { fit, cellAt, draw };
  }

  window.FireRender3D = { create };
})();
