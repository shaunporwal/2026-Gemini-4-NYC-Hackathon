/* Fire twin: deterministic simulation core. No DOM, no network.
 * Grid: 1 cell = 1 m. 1 tick = 0.5 s. Physics and routing are code, not LLM. */
(function (root) {
  'use strict';

  const FLOOR = 0, WALL = 1, LOCKED = 2, DOOR = 3, EXIT = 4;
  const ACTIVE = 0, OUT = 1, DOWN = 2;
  const DT = 0.5;            // seconds per tick
  const DOSE_LIMIT = 45;     // smoke dose at which a person goes down
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
      // Awareness uses its own randomness so cues cannot change placement or fire.
      this.awareness = opts.awareness || null;
      this.cueDelivered = false;
      this.horizonSeconds = opts.horizonSeconds;
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

      if (grid) this.type.set(grid.terrain);
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

      this.furniture = furnitureCells(layout, this.type);
      if (this.furniture.length) {
        this.walkable = grid ? grid.walkable.slice() : new Uint8Array(N).fill(1);
        for (const { i, object } of this.furniture) {
          if (object.type !== 'stage') this.walkable[i] = 0;
        }
      }

      this.people = [];
      const spawn = i => {
        if (!this.passable(i)) return;
        this.occ[i] = this.people.length;
        this.people.push({
          i, state: ACTIVE, dose: 0, cool: 0, delay: Math.floor(randPlace() * 10),
          queueOpening: -1, queueStreakSeconds: 0, knowsSecond: false, cueResponse: randAwareness()
        });
      };
      if (grid) grid.spawnCells.forEach(spawn);
      layout.rooms.forEach((r, ri) => {
        const cells = [];
        for (let i = 0; i < N; i++) if (this.roomOf[i] === ri && this.type[i] === FLOOR && this.passable(i)) cells.push(i);
        for (let i = cells.length - 1; i > 0; i--) {
          const j = Math.floor(randPlace() * (i + 1)), t = cells[i]; cells[i] = cells[j]; cells[j] = t;
        }
        for (let k = 0, n = Math.min(r.people || 0, cells.length); k < n; k++) {
          spawn(cells[k]);
        }
      });

      this.scheduled = (opts.ignitions || []).map(o => ({ tick: o.tick | 0, x: o.x | 0, y: o.y | 0 }));
      this.ignitions = [];      // log of this run; feed to a new Sim to replay the same fire
      this.tick = 0;
      this.alarmTick = -1;
      this.out = 0; this.down = 0;
      this.exitUse = {};
      this.lastOutTick = 0;
      this.lastProgress = 0;
      this.stuck = 0;
      this.done = false;
      this.computeDist();
    }

    /* Call after ref.locked changes. */
    refreshOpening(idx, init) {
      const o = this.openings[idx];
      for (const c of o.cells) {
        this.type[c] = o.ref.locked ? LOCKED : (o.kind === 'exit' ? EXIT : DOOR);
        this.tagOf[c] = idx;
      }
      if (!init) this.computeDist();
    }

    solid(i) { const t = this.type[i]; return t === WALL || t === LOCKED; }       // blocks fire, smoke, people
    passable(i) { return !this.solid(i) && !this.fire[i] && (!this.walkable || this.walkable[i] !== 0); }                        // a person can stand here
    canStep(e) { return this.passable(e.j) && (e.a < 0 || (this.passable(e.a) && this.passable(e.b))); }

    ignite(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
      const i = y * this.W + x;
      if (this.solid(i) || this.fire[i]) return false;
      this.fire[i] = 1;
      if (this.alarmTick < 0) this.alarmTick = this.tick;
      this.ignitions.push({ tick: this.tick, x, y });
      this.dirty = true;
      return true;
    }

    step() {
      if (this.done) return;
      for (const s of this.scheduled) if (s.tick === this.tick) this.ignite(s.x, s.y);
      this.tick++;
      if (this.alarmTick < 0) return;
      this.spreadFire();
      this.diffuseSmoke();
      if (this.dirty || this.tick % 2 === 0) this.computeDist();
      this.deliverCue();
      this.movePeople();
      this.checkEnd();
    }

    spreadFire() {
      const { N, fire, adj } = this, add = [];
      for (let i = 0; i < N; i++) {
        if (!fire[i]) continue;
        if (fire[i] < 65535) fire[i]++;
        for (const e of adj[i]) {
          if (e.a >= 0) break;                                  // straight neighbors only
          if (!fire[e.j] && !this.solid(e.j) && this.randFire() < this.fireRate) add.push(e.j);
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
      this.dirty = false;
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
      if ((this.tick - this.alarmTick) * DT < a.cueSeconds) return;
      this.cueDelivered = true;
      for (const [index, p] of this.people.entries()) {
        if (p.state !== ACTIVE || p.cueResponse >= a.reception) continue;
        p.knowsSecond = true;
        this.awarenessEvents.push({ person: index + 1, seconds: this.tick * DT, exit: a.second });
      }
    }

    distanceFor(p) { return this.awareness && !p.knowsSecond ? this.familiarDist : this.dist; }

    trapped(p) { return this.distanceFor(p)[p.i] === Infinity; }

    /* With a route: go down the distance field. Without: go to cleaner air. */
    score(p, i) { return this.trapped(p) ? this.smoke[i] + this.nearFire[i] : this.distanceFor(p)[i]; }

    leave(p, state) {
      p.state = state; this.occ[p.i] = -1; this.lastProgress = this.tick;
      if (state === DOWN) { this.down++; return; }
      const id = this.openings[this.tagOf[p.i]].ref.id;
      this.exitUse[id] = (this.exitUse[id] || 0) + 1;
      this.out++; this.lastOutTick = this.tick;
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
        waitSeconds: q.waitSeconds, maxWaitSeconds: q.maxWaitSeconds, smokeSeconds: q.smokeSeconds
      }));
    }

    movePeople() {
      const { type, fire, smoke, occ, adj } = this;
      for (const q of this.doorQueues) q.waiting = 0;
      const order = this.people.filter(p => p.state === ACTIVE).sort((a, b) => this.distanceFor(a)[a.i] - this.distanceFor(b)[b.i]);
      for (const p of order) {
        const dist = this.distanceFor(p);
        const c = p.i, previousQueue = p.queueOpening;
        p.queueOpening = -1;
        p.dose += smoke[c];
        if (fire[c] || p.dose > DOSE_LIMIT) { this.leave(p, DOWN); continue; }
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
            }
          }
          p.cool = 1;
          continue;
        }
        if (!this.trapped(p)) this.lastProgress = this.tick;
        occ[c] = -1; occ[best] = this.people.indexOf(p); p.i = best;
        p.cool = Math.max(1, Math.round(this.cellSize * (smoke[best] > 0.4 ? 4 : 2)));                    // smoke halves walking speed
      }
    }

    counts() {
      let active = 0, trapped = 0;
      for (const p of this.people) if (p.state === ACTIVE) { active++; if (this.trapped(p)) trapped++; }
      return { active, trapped };
    }

    checkEnd() {
      const { active, trapped } = this.counts();
      if (Number.isFinite(this.horizonSeconds) && this.alarmTick >= 0) {
        this.done = active === 0 || (this.tick - this.alarmTick) * DT >= this.horizonSeconds;
        return;
      }
      if (active === 0) this.done = true;
      else if (this.awareness && !this.cueDelivered && Number.isFinite(this.awareness.cueSeconds)
        && this.people.some(p => p.state === ACTIVE && p.cueResponse < this.awareness.reception)) this.stuck = 0;
      else if (trapped === active) { if (++this.stuck > 60) this.done = true; } else this.stuck = 0;
      if (this.tick - this.lastProgress > 400 || this.tick > 8000) this.done = true;
    }

    /* Live numbers. After the run ends, people still inside count as lost. */
    stats() {
      const { active, trapped } = this.counts();
      return { total: this.people.length, out: this.out, down: this.down, trapped, active,
               lost: this.down + active, ticks: this.tick,
               seconds: Math.round((this.done && !Number.isFinite(this.horizonSeconds) ? this.lastOutTick : this.tick) * DT),
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
   * Actions: {action:'unlock', id} | {action:'unlock_all'} | {action:'add_exit', x, y} */
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
      : String(a.action);
  }

  const api = { Sim, run, applyAction, applyObservation, actionLabel, validateLayout, clone, openingsOf,                 DT, FLOOR, WALL, LOCKED, DOOR, EXIT, ACTIVE, OUT, DOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
