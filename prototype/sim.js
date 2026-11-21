/* Fire twin: deterministic simulation core. No DOM, no network.
 * Grid hazards tick every 0.5 s; continuous crowds substep at 30 Hz. No render-owned physics. */
(function (root) {
  'use strict';

  const FLOOR = 0, WALL = 1, LOCKED = 2, DOOR = 3, EXIT = 4;
  const ACTIVE = 0, OUT = 1, DOWN = 2, INJURED = 3;
  const CROWD_DT = 1 / 30, SUBSTEPS = 15;
  const DT = 0.5;            // seconds per tick
  const DOSE_LIMIT = 45;     // smoke dose at which a person goes down
  /* Crowd events (opts.crowd = true, or a 'fall' event). 1 cell holds 1 person, so crush pressure is read from the
   * queue at an opening: people waiting per metre of its width, felt by the people near the front of the queue.
   * Demo heuristics, not calibrated crowd physics. */
  const CRUSH_PER_M = 16;    // queue pressure (people waiting per metre of opening) where pushing starts to hurt
  const CRUSH_FALL = 8;      // pressure-seconds (at the threshold) before a person in the press falls
  const CRUSH_FATAL = 24;    // pressure-seconds before a fallen person in the press is lost
  const FRONT = 2;           // cells from the opening (either axis) that count as the front of its queue
  const TRIP_P = 0.00006;    // chance per step to trip and fall; 4x in thick smoke
  const GET_UP_S = 25;       // a fallen person gets up (or is helped up) after this, then walks at half speed
  /* Furniture from layout.objects (seen by a camera). These types block walking; all furniture burns faster
   * than bare floor. Chairs and plants are drawn but people walk past them. */
  const BLOCKING = { table: 1, desk: 1, sofa: 1, counter: 1, bar: 1, stage: 1, shelf: 1, screen: 1 };
  const FURNITURE_FUEL = 2;      // fire spreads onto a furniture cell this many times faster
  const VIEW_HALF = 0.85;        // half of a phone's field of view, in radians (same as the cone that is drawn)
  /* Is cell (x, y) inside the view of a phone at v = {x, y, yaw}? Yaw 0 = north (-y), 90 = east (+x). */
  function inView(v, x, y) {
    const dx = x + 0.5 - v.x, dy = y + 0.5 - v.y;
    if (!dx && !dy) return false;
    let d = Math.atan2(dx, -dy) - v.yaw * Math.PI / 180;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d) <= VIEW_HALF;
  }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Layout schema (also the schema Gemini returns for a photo):
   * rooms: rectangles that INCLUDE their walls. Adjacent rooms share a wall
   *        (they overlap by exactly 1 cell). Corridors are rooms.
   * doors: openings in a wall shared by 2 rooms. exits: openings in an outer wall of the building.
   * Cells not covered by a room are outside the building. Presets: layouts.js. */
  const clone = o => JSON.parse(JSON.stringify(o));
  const openingsOf = L => L.doors.concat(L.exits);
  const inRect = (o, W, H) => o.x >= 0 && o.y >= 0 && o.x + o.w <= W && o.y + o.h <= H;

  /* Normalizes in place. Returns a list of errors (empty = OK). */
  function validateLayout(L) {
    if (!L || typeof L !== 'object') return ['layout is not an object'];
    const errs = [];
    const int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);
    L.width = int(L.width, NaN); L.height = int(L.height, NaN);
    if (!(L.width >= 10 && L.width <= 120)) errs.push('width must be 10..120');
    if (!(L.height >= 10 && L.height <= 80)) errs.push('height must be 10..80');
    if (errs.length) return errs;
    L.name = String(L.name || 'Layout').slice(0, 80);
    const list = (key, prefix, minSize, extra) => {
      L[key] = (Array.isArray(L[key]) ? L[key] : []).filter(o => o && typeof o === 'object');
      L[key].forEach((o, n) => {
        o.x = int(o.x, -1); o.y = int(o.y, -1);
        o.w = Math.max(1, int(o.w, 1)); o.h = Math.max(1, int(o.h, 1));
        const label = o.id || o.name || prefix + (n + 1);
        if (o.w < minSize || o.h < minSize) errs.push(label + ': w and h must be >= ' + minSize);
        if (!inRect(o, L.width, L.height)) errs.push(label + ': out of bounds');
        extra(o, n);
      });
      if (!L[key].length && key !== 'doors') errs.push('no ' + key);
    };
    list('rooms', 'Room ', 3, (r, n) => {
      r.name = String(r.name || 'Room ' + (n + 1)).slice(0, 40);
      r.people = Math.max(0, Math.min(400, int(r.people, 0)));
    });
    const opening = prefix => (o, n) => {
      o.id = String(o.id || prefix + (n + 1)).slice(0, 12);
      o.locked = !!o.locked;
      if (o.name != null) o.name = String(o.name).slice(0, 40);
    };
    list('doors', 'D', 1, opening('D'));
    list('exits', 'E', 1, opening('E'));
    return errs;
  }

  // Use matching furniture footprints for drawing, spawning and navigation.
  function furnitureCells(layout, terrain) {
    const cells = [];
    const objects = Array.isArray(layout.objects) ? layout.objects.slice(0, 120) : [];
    for (const object of objects) {
      if (!object || typeof object !== 'object') continue;
      const left = Math.round(+object.x), top = Math.round(+object.y);
      const right = Math.min(layout.width, left + Math.max(1, Math.round(+object.w) || 1));
      const bottom = Math.min(layout.height, top + Math.max(1, Math.round(+object.h) || 1));
      for (let y = Math.max(0, top); y < bottom; y++) {
        for (let x = Math.max(0, left); x < right; x++) {
          const i = y * layout.width + x;
          if (terrain[i] === FLOOR) cells.push({ i, x, y, object });
          if (cells.length === 4000) return cells;
        }
      }
    }
    return cells;
  }

  class Sim {
    constructor(layout, opts) {
      opts = opts || {};
      this.L = layout;
      this.crowdMode = opts.crowdMode === 'tiles' ? 'tiles' : 'continuous';
      this.modelVersion = this.crowdMode === 'continuous' ? 'continuous-v1' : 'tiles-v1';
      this.substep = 0; this.seconds = 0; this.alarmSeconds = -1;
      this.lastOutSeconds = 0; this.routeRevision = 0;
      this.requestedPeople = 0; this.unplaced = 0;
      // Awareness uses its own randomness so cues cannot change placement or fire.
      this.awareness = opts.awareness || null;
      this.cueDelivered = false;
      this.horizonSeconds = opts.horizonSeconds ?? (this.crowdMode === 'continuous' ? 120 : undefined);
      this.awarenessEvents = [];
      this.familiarDist = new Float64Array(layout.width * layout.height);
      const randAwareness = mulberry32((opts.seed || 7) * 3571 + 17);
      // A pre-rasterized voxel map supplies terrain and exact spawn cells.
      const grid = opts.grid;
      this.walkable = grid?.walkable;
      this.cellSize = grid?.cellSize ?? 1;
      const W = this.W = layout.width, H = this.H = layout.height, N = this.N = W * H;
      this.fireRate = opts.fireRate == null ? 0.08 : opts.fireRate;
      const seed = opts.seed || 7;
      this.randFire = mulberry32(seed * 7919 + 1);   // fire RNG is separate: same fire for every layout variant
      this.crowd = !!opts.crowd;                     // crush at queues + random trips
      this.randEvent = mulberry32(seed * 104729 + 5); // trips have their own RNG: fire and placement stay the same
      this.fallen = new Uint8Array(N);               // 1 = a fallen person lies here (nobody can step on it)
      this.falls = { crush: 0, trip: 0, event: 0 };
      this.lostBy = { fire: 0, smoke: 0, crush: 0 };
      this.crushAt = {};                             // opening id -> falls in its crush
      this.fallLog = [];                             // {i, why, tick}: where and when each fall happened
      const randPlace = mulberry32(seed);

      this.type = new Uint8Array(N).fill(WALL);
      this.roomOf = new Int16Array(N).fill(-1);
      this.tagOf = new Int16Array(N).fill(-1);       // cell -> index in this.openings
      this.fire = new Uint16Array(N);                // 0 = none, else burn age in ticks
      this.smoke = new Float32Array(N);
      this._smoke2 = new Float32Array(N);
      this.dist = new Float64Array(N).fill(Infinity);
      this.nearFire = new Uint8Array(N);
      this.occ = new Int32Array(N).fill(-1);
      this.covered = new Uint8Array(N);              // 1 = inside the building (a room rectangle), 0 = outside

      /* Neighbor table: adj[i] = [{j, a, b, len}]. First entries are the 4 straight
       * neighbors (a = b = -1). Diagonals carry the 2 cells that must be clear. */
      this.adj = new Array(N);
      for (let i = 0; i < N; i++) {
        const x = i % W, y = (i / W) | 0, list = [];
        DIRS.forEach(([dx, dy], d) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
          list.push(d < 4 ? { j: ny * W + nx, a: -1, b: -1, len: 1 }
                          : { j: ny * W + nx, a: y * W + nx, b: ny * W + x, len: 1.414 });
        });
        this.adj[i] = list;
      }

      layout.rooms.forEach((r, ri) => {
        for (let y = r.y + 1; y < r.y + r.h - 1; y++)
          for (let x = r.x + 1; x < r.x + r.w - 1; x++) { this.type[y * W + x] = FLOOR; this.roomOf[y * W + x] = ri; }
      });
      layout.rooms.forEach(r => {
        for (let y = r.y; y < r.y + r.h; y++) this.covered.fill(1, y * W + r.x, y * W + r.x + r.w);
        for (let x = r.x; x < r.x + r.w; x++) { this.type[r.y * W + x] = WALL; this.type[(r.y + r.h - 1) * W + x] = WALL; }
        for (let y = r.y; y < r.y + r.h; y++) { this.type[y * W + r.x] = WALL; this.type[y * W + r.x + r.w - 1] = WALL; }
      });

      if (grid) {
        this.type.set(grid.terrain);
        for (let i = 0; i < N; i++) this.covered[i] = grid.terrain[i] !== WALL ? 1 : 0;
      }
      this.openings = [];
      const addOpenings = (kind, refs) => refs.forEach(ref => {
        const cells = [];
        for (let dy = 0; dy < ref.h; dy++) for (let dx = 0; dx < ref.w; dx++) cells.push((ref.y + dy) * W + ref.x + dx);
        this.openings.push({ kind, ref, cells });
        this.refreshOpening(this.openings.length - 1, true);
      });
      addOpenings('door', layout.doors);
      addOpenings('exit', layout.exits);

      this.doorQueues = this.openings.map(() => ({
        waiting: 0, peak: 0, people: new Set(), waitSeconds: 0, maxWaitSeconds: 0, smokeSeconds: 0
      }));

      /* furniture = every furniture cell (for the views). furn[i] = 1: a BLOCKING piece stands on this floor cell,
       * so nobody can walk there. Cells next to a door or exit stay clear. One rule for drawing, spawning and routing. */
      this.furn = new Uint8Array(N);
      const nearOpening = new Uint8Array(N);
      for (const o of this.openings) for (const c of o.cells) { nearOpening[c] = 1; for (const e of this.adj[c]) nearOpening[e.j] = 1; }
      this.furniture = furnitureCells(layout, this.type);
      if (this.furniture.length) {
        for (const { i, object } of this.furniture) {
          if (BLOCKING[object.type] && !nearOpening[i]) this.furn[i] = 1;
        }
      }

      this.people = [];
      const spawn = (i, x = i % W + .5, y = Math.floor(i / W) + .5) => {
        if (!this.passable(i)) { this.unplaced++; return; }
        this.occ[i] = this.people.length;
        this.people.push({
          id: this.people.length, i, x, y, state: ACTIVE, dose: 0, cool: 0, delay: Math.floor(randPlace() * 10),
          queueOpening: -1, queueStreakSeconds: 0, knowsSecond: false, cueResponse: randAwareness(), crush: 0, fallenFor: 0, slow: false, pressOpening: -1
        });
      };
      if (grid) {
        this.requestedPeople += grid.spawnCells.length;
        for (const i of grid.spawnCells) {
          if (this.occ[i] >= 0) { this.unplaced++; continue; }
          spawn(i);
        }
      }
      layout.rooms.forEach((r, ri) => {
        const cells = [];
        for (let i = 0; i < N; i++) if (this.roomOf[i] === ri && this.type[i] === FLOOR && this.passable(i)) cells.push(i);
        for (let i = cells.length - 1; i > 0; i--) {
          const j = Math.floor(randPlace() * (i + 1)), t = cells[i]; cells[i] = cells[j]; cells[j] = t;
        }
        /* Phones counted these people in what they see: put them in the phones' fields of view first (r.views = their poses). */
        const vs = r.views || (r.view ? [r.view] : null), seen = i => vs.some(v => inView(v, i % W, (i / W) | 0));
        const order = vs ? cells.filter(seen).concat(cells.filter(i => !seen(i))) : cells;
        const wanted = r.people || 0;
        this.requestedPeople += wanted;
        // Dense rooms use physical subcell slots. The observation count is never silently reduced.
        const across = this.crowdMode === 'continuous' && wanted > order.length
          ? Math.max(1, Math.floor(this.cellSize / .46)) : 1;
        const count = Math.min(wanted, order.length * across * across);
        for (let k = 0; k < count; k++) {
          const i = order[k % order.length], slot = Math.floor(k / order.length);
          spawn(i, i % W + ((slot % across) + .5) / across,
            Math.floor(i / W) + (Math.floor(slot / across) + .5) / across);
        }
        this.unplaced += wanted - count;
      });

      this.scheduled = (opts.ignitions || []).map(o => ({
        substep: Number.isInteger(o.substep) ? o.substep : (o.tick | 0) * SUBSTEPS,
        x: o.x | 0, y: o.y | 0
      }));
      this.events = (opts.events || []).map(e => ({...e, substep: Number.isInteger(e.substep) ? e.substep : (e.tick | 0) * SUBSTEPS}));
      this.ignitions = [];      // log of this run; feed to a new Sim to replay the same fire
      this.tick = 0;
      this.alarmTick = -1;
      this.out = 0; this.down = 0;
      this.exitUse = {};
      this.lastOutTick = 0;
      this.lastProgress = 0;
      this.stuck = 0;
      this.done = false;

      /* A camera's furniture is rough. If it walls people in who had a route without it, do not use it. */
      if (this.furn.some(v => v)) {
        const walledIn = () => { this.computeDist(); return this.people.filter(p => this.trapped(p)).length; };
        const withFurniture = walledIn(), kept = this.furn;
        this.furn = new Uint8Array(N);
        if (withFurniture <= walledIn()) this.furn = kept; else this.furnitureDropped = true;
        this.dirty = true;
      }
      this.computeDist();
      if (this.crowdMode === 'continuous') {
        const crowd = root.ContinuousCrowd || (typeof require === 'function' ? require('./continuous.js') : null);
        if (!crowd) throw new Error('The continuous crowd module is missing.');
        this.crowdPhysics = crowd.create(this, opts);
      }
    }

    /* Call after ref.locked changes. */
    refreshOpening(idx, init) {
      const o = this.openings[idx];
      for (const c of o.cells) {
        this.type[c] = o.ref.locked || o.blocked ? LOCKED : (o.kind === 'exit' ? EXIT : DOOR);
        this.tagOf[c] = idx;
      }
      if (!init) { this.computeDist(); this.crowdPhysics?.refresh(); }
    }

    solid(i) { const t = this.type[i]; return t === WALL || t === LOCKED; }       // blocks fire, smoke, people
    passable(i) { return !this.solid(i) && !this.fire[i] && !this.furn[i] && (this.crowdMode === 'continuous' || !this.fallen[i]) && (!this.walkable || this.walkable[i] !== 0); }   // a person can stand here
    canStep(e) { return this.passable(e.j) && (e.a < 0 || (this.passable(e.a) && this.passable(e.b))); }

    ignite(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
      const i = y * this.W + x;
      if (this.solid(i) || this.fire[i]) return false;
      this.fire[i] = 1;
      if (this.alarmTick < 0) { this.alarmTick = this.tick; this.alarmSeconds = this.seconds; }
      this.ignitions.push({ tick: this.tick, substep: this.substep, x, y });
      this.dirty = true;
      return true;
    }

    /* An event from opts.events, on its tick. */
    runEvent(e) {
      if (e.type === 'alarm') { if (this.alarmTick < 0) { this.alarmTick = this.tick; this.alarmSeconds = this.seconds; } return; }
      if (e.type === 'block') {
        const k = this.openings.findIndex(o => o.ref.id === e.id);
        if (k >= 0 && !this.openings[k].blocked) { this.openings[k].blocked = true; this.refreshOpening(k, true); this.dirty = true; }
        return;
      }
      if (e.type === 'fall') {
        let best = null, bestD = Infinity;
        for (const p of this.people) {
          if (p.state !== ACTIVE) continue;
          const d = (p.i % this.W - e.x) ** 2 + (((p.i / this.W) | 0) - e.y) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) this.fall(best, 'event');
      }
    }

    fall(p, why) {
      p.state = INJURED; p.vx = p.vy = 0; p.fallenFor = 0; p.queueOpening = -1;
      this.fallen[p.i] = 1; this.falls[why]++; this.dirty = true; this.lastProgress = this.tick;
      this.fallLog.push({ i: p.i, why, tick: this.tick });
      if (why === 'crush' && p.pressOpening >= 0) {
        const id = this.openings[p.pressOpening].ref.id;
        this.crushAt[id] = (this.crushAt[id] || 0) + 1;
      }
    }

    getUp(p) { p.state = ACTIVE; p.slow = true; p.crush = 0; p.pressOpening = -1; this.fallen[p.i] = 0; this.dirty = true; }

    nearOpening(c, k) {
      const x = c % this.W, y = (c / this.W) | 0;
      return this.openings[k].cells.some(o => Math.max(Math.abs(o % this.W - x), Math.abs(((o / this.W) | 0) - y)) <= FRONT);
    }

    /* Queue pressure at an opening last tick: people waiting per metre of its width. */
    pressure(k) {
      const o = this.openings[k];
      return (this.doorQueues[k].prevWaiting || 0) / Math.max(o.ref.w, o.ref.h);
    }

    // Compatibility with existing headless callers: run to the next hazard boundary.
    step() {
      const end = (Math.floor(this.substep / SUBSTEPS) + 1) * SUBSTEPS;
      while (!this.done && this.substep < end) this.advance();
    }

    advance() {
      if (this.done) return;
      for (const s of this.scheduled) if (s.substep === this.substep) this.ignite(s.x, s.y);
      for (const e of this.events) if (e.substep === this.substep) this.runEvent(e);
      this.substep++;
      this.seconds = this.substep * CROWD_DT;
      this.tick = Math.floor(this.substep / SUBSTEPS);
      const boundary = this.substep % SUBSTEPS === 0;
      if (this.alarmTick < 0) {
        // Invalid or absent ignition must not leave a headless baseline running forever.
        if (this.seconds >= (Number.isFinite(this.horizonSeconds) ? this.horizonSeconds : 120)) this.done = true;
        return;
      }
      if (boundary) {
        this.spreadFire(); this.diffuseSmoke();
        if (this.dirty || this.tick % 2 === 0) this.computeDist();
      } else if (this.dirty) this.computeDist();
      if (this.crowdMode === 'tiles') {
        if (boundary) { this.deliverCue(); this.movePeople(); this.checkEnd(); }
      } else {
        this.deliverCue();
        if (boundary) {
          for (const q of this.doorQueues) q.prevWaiting = q.waiting;
          this.moveFallen();
          if (this.crowd) for (const p of this.people) {
            if (p.state !== ACTIVE || this.seconds - this.alarmSeconds < p.delay * DT) continue;
            const k = p.queueOpening, ratio = k >= 0 ? this.pressure(k) / CRUSH_PER_M : 0;
            if (ratio >= 1 && this.nearOpening(p.i, k)) {
              p.pressOpening = k; p.crush += ratio * DT;
              if (p.crush >= CRUSH_FALL) this.fall(p, 'crush');
            } else {
              p.crush = Math.max(0, p.crush - DT);
              if (Math.hypot(p.vx, p.vy) > .1 && this.randEvent() < TRIP_P * (this.smoke[p.i] > .4 ? 4 : 1)) { p.pressOpening = -1; this.fall(p, 'trip'); }
            }
          }
        }
        // Preserve the previous dose scale: 45 index-ticks = 22.5 index-seconds.
        for (const p of this.people) if (p.state === ACTIVE) {
          p.dose += this.smoke[p.i] * CROWD_DT / DT;
          if (this.fire[p.i] || p.dose > DOSE_LIMIT) this.leave(p, DOWN);
        }
        this.crowdPhysics.step(CROWD_DT);
        for (const p of this.people) if (p.state === ACTIVE && this.fire[p.i]) this.leave(p, DOWN);
        if (boundary) this.checkEnd();
        if (this.people.every(p => p.state !== ACTIVE && p.state !== INJURED)
          || (Number.isFinite(this.horizonSeconds) && this.seconds - this.alarmSeconds >= this.horizonSeconds - 1e-9)) this.done = true;
      }
    }

    spreadFire() {
      const { N, fire, adj } = this, add = [];
      for (let i = 0; i < N; i++) {
        if (!fire[i]) continue;
        if (fire[i] < 65535) fire[i]++;
        for (const e of adj[i]) {
          if (e.a >= 0) break;                                  // straight neighbors only
          if (!fire[e.j] && !this.solid(e.j) && this.randFire() < this.fireRate * (this.furn[e.j] ? FURNITURE_FUEL : 1)) add.push(e.j);
        }
      }
      for (const j of add) { fire[j] = 1; this.dirty = true; }
    }

    diffuseSmoke() {
      const { N, fire, adj, smoke } = this, next = this._smoke2;
      for (let i = 0; i < N; i++) {
        if (this.solid(i)) { next[i] = 0; continue; }
        if (fire[i]) { next[i] = 1; continue; }
        let sum = 0, n = 0;
        for (const e of adj[i]) {
          if (e.a >= 0) break;
          if (!this.solid(e.j)) { sum += smoke[e.j]; n++; }
        }
        next[i] = n ? (smoke[i] + 0.6 * (sum / n - smoke[i])) * 0.998 : smoke[i];
      }
      this._smoke2 = smoke; this.smoke = next;
    }

    /* Dijkstra from all open exits. Cost rises with smoke and near fire. */
    computeDist() {
      const { N, fire, nearFire, adj } = this;
      this.dirty = false; this.routeRevision++;
      nearFire.fill(0);
      for (let i = 0; i < N; i++) if (fire[i]) for (const e of adj[i]) nearFire[e.j] = 1;
      this.fillDistances(this.dist, this.awareness
        ? [this.awareness.familiar, this.awareness.second] : null);
      if (this.awareness) this.fillDistances(this.familiarDist, [this.awareness.familiar]);
    }

    /* Each knowledge group shares a field. Physical exits stay open. */
    fillDistances(dist, knownIds) {
      const { N, type, fire, smoke, nearFire, adj } = this;
      dist.fill(Infinity);
      const hk = [], hv = [];                                   // binary min-heap: keys, cells
      const push = (k, v) => {
        let c = hk.length; hk.push(k); hv.push(v);
        while (c > 0) {
          const p = (c - 1) >> 1;
          if (hk[p] <= k) break;
          hk[c] = hk[p]; hv[c] = hv[p]; c = p;
        }
        hk[c] = k; hv[c] = v;
      };
      const pop = () => {
        const top = hv[0], k = hk.pop(), v = hv.pop(), n = hk.length;
        if (n) {
          let c = 0;
          for (;;) {
            let l = 2 * c + 1; if (l >= n) break;
            if (l + 1 < n && hk[l + 1] < hk[l]) l++;
            if (hk[l] >= k) break;
            hk[c] = hk[l]; hv[c] = hv[l]; c = l;
          }
          hk[c] = k; hv[c] = v;
        }
        return top;
      };
      for (let i = 0; i < N; i++) if (type[i] === EXIT && !fire[i] && (!knownIds || knownIds.includes(this.openings[this.tagOf[i]].ref.id))) { dist[i] = 0; push(0, i); }
      while (hk.length) {
        const k = hk[0], i = pop();
        if (k > dist[i]) continue;
        for (const e of adj[i]) {
          if (!this.canStep(e)) continue;
          const nd = k + e.len * (1 + 6 * smoke[e.j]) + (nearFire[e.j] ? 12 : 0);
          if (nd < dist[e.j]) { dist[e.j] = nd; push(nd, e.j); }
        }
      }
    }

    deliverCue() {
      const a = this.awareness;
      if (!a || this.cueDelivered || !Number.isFinite(a.cueSeconds)) return;
      if (this.seconds - this.alarmSeconds + 1e-9 < a.cueSeconds) return;
      this.cueDelivered = true;
      for (const [index, p] of this.people.entries()) {
        if (p.state !== ACTIVE || p.cueResponse >= a.reception) continue;
        p.knowsSecond = true;
        this.awarenessEvents.push({ person: index + 1, seconds: this.seconds, exit: a.second });
      }
    }

    distanceFor(p) { return this.awareness && !p.knowsSecond ? this.familiarDist : this.dist; }

    trapped(p) { return this.distanceFor(p)[p.i] === Infinity; }

    /* With a route: go down the distance field. Without: go to cleaner air. */
    score(p, i) { return this.trapped(p) ? this.smoke[i] + this.nearFire[i] : this.distanceFor(p)[i]; }

    leave(p, state, detail) {
      if (p.state !== ACTIVE && p.state !== INJURED) return;
      if (p.state === INJURED) { this.fallen[p.i] = 0; this.dirty = true; }
      const openingIndex = typeof detail === 'number' ? detail : undefined;
      p.vx = p.vy = 0;
      p.state = state; this.occ[p.i] = -1; this.lastProgress = this.tick;
      if (state === DOWN) { this.down++; this.lostBy[typeof detail === 'string' ? detail : this.fire[p.i] ? 'fire' : 'smoke']++; return; }
      const opening = this.openings[openingIndex ?? this.tagOf[p.i]];
      const id = opening.ref.id;
      this.exitUse[id] = (this.exitUse[id] || 0) + 1;
      this.out++; this.lastOutSeconds = this.seconds; this.lastOutTick = this.seconds / DT;
    }

    /* Trace a denied step through the occupied line. An empty floor cell breaks
     * the chain. A blocker on the approach to an open threshold can anchor it,
     * even on a tick when the threshold itself has just cleared. The routing
     * score strictly decreases along every link, so the trace cannot cycle. */
    queueAt(cell, blocker, dist = this.dist) {
      if (this.tagOf[cell] >= 0) return this.tagOf[cell];
      while (blocker >= 0) {
        if (this.tagOf[blocker] >= 0) return this.tagOf[blocker];
        if (this.occ[blocker] < 0) break;
        let next = -1, cost = dist[blocker];
        for (const e of this.adj[blocker]) {
          if (dist[e.j] < cost && this.canStep(e)) {
            next = e.j;
            cost = dist[e.j];
          }
        }
        blocker = next;
      }
      return -1;
    }

    /* Snapshot only. Reading this from the UI never advances the meters. */
    queueStats() {
      return this.doorQueues.map((q, i) => ({
        id: this.openings[i].ref.id, kind: this.openings[i].kind,
        waiting: q.waiting, peak: q.peak, people: q.people.size,
        waitSeconds: +q.waitSeconds.toFixed(3), maxWaitSeconds: +q.maxWaitSeconds.toFixed(3), smokeSeconds: +q.smokeSeconds.toFixed(3)
      }));
    }

    /* Fallen people: they breathe smoke, can be crushed further, and get up after GET_UP_S. */
    moveFallen() {
      for (const p of this.people) {
        if (p.state !== INJURED) continue;
        const c = p.i;
        p.dose += this.smoke[c]; p.fallenFor += DT;
        if (p.pressOpening >= 0) {
          const ratio = this.pressure(p.pressOpening) / CRUSH_PER_M;
          if (ratio >= 1) p.crush += ratio * DT;
        }
        if (this.fire[c] || p.dose > DOSE_LIMIT || p.crush > CRUSH_FATAL) {
          this.leave(p, DOWN, this.fire[c] ? 'fire' : p.crush > CRUSH_FATAL ? 'crush' : 'smoke');
        } else if (p.fallenFor >= GET_UP_S) this.getUp(p);
      }
    }

    movePeople() {
      const { type, fire, smoke, occ, adj } = this;
      for (const q of this.doorQueues) { q.prevWaiting = q.waiting; q.waiting = 0; }
      this.moveFallen();
      const order = this.people.filter(p => p.state === ACTIVE).sort((a, b) => this.distanceFor(a)[a.i] - this.distanceFor(b)[b.i]);
      for (const p of order) {
        const dist = this.distanceFor(p);
        const c = p.i, previousQueue = p.queueOpening;
        p.queueOpening = -1;
        p.dose += smoke[c];
        if (fire[c] || p.dose > DOSE_LIMIT) { this.leave(p, DOWN, fire[c] ? 'fire' : 'smoke'); continue; }
        if (type[c] === EXIT) { this.leave(p, OUT); continue; }
        if (this.tick - this.alarmTick < p.delay || --p.cool > 0) continue;
        let best = -1, bestV = this.score(p, c) - (this.trapped(p) ? 0.02 : 0);
        let blocker = -1, blockerCost = dist[c];
        for (const e of adj[c]) {
          if (!this.canStep(e)) continue;
          if (occ[e.j] !== -1) {
            if (dist[e.j] < blockerCost) { blockerCost = dist[e.j]; blocker = e.j; }
            continue;
          }
          const v = this.score(p, e.j);
          if (v < bestV) { bestV = v; best = e.j; }
        }
        if (best < 0) {
          if (blocker >= 0 && Number.isFinite(dist[c])) {
            p.queueOpening = this.queueAt(c, blocker, dist);
            if (p.queueOpening >= 0) {
              const q = this.doorQueues[p.queueOpening];
              p.queueStreakSeconds = (previousQueue === p.queueOpening ? p.queueStreakSeconds : 0) + DT;
              q.waiting++;
              q.peak = Math.max(q.peak, q.waiting);
              q.people.add(p);
              q.waitSeconds += DT;
              q.maxWaitSeconds = Math.max(q.maxWaitSeconds, p.queueStreakSeconds);
              q.smokeSeconds += smoke[c] * DT;
              // Near the front of a long queue the crowd behind presses. Long enough and the person falls.
              const ratio = this.pressure(p.queueOpening) / CRUSH_PER_M;
              if (this.crowd && ratio >= 1 && this.nearOpening(c, p.queueOpening)) {
                p.pressOpening = p.queueOpening; p.crush += ratio * DT;
                if (p.crush >= CRUSH_FALL) { this.fall(p, 'crush'); continue; }
              } else p.crush = Math.max(0, p.crush - DT);
            }
          }
          p.cool = 1;
          continue;
        }
        p.crush = Math.max(0, p.crush - DT);
        if (this.crowd && this.randEvent() < TRIP_P * (smoke[c] > 0.4 ? 4 : 1)) { p.pressOpening = -1; this.fall(p, 'trip'); continue; }
        if (!this.trapped(p)) this.lastProgress = this.tick;
        occ[c] = -1; occ[best] = this.people.indexOf(p); p.i = best;
        p.cool = Math.max(1, Math.round(this.cellSize * (smoke[best] > 0.4 ? 4 : 2) * (p.slow ? 2 : 1)));   // smoke halves walking speed; so does a fall
      }
    }

    counts() {
      let active = 0, trapped = 0, injured = 0;
      for (const p of this.people) {
        if (p.state === ACTIVE) { active++; if (this.trapped(p)) trapped++; }
        else if (p.state === INJURED) injured++;
      }
      return { active, trapped, injured };
    }

    checkEnd() {
      const { active, trapped, injured } = this.counts();
      if (Number.isFinite(this.horizonSeconds) && this.alarmTick >= 0) {
        this.done = active + injured === 0 || this.seconds - this.alarmSeconds >= this.horizonSeconds - 1e-9;
        return;
      }
      if (active + injured === 0) this.done = true;
      else if (injured) this.stuck = 0;   // a fallen person can get up and free a blocked doorway
      else if (this.awareness && !this.cueDelivered && Number.isFinite(this.awareness.cueSeconds)
        && this.people.some(p => p.state === ACTIVE && p.cueResponse < this.awareness.reception)) this.stuck = 0;
      else if (trapped === active) { if (++this.stuck > 60) this.done = true; } else this.stuck = 0;
      if (this.tick - this.lastProgress > 400 || this.tick > 8000) this.done = true;
    }

    /* `lost` is the legacy not-evacuated total (down + still inside), not a fatality count. */
    stats() {
      const { active, trapped, injured } = this.counts();
      return { total: this.people.length, out: this.out, down: this.down, trapped, active, injured,
               lost: this.down + active + injured, falls: {...this.falls}, lostBy: {...this.lostBy}, crushAt: {...this.crushAt}, ticks: this.tick,
               seconds: Math.round(this.seconds), elapsedSeconds: this.seconds, lastOutSeconds: this.lastOutSeconds,
               requestedPeople: this.requestedPeople, unplaced: this.unplaced, crowdMode: this.crowdMode, modelVersion: this.modelVersion,
               exitUse: Object.assign({}, this.exitUse) };
    }

    /* Facts for the PA announcement. */
    status() {
      const rooms = new Set(), exits = { blocked: [], open: [], locked: [] };
      for (let i = 0; i < this.N; i++) if (this.fire[i] && this.roomOf[i] >= 0) rooms.add(this.L.rooms[this.roomOf[i]].name);
      for (const o of this.openings) {
        if (o.kind !== 'exit') continue;
        const bad = o.cells.some(c => this.fire[c] || this.nearFire[c] || this.smoke[c] > 0.6);
        exits[o.ref.locked ? 'locked' : bad ? 'blocked' : 'open'].push(o.ref.name ? o.ref.id + ' (' + o.ref.name + ')' : o.ref.id);
      }
      return Object.assign({ fireRooms: [...rooms] }, exits);
    }
  }

  /* Headless run. Same seed + same ignitions = same fire. */
  function run(layout, ignitions, opts) {
    const sim = new Sim(layout, Object.assign({}, opts, { ignitions }));
    while (!sim.done) sim.step();
    return Object.assign(sim.stats(), { queues: sim.queueStats() });
  }

  /* Returns a NEW layout with the action applied, or null if the action is invalid.
   * Actions: {action:'unlock', id} | {action:'unlock_all'} | {action:'add_exit', x, y}
   *          | {action:'cap_room', room, people} (an occupancy limit) | {action:'widen', id} (1 cell wider) */
  function applyAction(layout, a) {
    if (!a || typeof a !== 'object') return null;
    const L = clone(layout), locked = openingsOf(L).filter(o => o.locked);
    if (a.action === 'unlock' || a.action === 'unlock_all') {
      const targets = a.action === 'unlock_all' ? locked
        : locked.filter(o => o.id.toLowerCase() === String(a.id || '').toLowerCase());
      targets.forEach(o => { o.locked = false; });
      return targets.length ? L : null;
    }
    if (a.action === 'add_exit') {
      const x = Math.round(+a.x), y = Math.round(+a.y), W = L.width, H = L.height;
      if (!inRect({ x, y, w: 1, h: 1 }, W, H)) return null;
      const s = new Sim(L), i = y * W + x;
      const covered = (cx, cy) => inRect({ x: cx, y: cy, w: 1, h: 1 }, W, H) && s.covered[cy * W + cx];
      const floor = (cx, cy) => inRect({ x: cx, y: cy, w: 1, h: 1 }, W, H) && s.type[cy * W + cx] === FLOOR;
      // valid = a wall cell with floor on one side and the outside on the opposite side
      const through = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => floor(x + dx, y + dy) && !covered(x - dx, y - dy));
      if (s.type[i] !== WALL || !through) return null;
      L.exits.push({ id: 'N' + (L.exits.length + 1), name: 'New exit', x, y, w: 1, h: 1, locked: false });
      return L;
    }
    if (a.action === 'cap_room') {
      const r = L.rooms.find(room => room.name.toLowerCase() === String(a.room || '').toLowerCase());
      const cap = Math.round(+a.people);
      if (!r || !Number.isFinite(cap) || cap < 0 || cap >= r.people) return null;
      r.people = cap;
      return L;
    }
    if (a.action === 'widen') {
      const o = openingsOf(L).find(e => e.id.toLowerCase() === String(a.id || '').toLowerCase());
      if (!o) return null;
      const s = new Sim(L), W = L.width, H = L.height, along = o.w >= o.h;   // it grows along its wall
      const sides = (x, y) => along ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
      const sig = (x, y) => sides(x, y).map(([cx, cy]) => inRect({ x: cx, y: cy, w: 1, h: 1 }, W, H)
        ? (s.type[cy * W + cx] === WALL ? 'w' : 'f') + s.covered[cy * W + cx] : 'out').join();
      const want = sig(o.x, o.y);
      for (const [x, y] of along ? [[o.x + o.w, o.y], [o.x - 1, o.y]] : [[o.x, o.y + o.h], [o.x, o.y - 1]]) {
        if (!inRect({ x, y, w: 1, h: 1 }, W, H) || s.type[y * W + x] !== WALL || sig(x, y) !== want) continue;
        if (along) { o.x = Math.min(o.x, x); o.w++; } else { o.y = Math.min(o.y, y); o.h++; }
        return L;
      }
      return null;
    }
    return null;
  }

  /* Returns {layout, rooms} = a NEW layout with a Gemini observation applied (what a photo or video of
   * some rooms shows), and the names of the rooms it matched. null if it matched no room.
   * obs = {rooms:[{name, people, color}], wallColor, objects:[...], openings:[{id, locked}], notes:[...]} */
  function applyObservation(layout, obs) {
    if (!obs || typeof obs !== 'object') return null;
    const L = clone(layout), seen = [], list = v => (Array.isArray(v) ? v : []).filter(o => o && typeof o === 'object');
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    for (const o of list(obs.rooms)) {
      const r = L.rooms.find(room => same(room.name, o.name));
      if (!r) continue;
      if (Number.isFinite(+o.people)) r.people = Math.round(+o.people);
      if (typeof o.color === 'string') r.color = o.color;
      seen.push(r);
    }
    if (!seen.length) return null;
    const inSeen = o => seen.some(r => o.x >= r.x && o.y >= r.y && o.x < r.x + r.w && o.y < r.y + r.h);
    L.objects = list(L.objects).filter(o => !inSeen(o)).concat(list(obs.objects).filter(inSeen));   // new furniture replaces old, in these rooms only
    if (typeof obs.wallColor === 'string') L.wallColor = obs.wallColor;
    for (const o of list(obs.openings)) {
      const target = openingsOf(L).find(e => same(e.id, o.id));
      if (target) target.locked = !!o.locked;
    }
    L.notes = obs.notes;
    return { layout: L, rooms: seen.map(r => r.name) };
  }

  function actionLabel(a) {
    return a.action === 'unlock' ? 'Unlock ' + String(a.id).toUpperCase()
      : a.action === 'unlock_all' ? 'Unlock all'
      : a.action === 'add_exit' ? 'New exit at (' + Math.round(+a.x) + ',' + Math.round(+a.y) + ')'
      : a.action === 'cap_room' ? 'Limit ' + a.room + ' to ' + Math.round(+a.people)
      : a.action === 'widen' ? 'Widen ' + String(a.id).toUpperCase()
      : String(a.action);
  }

  const api = { Sim, run, applyAction, applyObservation, actionLabel, validateLayout, clone, openingsOf,                 DT, CROWD_DT, FLOOR, WALL, LOCKED, DOOR, EXIT, ACTIVE, OUT, DOWN, INJURED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
