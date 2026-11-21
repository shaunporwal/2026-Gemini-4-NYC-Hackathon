/* Wiring: DOM events <-> sim.js, render.js, gemini.js. No physics, no prompts. */
(function () {
  'use strict';
  const F = window.FireSim, G = window.Gemini, LAYOUTS = window.FireLayouts, FEED = window.Feed;
  const $ = id => document.getElementById(id);
  const SEED = 7;
  const KEY_STORE = 'fireTwinGeminiKey', INFORMED_STORE = 'fireTwinInformed';
  const PA_IDLE = 'Click the floor to start a fire. Click a door or exit to lock or unlock it.';
  const FIX_WAIT_S = 20;   // Find fix never waits longer than this for Gemini
  const DETAIL_S = 30;   // a room is rebuilt from its camera at most this often
  const LIVE_STALE_S = 5, LIVE_STOPPED = 'stopped', LIVE_NONE = 'No phone is sending. Open the phone link, pick a room, start the camera.';
  const FEED_ON = 'phones: on', FEED_OFF = 'phones: off';
  const KEY_SAVED = '· saved in this tab. Changes here apply at once.', KEY_MISSING = '· none. The Gemini steps are off.';
  const STATS = [['out', 'Out'], ['trapped', 'No route'], ['down', 'Down'], ['seconds', 'Time (s)']];

  /* plan = the layout as loaded (floor plan only). layout = the same building after the phones changed it.
   * seen = the rooms a phone changed. Every run on `layout` is also run on `plan`: the gap is what the cameras add. */
  const state = { layout: null, plan: null, seen: new Set(), label: '', sim: null, running: false, lastIgn: [], fix: null, annKey: '', annSeq: 0, acc: 0, last: 0 };
  /* Three views of the same sim: 2D canvas, 3D voxels, live phone cameras. Same interface; each starts on first use. */
  const VIEWS = {
    '2d': { canvas: 'cv', make: window.FireRender },
    '3d': { canvas: 'cv3d', make: window.FireRender3D },
    'live': { canvas: 'liveView', make: { create: (node, wrap) => window.FireRenderLive.create(node, wrap,
      { cameras: () => [...live.values()], frameUrl: FEED.frameUrl, qrUrl: FEED.qrUrl, info: FEED.info,
        captures: FEED.captures, captureUrl: FEED.captureUrl,
        rebuild: (room, urls) => rebuildRoom(room, urls), busy: () => detail.busy }) } }
  };
  let view = null;
  const simOpts = () => ({ seed: SEED, fireRate: +$('rate').value });
  const cfg = () => ({ key: $('key').value.trim(), model: $('model').value.trim(), deep: $('deep').value.trim() });
  const currentFire = () => (state.sim.ignitions.length ? state.sim.ignitions : state.lastIgn);

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function log(msg) { $('log').prepend(el('div', new Date().toLocaleTimeString() + '  ' + msg)); }

  function say(text) {
    $('pa').textContent = text;
    if (!$('voice').checked || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  /* One row format for both tables (runs, fix candidates). */
  function addRow(tbody, label, res, note) {
    const tr = el('tr');
    [label, res.out + '/' + res.total, res.lost, res.seconds + ' s'].forEach((v, k) => tr.append(el('td', v, k === 2 && res.lost ? 'bad' : '')));
    tbody.append(tr);
    if (note) { const td = el('td', note, 'note'); td.colSpan = 4; const r = el('tr'); r.append(td); tbody.append(r); }
  }

  let queueLayout, queueTick = -1, trackedOpening = -1;

  function buildQueueMenu(sim) {
    const menu = $('queueOpening');
    const selection = queueLayout === state.layout ? menu.value : '';
    const automatic = el('option', 'Follow busiest'); automatic.value = '';
    menu.replaceChildren(automatic);
    sim.openings.forEach((o, index) => {
      const name = (o.kind === 'exit' ? 'Exit ' : 'Door ') + o.ref.id;
      const opt = el('option', o.ref.name ? name + ' · ' + o.ref.name : name);
      opt.value = String(index);
      menu.append(opt);
    });
    menu.value = selection;
    queueLayout = state.layout;
    queueTick = -1;
  }

  function smokeValue(value) {
    if (value > 0 && value < 0.01) return '<0.01';
    return String(Number(value.toFixed(2)));
  }

  function updateQueues(sim) {
    queueTick = sim.tick;
    const rows = sim.queueStats(), selection = $('queueOpening').value;
    trackedOpening = selection === '' ? -1 : Number(selection);
    if (trackedOpening < 0) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], best = rows[trackedOpening];
        if (!r.people) continue;
        if (!best || r.waiting > best.waiting || (r.waiting === best.waiting && r.waitSeconds > best.waitSeconds)) trackedOpening = i;
      }
    }
    const row = rows[trackedOpening];
    $('queueName').textContent = row ? (row.kind === 'exit' ? 'Exit ' : 'Door ') + row.id : 'No queues recorded';
    $('qWaiting').textContent = row?.waiting ?? 0;
    $('qPeak').textContent = row?.peak ?? 0;
    $('qPeople').textContent = row?.people ?? 0;
    $('qWait').textContent = (row?.waitSeconds ?? 0) + ' person-s';
    $('qLongest').textContent = (row?.maxWaitSeconds ?? 0) + ' s';
    $('qSmoke').textContent = smokeValue(row?.smokeSeconds ?? 0) + ' smoke-s';
    $('queueMeans').textContent = row?.people
      ? 'Each affected person averaged ' + (row.waitSeconds / row.people).toFixed(1) + ' s of waiting and ' + smokeValue(row.smokeSeconds / row.people) + ' smoke-s.'
      : 'A person counts once per opening when their next step is blocked by another person in its queue.';
  }

  /* New sim on the current layout. With ignitions: replay that fire. */
  function reset(ignitions) {
    state.sim = new F.Sim(state.layout, Object.assign(simOpts(), { ignitions }));
    state.running = !!(ignitions && ignitions.length);
    state.annKey = ''; state.acc = 0;
    if (!state.running) $('pa').textContent = PA_IDLE;   // a fresh sim: clear the last run's announcement (no speech)
    view.fit(state.sim);
    buildQueueMenu(state.sim);
    showLabel();
  }

  /* What Gemini saw or heard in the last floor plan or video. Empty list = hide. */
  function showSeen(notes) {
    $('seen').replaceChildren(...notes.map(n => { const tr = el('tr'); tr.append(el('td', n)); return tr; }));
    $('seenTable').hidden = !notes.length;
  }

  /* ---- Live feed: phones -> perception server -> Observations, one per room. ---- */
  const live = new Map();   // room name -> latest Observation
  const marks = new Map();  // room name -> time of its newest Observation: the map flashes that room

  /* Tell the feed server the key and the rooms. Quiet if the server is off: the twin works without it. */
  function syncFeed() {
    if (!state.layout) return;
    FEED.configure(cfg().key, state.layout).catch(() => {});
  }

  /* The table is always on screen: with no phone it says so; a phone that stopped sending shows as stopped. */
  function showLive() {
    const now = Date.now() / 1000;
    const rows = [...live.values()].map(o => {
      const tr = el('tr'), st = o.stream || {}, stopped = now - (st.lastFrame || 0) > LIVE_STALE_S;
      const bad = !stopped && (o.events.length || st.error);
      const what = stopped ? LIVE_STOPPED : st.error || [o.density].concat(o.events).join(', ');
      [o.cameraId, o.peopleCount, what].forEach((v, k) => tr.append(el('td', v, k === 2 ? (bad ? 'bad' : stopped ? 'note' : '') : '')));
      return tr;
    });
    if (!rows.length) { const td = el('td', LIVE_NONE, 'note'); td.colSpan = 3; const tr = el('tr'); tr.append(td); rows.push(tr); }
    $('live').replaceChildren(...rows);
  }

  /* A camera frame rebuilds its room: Gemini reads the newest frame (furniture, colors, blocked doors, notes)
   * and the result goes into the layout, so the sim itself changes: people walk around the furniture and it burns.
   * Presenter only (the key is here), before the fire only, one room at a time, each room at most every DETAIL_S. */
  const detail = { busy: false, at: new Map() };
  /* urls = saved frames a person chose (the frames of a video). Without urls: the newest live frame, on a timer. */
  async function rebuildRoom(roomName, urls) {
    const asked = !!urls, no = why => { if (asked) log('Rebuild ' + roomName + ': ' + why); };
    if (!state.layout.rooms.some(r => r.name === roomName)) return no('this room is not in the layout on screen.');
    if (!FEED.presenter || !cfg().key) return no('Gemini reads frames on the presenter\'s laptop only.');
    if (detail.busy) return no('Gemini is reading another room. Try again in a few seconds.');
    if (state.sim.alarmTick >= 0) return no('press Reset first. The layout does not change during a fire.');
    if (!asked && performance.now() - (detail.at.get(roomName) || -Infinity) < DETAIL_S * 1000) return;
    detail.busy = true; detail.at.set(roomName, performance.now());
    try {
      urls = urls || [FEED.frameUrl(roomName)];
      if (asked) log('Gemini: reading ' + urls.length + ' frame' + (urls.length > 1 ? 's' : '') + ' of ' + roomName + '…');
      const files = await Promise.all(urls.map(async (u, k) => new File([await (await fetch(u)).blob()], roomName + '-' + k + '.jpg', { type: 'image/jpeg' })));
      const obs = await G.observeRoom(cfg(), files, state.layout, roomName);
      const res = F.applyObservation(state.layout, obs);
      if (!res || state.sim.alarmTick >= 0) return;            // the fire started while Gemini was reading: keep the layout
      const live1 = live.get(roomName), room = res.layout.rooms.find(r => r.name === roomName);
      if (live1 && !asked) room.people = live1.peopleCount;    // the feed's count is newer than this frame's
      state.layout = res.layout;
      $('json').value = JSON.stringify(state.layout);
      informed(roomName);
      showSeen(G.notesOf(state.layout));
      syncFeed();
      reset();
      const n = (state.layout.objects || []).filter(o => o.x >= room.x && o.x < room.x + room.w && o.y >= room.y && o.y < room.y + room.h).length;
      log('Gemini rebuilt ' + roomName + ' from ' + (asked ? urls.length + ' saved frame' + (urls.length > 1 ? 's' : '') : 'the camera') + ': ' + room.people + ' people, ' + n + ' furniture items.' + (state.sim.furnitureDropped ? ' They blocked the way out, so the sim does not use them.' : ''));
    } catch (e) { log('Room read: ' + e.message); } finally { detail.busy = false; }
  }

  /* One camera update. Before the fire: its head count goes into the twin. A camera that sees fire starts the fire. */
  function onObservation(o) {
    const room = state.layout.rooms.find(r => r.name === o.cameraId);
    if (!room) return;
    const before = live.get(o.cameraId), said = x => x && [x.peopleCount, x.density].concat(x.events).join();
    live.set(o.cameraId, o);
    marks.set(o.cameraId, performance.now());
    if (said(before) !== said(o)) log('Phone in ' + o.cameraId + ': ' + o.peopleCount + ' people, ' + [o.density].concat(o.events).join(', ') + '.');
    showLive();
    const sim = state.sim, idle = sim.alarmTick < 0;
    if (idle && o.stream && o.stream.ok && o.peopleCount !== room.people) {
      room.people = o.peopleCount;
      $('json').value = JSON.stringify(state.layout);
      informed(room.name);
      reset();
    }
    const cause = o.events.includes('fire') ? 'Camera in ' + room.name + ' sees fire.'
      : o.events.includes('alarm') ? 'Microphone in ' + room.name + ' hears an alarm.'
      : o.events.includes('screaming') ? 'Microphone in ' + room.name + ' hears screaming.' : '';
    if (idle && $('autofire').checked && cause) {
      const spot = fireSpot(room);
      if (spot && state.sim.ignite(spot.x, spot.y)) { state.running = true; log(cause + ' Fire started there.'); }
    } else if (idle) rebuildRoom(room.name);
  }

  /* A floor cell of the room to start a fire on: the one nearest its centre that can burn. */
  function fireSpot(room) {
    const sim = state.sim, cx = room.x + room.w / 2, cy = room.y + room.h / 2;
    let best = null, bestD = Infinity;
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (d < bestD && !sim.solid(y * sim.W + x)) { bestD = d; best = { x, y }; }
    }
    return best;
  }

  /* After a reload: bring back the camera-informed twin, if it is for a preset we still have. */
  function restoreInformed() {
    try {
      const kept = JSON.parse(sessionStorage.getItem(INFORMED_STORE) || 'null');
      const key = kept && kept.seen.length && Object.keys(LAYOUTS).find(k => LAYOUTS[k].name === kept.plan.name);
      if (!key) return;
      $('preset').value = key;
      loadLayout(kept.layout, kept);
      log('Restored the twin with the phones\' changes (' + kept.seen.length + ' rooms).');
    } catch (e) { sessionStorage.removeItem(INFORMED_STORE); }
  }

  function setView(mode) {
    const v = VIEWS[mode];
    Object.values(VIEWS).forEach(o => { $(o.canvas).hidden = o !== v; });
    v.view = v.view || v.make.create($(v.canvas), $('stage'));
    view = v.view;
    document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
    if (state.sim) view.fit(state.sim);
  }

  function showLabel() { $('layoutName').textContent = state.layout.name + ' · ' + state.label; }

  /* Keep the camera-informed layout across a reload of this tab (the phones' work must not be lost on stage). */
  function remember() {
    sessionStorage.setItem(INFORMED_STORE, JSON.stringify({ layout: state.layout, plan: state.plan, seen: [...state.seen] }));
  }

  /* A phone changed this room (head count or furniture). */
  function informed(roomName) { state.seen.add(roomName); remember(); }

  /* restored = {plan, seen} from remember(): L is then a camera-informed layout, not a fresh plan. */
  function loadLayout(L, restored) {
    const errs = F.validateLayout(L);
    if (errs.length) throw new Error(errs.join('; '));
    const s = new F.Sim(L).stats();
    if (!s.total) throw new Error('layout has no people');
    if (s.trapped) log('Warning: ' + s.trapped + ' of ' + s.total + ' people have no route to an exit.');
    state.layout = L; state.label = 'Baseline'; state.lastIgn = []; state.fix = null;
    state.plan = restored ? restored.plan : F.clone(L);
    state.seen = new Set(restored ? restored.seen : []);
    remember();
    $('json').value = JSON.stringify(L);
    $('apply').disabled = true;
    showSeen(G.notesOf(L));
    live.clear(); showLive();
    syncFeed();
    reset();
    say(PA_IDLE);
  }

  /* The run is over. If phones changed the twin, run the SAME fire on the plan-only twin too:
   * the 2 rows side by side show what the cameras and microphones add. */
  function onDone() {
    const r = state.sim.stats(), compare = state.seen.size && state.label === 'Baseline';
    state.running = false;
    state.lastIgn = state.sim.ignitions.slice();
    if (!compare) {
      addRow($('runs'), state.label, r);
      return say('Run complete. ' + r.out + ' out, ' + r.lost + ' lost.');
    }
    const p = F.run(state.plan, state.lastIgn, simOpts()), n = state.seen.size;
    addRow($('runs'), 'Floor plan only', p);
    addRow($('runs'), 'With phones (' + n + ' room' + (n > 1 ? 's' : '') + ')', r, 'Same fire. Phones changed: ' + [...state.seen].join(', ') + '.');
    log('Same fire: the floor plan alone predicts ' + p.lost + ' lost of ' + p.total + '. With the phones: ' + r.lost + ' lost of ' + r.total + '.');
    say('Run complete. ' + r.lost + ' lost. The floor plan alone predicted ' + p.lost + '.');
  }

  /* PA announcement when the set of blocked exits changes (and at the first fire). */
  async function checkAnnounce() {
    const st = state.sim.status(), key = st.blocked.join() + '|' + st.open.join();
    if (key === state.annKey) return;
    state.annKey = key;
    const seq = ++state.annSeq;
    let text = G.fallbackAnnouncement(st);
    $('pa').textContent = text;   // on screen at once; Gemini's wording replaces it (and is spoken) when it arrives
    if ($('gpa').checked && cfg().key) {
      try { text = await G.announce(cfg(), st); } catch (e) { log('PA: ' + e.message); }
    }
    if (seq === state.annSeq) say(text);
  }

  /* Candidates come from search (each locked opening) and from Gemini. The sim scores all of them. */
  async function findFix() {
    const ign = currentFire().slice();
    if (!ign.length) return log('Start a fire first.');
    $('fix').disabled = true;
    const locked = F.openingsOf(state.layout).filter(o => o.locked);
    const cands = locked.map(o => ({ action: { action: 'unlock', id: o.id }, source: 'Search' }));
    if (locked.length > 1) cands.push({ action: { action: 'unlock_all' }, source: 'Search' });
    const base = F.run(state.layout, ign, simOpts());
    if (cfg().key) {
      try {
        log('Gemini: proposing fixes…');
        const late = new Promise((ok, fail) => setTimeout(() => fail(new Error('Gemini took more than ' + FIX_WAIT_S + ' s. Showing the search results.')), FIX_WAIT_S * 1000));
        (await Promise.race([G.proposeFixes(cfg(), { layout: state.layout, ignitions: ign, baseline: base }), late]))
          .forEach(p => cands.push({ action: p, source: 'Gemini', reason: p.reason }));
      } catch (e) { log('Fix: ' + e.message); }
    }
    const scored = new Map();
    for (const c of cands) {
      c.label = F.actionLabel(c.action);
      const prev = scored.get(c.label);
      if (prev) { prev.source += ' + ' + c.source; prev.reason = prev.reason || c.reason; continue; }
      c.layout = F.applyAction(state.layout, c.action);
      if (!c.layout) { log('Rejected (invalid): ' + c.label + ' from ' + c.source); continue; }
      c.res = F.run(c.layout, ign, simOpts());
      c.changes = c.action.action === 'unlock_all' ? locked.length : 1;   // equal result: prefer the smaller change
      scored.set(c.label, c);
    }
    const ranked = [...scored.values()].sort((a, b) => a.res.lost - b.res.lost || a.changes - b.changes || a.res.seconds - b.res.seconds);
    const tbody = $('fixes'); tbody.textContent = '';
    addRow(tbody, 'No change', base);
    ranked.forEach(c => addRow(tbody, c.label, c.res, c.source + (c.reason ? ': ' + c.reason : '')));
    const best = ranked[0] && ranked[0].res.lost < base.lost ? ranked[0] : null;
    state.fix = best && { layout: best.layout, label: best.label, ign };
    $('apply').disabled = !best;
    $('fix').disabled = false;
    log(best ? 'Best fix: ' + best.label + ' (lost ' + base.lost + ' → ' + best.res.lost + ').' : 'No candidate is better than the baseline.');
  }

  function applyFix() {
    if (!state.fix) return;
    state.layout = state.fix.layout; state.label = state.fix.label;
    reset(state.fix.ign);
    say('Fix applied: ' + state.label + '. Same fire, new run.');
  }

  function onCanvasClick(ev) {
    const sim = state.sim, c = view.cellAt(sim, ev);
    if (!c) return;
    const tag = sim.tagOf[c.i];
    if (tag >= 0) {
      const ref = sim.openings[tag].ref;
      ref.locked = !ref.locked; sim.refreshOpening(tag);
      const same = F.openingsOf(state.plan).find(o => o.id === ref.id);   // a door a person locks is locked in both twins
      if (same) same.locked = ref.locked;
      remember();
      state.label = 'Manual: ' + ref.id + (ref.locked ? ' locked' : ' unlocked'); showLabel();
    } else if (sim.done) log('Run is complete. Use Reset or Replay.');
    else if (sim.ignite(c.x, c.y)) state.running = true;
  }

  function frame(t) {
    const dt = Math.min(0.1, (t - state.last) / 1000), sim = state.sim;
    state.last = t;
    if (state.running && !sim.done) {
      state.acc += dt * +$('speed').value;
      for (let n = 0; state.acc >= 1 && n < 40 && !sim.done; n++, state.acc--) sim.step();
      checkAnnounce();
      if (sim.done) onDone();
    }
    if (queueTick !== sim.tick) updateQueues(sim);
    view.draw(sim, t, { marks, tracked: trackedOpening });   // marks: rooms a phone just reported. tracked: the doorway on watch.
    const s = sim.stats();
    STATS.forEach(([k]) => { $('stat-' + k).textContent = s[k]; });
    requestAnimationFrame(frame);
  }

  function init() {
    STATS.forEach(([k, label]) => {
      const fact = el('div', null, 'fact ' + k);
      const num = el('b', '0'); num.id = 'stat-' + k;
      fact.append(el('span', label), num);
      $('stats').append(fact);
    });
    const on = (id, type, fn) => $(id).addEventListener(type, fn);
    const guarded = (what, fn) => async ev => { try { await fn(ev); } catch (e) { log(what + ': ' + e.message); } };
    Object.values(VIEWS).forEach(v => on(v.canvas, 'click', onCanvasClick));
    document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', guarded('View', () => setView(b.dataset.view))));
    on('queueOpening', 'change', () => updateQueues(state.sim));
    on('setup', 'click', () => $('setupDlg').showModal());
    on('pause', 'click', () => { state.running = !state.running && state.sim.alarmTick >= 0 && !state.sim.done; });
    on('reset', 'click', () => reset());
    on('replay', 'click', () => reset(currentFire().slice()));
    on('fix', 'click', guarded('Fix', findFix));
    on('apply', 'click', applyFix);
    on('loadJson', 'click', guarded('Layout', () => loadLayout(JSON.parse($('json').value))));
    on('preset', 'change', () => loadLayout(F.clone(LAYOUTS[$('preset').value])));
    /* job(files, status) -> {layout, note}. The status line shows each step and the time the call took. */
    const fromGemini = (what, job) => guarded(what, async ev => {
      const files = [...ev.target.files]; ev.target.value = '';
      if (!files.length) return;
      $('setupDlg').close();
      const t0 = Date.now(), res = await job(files, msg => log('Gemini: ' + msg));
      loadLayout(res.layout);
      log(what + ': ' + res.note + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
    });
    on('media', 'change', fromGemini('New twin', async (files, status) =>
      ({ layout: await G.layoutFromMedia(cfg(), files, LAYOUTS.demo, status), note: 'layout loaded.' })));
    on('walk', 'change', fromGemini('Update', async (files, status) => {
      const res = F.applyObservation(state.layout, await G.observe(cfg(), files, state.layout, status));
      if (!res) throw new Error('Gemini did not match a room of this layout');
      return { layout: res.layout, note: 'Gemini placed this in ' + res.rooms.join(' + ') + '.' };
    }));
    window.addEventListener('resize', () => view.fit(state.sim));
    Object.keys(LAYOUTS).forEach(k => { const o = el('option', LAYOUTS[k].name); o.value = k; $('preset').append(o); });
    /* The key survives a reload of this tab (sessionStorage). It is never written to a file. */
    const keyChanged = () => {
      sessionStorage.setItem(KEY_STORE, cfg().key);
      $('keyState').textContent = cfg().key ? KEY_SAVED : KEY_MISSING;
      syncFeed();
    };
    $('key').value = sessionStorage.getItem(KEY_STORE) || '';
    on('key', 'input', keyChanged);
    keyChanged();
    setView('2d');
    setInterval(showLive, 1000);
    FEED.listen(onObservation, up => { if (up) syncFeed(); $('feedState').textContent = up ? FEED_ON : FEED_OFF; });
    loadLayout(F.clone(LAYOUTS[$('preset').value]));
    if (FEED.presenter) restoreInformed();
    if (!FEED.presenter) {   // a copy opened from the feed server (a phone): follow the presenter's layout, link to the camera page
      $('pages').hidden = false; $('setup').hidden = $('preset').hidden = true;
      FEED.layout().then(L => { if (L) loadLayout(L); }).catch(() => {});
    }
    requestAnimationFrame(frame);
  }

  init();
})();
