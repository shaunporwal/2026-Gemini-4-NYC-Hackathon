/* Wiring: DOM events <-> sim.js, render.js, gemini.js. No physics, no prompts. */
(function () {
  'use strict';
  const F = window.FireSim, G = window.Gemini, LAYOUTS = window.FireLayouts, FEED = window.Feed;
  const $ = id => document.getElementById(id);
  const SEED = 7;
  const KEY_STORE = 'fireTwinGeminiKey', INFORMED_STORE = 'fireTwinInformed';
  const STATUS_IDLE = 'Select an opening to inspect it, or choose Simulate fire to rehearse an evacuation.';
  const FIX_WAIT_S = 20;   // Find fix never waits longer than this for Gemini
  const DETAIL_S = 12;   // while its phone streams, a room is rebuilt from the camera this often
  const DETAIL_ROOMS = 3;   // rooms that Gemini reads at the same time (1 for each phone)
  const TWIN_LIVE = 'Freeze twin', TWIN_FROZEN = 'Resume live';
  const LIVE_GONE_S = 10;   // with "only what phones see" on: a room with no frame for this long is emptied
  const LIVE_STALE_S = 5, LIVE_STOPPED = 'stopped', LIVE_NONE = 'No phone is sending. Open the phone link, pick a room, start the camera.';
  const FEED_ON = 'phones: on', FEED_OFF = 'phones: off';
  const KEY_SAVED = '· saved in this tab. Changes here apply at once.', KEY_MISSING = '· none. The Gemini steps are off.';
  const STATS = [['out', 'Evacuated'], ['trapped', 'No route'], ['down', 'Down (model)'], ['seconds', 'Simulated seconds']];

  /* plan = the layout as loaded (floor plan only). layout = the same building after the phones changed it.
   * seen = the rooms a phone changed. Every run on `layout` is also run on `plan`: the gap is what the cameras add. */
  const state = { layout: null, plan: null, seen: new Set(), frozen: false, guessed: null, label: '', sim: null, running: false, lastIgn: [], fix: null, acc: 0, last: 0 };
  /* Three views of the same sim: 2D canvas, 3D voxels, live phone cameras. Same interface; each starts on first use. */
  const VIEWS = {
    '2d': { canvas: 'cv', make: window.FireRender },
    '3d': { canvas: 'cv3d', make: window.FireRender3D },
    'live': { canvas: 'liveView', make: { create: (node, wrap) => window.FireRenderLive.create(node, wrap,
      { cameras: () => [...live.values()], frameUrl: FEED.frameUrl, qrUrl: FEED.qrUrl, info: FEED.info,
        captures: FEED.captures, captureUrl: FEED.captureUrl,
        rebuild: (room, urls, poses) => rebuildRoom(room, urls, poses), busy: () => detail.busy.size > 0 }) } }
  };
  let view = null, presetPicker = null;
  let comparison = null;
  let placingFire = false, snapshotAt = null, lastUiSecond = -1;
  const simOpts = () => ({ seed: SEED, fireRate: +$('rate').value, crowdMode: $('crowdMode').value });
  const cfg = () => ({ key: $('key').value.trim(), model: $('model').value.trim(), deep: $('deep').value.trim() });
  const currentFire = () => (state.sim.ignitions.length ? state.sim.ignitions : state.lastIgn);

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function log(msg) { $('log').prepend(el('div', new Date().toLocaleTimeString() + '  ' + msg)); }

  function setStatus(text) { $('pa').textContent = text; }

  /* One row format for both tables (runs, fix candidates). */
  function addRow(tbody, label, res, note) {
    const tr = el('tr');
    [label, res.out + '/' + res.total, res.lost, (res.elapsedSeconds ?? res.seconds).toFixed(1) + ' s'].forEach((v, k) => tr.append(el('td', v, k === 2 && res.lost ? 'bad' : '')));
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
    queueTick = sim.substep;
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
    $('qWait').textContent = (row?.waitSeconds ?? 0).toFixed(1) + ' person-s';
    $('qLongest').textContent = (row?.maxWaitSeconds ?? 0).toFixed(1) + ' s';
    $('qSmoke').textContent = smokeValue(row?.smokeSeconds ?? 0) + ' smoke-s';
    $('queueMeans').textContent = row?.people
      ? 'Each affected person averaged ' + (row.waitSeconds / row.people).toFixed(1) + ' s of waiting and ' + smokeValue(row.smokeSeconds / row.people) + ' smoke-s.'
      : sim.crowdMode === 'continuous'
        ? 'Tracks people slowed by a crowd while approaching this opening, including their waiting time and modeled smoke exposure.'
        : 'A person counts once per opening when their next step is blocked by another person in its queue.';
  }

  /* New sim on the current layout. With ignitions: replay that fire. */
  function reset(ignitions) {
    if (comparison?.layout === state.layout) state.label = comparison.originalLabel;
    comparison = null;
    $('awarenessResults').hidden = true;
    placingFire = false;
    snapshotAt = ignitions?.length ? new Date() : null;
    state.sim = new F.Sim(state.layout, Object.assign(simOpts(), { ignitions }));
    state.running = !!(ignitions && ignitions.length);
    state.acc = 0;
    state.last = performance.now();
    lastUiSecond = -1;
    setStatus(state.running ? 'Replaying the same fire and crowd from the start.' : STATUS_IDLE);
    view.fit(state.sim);
    buildQueueMenu(state.sim);
    showLabel();
    present(state.last);
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
   * Presenter only (the key is here), before the fire only, each room at most every DETAIL_S.
   * Rooms are read side by side (1 for each phone), never the same room twice at once. */
  const detail = { busy: new Set(), at: new Map() };
  /* urls = saved frames a person chose (the frames of a video). Without urls: the newest live frame, on a timer. */
  async function rebuildRoom(roomName, urls, poses) {
    const asked = !!urls, no = why => { if (asked) log('Rebuild ' + roomName + ': ' + why); };
    if (!state.layout.rooms.some(r => r.name === roomName)) return no('this room is not in the layout on screen.');
    if (!FEED.presenter || !cfg().key) return no('Gemini reads frames on the presenter\'s laptop only.');
    if (detail.busy.has(roomName)) return no('Gemini is reading this room now. Try again in a few seconds.');
    if (!asked && (state.frozen || detail.busy.size >= DETAIL_ROOMS)) return;
    if (state.sim.alarmTick >= 0) return no('press Reset first. The layout does not change during a fire.');
    if (!asked && performance.now() - (detail.at.get(roomName) || -Infinity) < DETAIL_S * 1000) return;
    detail.busy.add(roomName); detail.at.set(roomName, performance.now());
    try {
      if (!urls) { urls = [FEED.frameUrl(roomName)]; poses = [(live.get(roomName) || {}).pose || null]; }
      if (asked) log('Gemini: reading ' + urls.length + ' frame' + (urls.length > 1 ? 's' : '') + ' of ' + roomName + '…');
      const files = await Promise.all(urls.map(async (u, k) => new File([await (await fetch(u)).blob()], roomName + '-' + k + '.jpg', { type: 'image/jpeg' })));
      const obs = await G.observeRoom(cfg(), files, state.layout, roomName, poses);
      // A dark or blocked frame reads as an empty room. On the timer, such a frame must not wipe a room that has furniture.
      const had = (state.layout.objects || []).some(o => { const r = state.layout.rooms.find(x => x.name === roomName); return o.x >= r.x && o.x < r.x + r.w && o.y >= r.y && o.y < r.y + r.h; });
      if (!asked && had && !(Array.isArray(obs.objects) && obs.objects.length)) return log('Gemini saw no furniture in the last frame of ' + roomName + '. Kept the earlier capture.');
      const res = F.applyObservation(state.layout, obs);
      if (!res || state.sim.alarmTick >= 0 || (!asked && state.frozen)) return;   // a fire started, or the twin was frozen, while Gemini was reading: keep the layout
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
    } catch (e) { log('Room read: ' + e.message); } finally { detail.busy.delete(roomName); }
  }

  /* Camera observations update the idle venue. Hazard observations warn; only an explicit rehearsal starts fire. */
  function onObservation(o) {
    const room = state.layout.rooms.find(r => r.name === o.cameraId);
    if (!room) return;
    const before = live.get(o.cameraId), said = x => x && [x.peopleCount, x.density].concat(x.events).join();
    live.set(o.cameraId, o);
    marks.set(o.cameraId, performance.now());
    if (said(before) !== said(o)) log('Phone in ' + o.cameraId + ': ' + o.peopleCount + ' people, ' + [o.density].concat(o.events).join(', ') + '.');
    showLive();
    if (state.frozen) return;   // frozen: the feed still shows, the twin keeps its last capture
    const sim = state.sim, idle = sim.alarmTick < 0;
    const views = o.poses && o.poses.length ? o.poses : o.pose ? [o.pose] : null;   // every phone that films this room now
    const moved = views && JSON.stringify(views) !== JSON.stringify(room.views || null) && o.peopleCount > 0;
    if (idle && o.stream && o.stream.ok && (o.peopleCount !== room.people || moved)) {
      room.people = o.peopleCount;
      if (views) room.views = views;   // the sim puts the counted people in these views
      $('json').value = JSON.stringify(state.layout);
      informed(room.name);
      reset();
    }
    const cause = o.events.includes('fire') ? 'Camera in ' + room.name + ' sees fire.'
      : o.events.includes('alarm') ? 'Microphone in ' + room.name + ' hears an alarm.'
      : o.events.includes('screaming') ? 'Microphone in ' + room.name + ' hears screaming.' : '';
    if (cause) log(cause + ' Review the camera observation.');
    if (idle) rebuildRoom(room.name);
  }

  /* After a reload: bring back the twin that was on screen (its preset, and the phones' changes to it).
   * True if it did. Only for a preset we still have. */
  function restoreInformed() {
    try {
      const kept = JSON.parse(sessionStorage.getItem(INFORMED_STORE) || 'null');
      const key = kept && Object.keys(LAYOUTS).find(k => LAYOUTS[k].name === kept.plan.name);
      if (!key) return false;
      $('preset').value = key;
      loadLayout(kept.layout, kept);
      if (kept.seen.length) log('Restored the twin with the phones\' changes (' + kept.seen.length + ' room' + (kept.seen.length > 1 ? 's' : '') + ').');
      return true;
    } catch (e) { sessionStorage.removeItem(INFORMED_STORE); return false; }
  }

  /* Freeze: cut the phones off from the twin. It keeps the last people and furniture, so fires and fixes
   * can be tested on a fixed copy of the real room. The Live view still shows the feed. Resume: phones update it again. */
  function setFrozen(on) {
    state.frozen = on;
    $('freeze').textContent = on ? TWIN_FROZEN : TWIN_LIVE;
    $('freeze').setAttribute('aria-pressed', String(on));
    log(on ? 'Twin frozen: it keeps the last capture. Phones no longer change it.' : 'Twin live: phones update it again.');
  }

  function setView(mode) {
    const v = VIEWS[mode];
    Object.values(VIEWS).forEach(o => { $(o.canvas).hidden = o !== v; });
    v.view = v.view || v.make.create($(v.canvas), $('stage'));
    view = v.view;
    document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
    $('hint3d').hidden = mode !== '3d';
    $('mapLegend').hidden = mode === 'live';
    $('homeView').disabled = mode === 'live';
    if (state.sim) view.fit(state.sim);
  }

  function showLabel() {
    $('layoutName').textContent = state.layout.name + ' · ' + state.label;
    $('mapTitle').textContent = state.layout.name.replace(/\s*\(.*$/, '');
    presetPicker?.sync();
  }

  /* Keep the camera-informed layout across a reload of this tab (the phones' work must not be lost on stage). */
  function remember() {
    sessionStorage.setItem(INFORMED_STORE, JSON.stringify({ layout: state.layout, plan: state.plan, seen: [...state.seen], guessed: state.guessed }));
  }

  /* A phone changed this room (head count or furniture). */
  function informed(roomName) {
    state.seen.add(roomName);
    if (state.guessed) delete state.guessed[roomName];   // this room is observed now: its guess is not needed
    remember();
  }

  /* "Only what phones have seen": rooms that no phone has reported are emptied (people = 0). Their guessed
   * head counts are kept in state.guessed (room name -> people) and come back when the switch goes off.
   * Off = the floor plan's guesses fill the rooms without a phone. */
  function setLiveOnly(on) {
    if (on && !state.guessed) {
      state.guessed = {};
      for (const r of state.layout.rooms) if (!state.seen.has(r.name)) { state.guessed[r.name] = r.people; r.people = 0; }
    } else if (!on && state.guessed) {
      for (const r of state.layout.rooms) if (r.name in state.guessed) r.people = state.guessed[r.name];
      state.guessed = null;
    }
    if (on) dropStopped(true);
    $('liveOnly').checked = !!state.guessed;
    state.layout.liveOnly = !!state.guessed;   // travels with the layout, so a copy of the page accepts an empty twin
    $('json').value = JSON.stringify(state.layout);
    remember(); syncFeed();
    if (state.sim.alarmTick < 0) reset();
    const n = state.layout.rooms.reduce((a, r) => a + r.people, 0);
    log(on ? 'Only what phones see now: ' + n + ' people. Rooms with no phone sending are empty.'
           : 'Rooms without a phone use the floor plan\'s guess again: ' + n + ' people.');
  }

  /* With "only what phones see" on: a room whose phone stopped sending is emptied too (its last count is
   * kept in state.guessed, and comes back when the switch goes off). A frozen twin keeps its last capture. */
  function dropStopped(quiet) {
    if (!state.guessed || state.frozen || !state.sim || state.sim.alarmTick >= 0) return;
    const now = Date.now() / 1000, gone = [];
    for (const r of state.layout.rooms) {
      const o = live.get(r.name), sending = o && o.stream && now - (o.stream.lastFrame || 0) <= LIVE_GONE_S;
      if (r.people && !(r.name in state.guessed) && !sending) { state.guessed[r.name] = r.people; r.people = 0; gone.push(r.name); }
    }
    if (!gone.length || quiet) return;
    $('json').value = JSON.stringify(state.layout);
    remember(); syncFeed(); reset();
    log('No phone is sending from ' + gone.join(', ') + ': emptied.');
  }

  /* restored = {plan, seen} from remember(): L is then a camera-informed layout, not a fresh plan. */
  function loadLayout(L, restored) {
    const errs = F.validateLayout(L);
    if (errs.length) throw new Error(errs.join('; '));
    const s = new F.Sim(L, simOpts()).stats();
    if (!s.total && !restored && !L.liveOnly) throw new Error('layout has no people');   // an emptied twin (only what phones have seen) is allowed
    if (s.trapped) log('Warning: ' + s.trapped + ' of ' + s.total + ' people have no route to an exit.');
    if (s.unplaced) log(s.unplaced + ' requested occupants could not be placed with body clearance. The run models ' + s.total + ' of ' + s.requestedPeople + ' people.');
    window.TwinAssistant.clear();
    state.layout = L; state.label = 'Baseline'; state.lastIgn = []; state.fix = null;
    state.plan = restored ? restored.plan : F.clone(L);
    state.seen = new Set(restored ? restored.seen : []);
    state.guessed = (restored && restored.guessed) || null;
    $('liveOnly').checked = !!state.guessed;
    remember();
    $('json').value = JSON.stringify(L);
    for (const id of ['familiarExit', 'secondExit']) {
      $(id).replaceChildren(...L.exits.map(o => {
        const option = el('option', o.id + (o.name ? ' · ' + o.name : '') + (o.locked ? ' (locked)' : ''));
        option.value = o.id;
        return option;
      }));
    }
    const open = L.exits.filter(o => !o.locked);
    $('familiarExit').value = open[0]?.id || L.exits[0].id;
    $('secondExit').value = open[1]?.id || L.exits[0].id;
    $('apply').disabled = true;
    showSeen(G.notesOf(L));
    live.clear(); showLive();
    syncFeed();
    reset();
    setStatus(STATUS_IDLE);
  }

  /* The run is over. If phones changed the twin, run the SAME fire on the plan-only twin too:
   * the 2 rows side by side show what the cameras and microphones add. */
  function onDone() {
    // With "only what phones have seen" on, the twin holds a part of the crowd: a row for the whole floor plan would not compare.
    const r = state.sim.stats(), compare = state.seen.size && state.label === 'Baseline' && !state.guessed;
    const summary = 'Run complete. ' + r.out + ' out, ' + r.down + ' down (model), ' + r.active + ' still inside.'
      + (r.unplaced ? ' ' + r.unplaced + ' requested people could not be placed.' : '');
    state.running = false;
    state.lastIgn = state.sim.ignitions.slice();
    if (!compare) {
      addRow($('runs'), state.label, r);
      return setStatus(summary);
    }
    const p = F.run(state.plan, state.lastIgn, simOpts()), n = state.seen.size;
    addRow($('runs'), 'Floor plan only', p);
    addRow($('runs'), 'With phones (' + n + ' room' + (n > 1 ? 's' : '') + ')', r, 'Same fire. Phones changed: ' + [...state.seen].join(', ') + '.');
    log('Same fire: the floor plan alone has ' + p.lost + ' not out of ' + p.total + '. With the phones: ' + r.lost + ' not out of ' + r.total + '. Not out includes modeled down and still inside at the end.');
    setStatus(summary + ' Floor plan only: ' + p.lost + ' not out.');
  }

  /* Candidates come from search (each locked opening) and from Gemini. The sim scores all of them. */
  async function findFix() {
    if (comparison) return log('Use Reset to leave the awareness comparison before finding layout fixes.');
    const ign = currentFire().slice();
    const run = state.sim, layout = state.layout, options = simOpts();
    if (!ign.length) return log('Start a fire first.');
    $('fix').disabled = true;
    const locked = F.openingsOf(state.layout).filter(o => o.locked);
    const cands = locked.map(o => ({ action: { action: 'unlock', id: o.id }, source: 'Search' }));
    if (locked.length > 1) cands.push({ action: { action: 'unlock_all' }, source: 'Search' });
    const base = F.run(layout, ign, options);
    if (cfg().key) {
      try {
        log('Gemini: proposing fixes…');
        const late = new Promise((ok, fail) => setTimeout(() => fail(new Error('Gemini took more than ' + FIX_WAIT_S + ' s. Showing the search results.')), FIX_WAIT_S * 1000));
        (await Promise.race([G.proposeFixes(cfg(), { layout: state.layout, ignitions: ign, baseline: base }), late]))
          .forEach(p => cands.push({ action: p, source: 'Gemini', reason: p.reason }));
      } catch (e) { log('Fix: ' + e.message); }
    }
    if (state.sim !== run) { $('fix').disabled = false; return; }
    const scored = new Map();
    for (const c of cands) {
      // Let the controls paint between full scenario runs. Do not publish stale results after a reset.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (state.sim !== run) { $('fix').disabled = false; return; }
      c.label = F.actionLabel(c.action);
      const prev = scored.get(c.label);
      if (prev) { prev.source += ' + ' + c.source; prev.reason = prev.reason || c.reason; continue; }
      c.layout = F.applyAction(layout, c.action);
      if (!c.layout) { log('Rejected (invalid): ' + c.label + ' from ' + c.source); continue; }
      c.res = F.run(c.layout, ign, options);
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
    log(best ? 'Best fix: ' + best.label + ' (not out ' + base.lost + ' → ' + best.res.lost + ').' : 'No candidate is better than the baseline.');
  }

  function applyFix() {
    if (comparison) return log('Use Reset to leave the comparison before applying a layout fix.');
    if (!state.fix) return;
    state.layout = state.fix.layout; state.label = state.fix.label;
    reset(state.fix.ign);
    setStatus('Fix applied: ' + state.label + '. Same fire, new run.');
  }

  function startComparison() {
    const ignitions = currentFire().slice();
    if (!ignitions.length) return log('Click the floor to start a fire before comparing.');
    const familiar = $('familiarExit').value, second = $('secondExit').value;
    const cueSeconds = +$('cueSeconds').value, reception = +$('cueReception').value / 100;
    if (familiar === second) return log('Choose two different exits.');
    if (state.layout.exits.some(o => [familiar, second].includes(o.id) && o.locked))
      return log('Unlock both selected exits before comparing.');
    if (!Number.isFinite(cueSeconds) || cueSeconds < 0 || cueSeconds > 120
      || !Number.isFinite(reception) || reception < 0 || reception > 1)
      return log('Use a cue time from 0 to 120 seconds and reception from 0 to 100%.');
    const options = Object.assign(simOpts(), { ignitions, horizonSeconds: 120 });
    comparison = {
      layout: state.layout, originalLabel: comparison?.originalLabel || state.label,
      baseline: new F.Sim(F.clone(state.layout), Object.assign({}, options,
        { awareness: { familiar, second, cueSeconds: Infinity, reception: 0 } })),
      guided: new F.Sim(F.clone(state.layout), Object.assign({}, options,
        { awareness: { familiar, second, cueSeconds, reception } }))
    };
    state.acc = 0;
    state.running = true;
    state.last = performance.now();
    snapshotAt = new Date();
    state.lastIgn = ignitions;
    $('awarenessResults').hidden = false;
    $('awarenessConfig').textContent = 'Seed ' + SEED + ' · ' + familiar + ' familiar · cue for ' + second
      + ' at ' + cueSeconds + ' s after alarm · ' + Math.round(reception * 100) + '% reception. '
      + 'Both runs use ' + options.crowdMode + ' crowd movement and end at 120 s after alarm or when everyone has exited or gone down. Placement, delays and fire settings are matched. Reception is a scenario assumption.';
    selectComparisonView();
  }

  function selectComparisonView() {
    if (!comparison) return;
    state.sim = comparison[$('awarenessView').value];
    state.label = $('awarenessView').value === 'guided' ? 'With announcement' : 'Familiar exit only';
    view.fit(state.sim);
    buildQueueMenu(state.sim);
    showLabel();
    updateComparison();
    present(performance.now());
  }

  function updateComparison() {
    const { baseline, guided } = comparison;
    const tickKey = baseline.substep + '/' + guided.substep + '/' + state.running;
    if (comparison.lastTickKey === tickKey) return;
    comparison.lastTickKey = tickKey;
    const measure = sim => {
      const s = sim.stats(), queues = sim.queueStats();
      return [s.out + '/' + s.total, s.active, s.down,
        sim.done && s.out === s.total && !s.unplaced ? (sim.lastOutSeconds ?? sim.lastOutTick * F.DT).toFixed(1) + ' s' : s.unplaced ? 'Placement incomplete' : sim.done ? 'Not reached' : 'Pending',
        queues.reduce((sum, q) => sum + q.waitSeconds, 0).toFixed(1) + ' person-s',
        smokeValue(queues.reduce((sum, q) => sum + q.smokeSeconds, 0)) + ' smoke-s',
        sim.awarenessEvents.length, sim.exitUse[sim.awareness.familiar] || 0, sim.exitUse[sim.awareness.second] || 0];
    };
    const a = measure(baseline), b = measure(guided);
    $('awarenessMetrics').replaceChildren(...['Out', 'Still inside', 'Down', 'All out at', 'Total queue wait',
      'Smoke while queued', 'Learned second exit', 'Used familiar exit', 'Used second exit'].map((name, i) => {
        const row = el('tr');
        [name, a[i], b[i]].forEach(value => row.append(el('td', value)));
        return row;
      }));
    const complete = baseline.done && guided.done;
    $('awarenessStatus').textContent = (complete ? 'Complete' : state.running ? 'Running' : 'Paused') + ' · '
      + Math.max(baseline.seconds, guided.seconds).toFixed(1) + ' s · '
      + (guided.cueDelivered ? 'Announcement delivered to ' + guided.awarenessEvents.length + ' people.'
        : 'Announcement pending.');
    $('awarenessEvents').replaceChildren(...guided.awarenessEvents.map(e =>
      el('div', 'Person ' + e.person + ' learned ' + e.exit + ' at ' + e.seconds + ' s.')));
    $('pa').textContent = guided.cueDelivered
      ? 'Cue for ' + guided.awareness.second + ' delivered. ' + guided.awarenessEvents.length + ' occupants learned the exit.'
      : 'Everyone starts knowing ' + guided.awareness.familiar + '. Cue for ' + guided.awareness.second
        + ' scheduled at ' + guided.awareness.cueSeconds + ' s after alarm.';
    if (complete) {
      state.running = false;
      $('pa').textContent = 'Matched replay complete. Compare evacuation, waiting and smoke exposure below.';
    }
  }

  function focusOpening(id) {
    const index = state.sim.openings.findIndex(o => o.ref.id === id);
    if (index < 0) return log('This opening is unavailable in the current layout.');
    $('queueOpening').value = String(index);
    updateQueues(state.sim);
    window.TwinAssistant.showPanel('insightsPanel');
    view.focusOpening?.(state.sim, index);
  }

  function onCanvasClick(ev) {
    const sim = state.sim, c = view.cellAt(sim, ev);
    if (!c) return;
    const tag = sim.tagOf[c.i];
    if (!placingFire && tag >= 0 && ($('interaction').value === 'inspect' || comparison || sim.alarmTick >= 0)) {
      return focusOpening(sim.openings[tag].ref.id);
    }
    if (comparison || sim.done) return log('Return to venue to edit the room or start a new scenario.');
    if (!placingFire && tag >= 0 && $('interaction').value === 'edit') {
      const ref = sim.openings[tag].ref;
      ref.locked = !ref.locked; sim.refreshOpening(tag);
      const same = F.openingsOf(state.plan).find(o => o.id === ref.id);
      if (same) same.locked = ref.locked;
      remember();
      state.label = 'Manual: ' + ref.id + (ref.locked ? ' locked' : ' unlocked'); showLabel();
    } else if (placingFire && sim.ignite(c.x, c.y)) {
      snapshotAt = new Date(); placingFire = false; state.running = true;
      state.last = performance.now();
      setStatus('Rehearsal running. Inspect an opening to see waiting time and smoke exposure.');
      present(state.last);
    } else if (!placingFire) {
      const room = state.layout.rooms[sim.roomOf[c.i]];
      if (room) $('pa').textContent = room.name + ' · ' + room.people + ' people in the room model.';
    }
  }

  function updateWorkspace(sim, t) {
    const rehearsal = sim.alarmTick >= 0 || !!comparison;
    $('worldMode').textContent = rehearsal ? 'SIMULATION REPLAY' : state.frozen ? 'FROZEN VENUE' : 'VENUE VIEW';
    $('sceneStatus').textContent = rehearsal ? 'Simulated event · ' + sim.seconds.toFixed(1) + ' s' : state.seen.size ? 'Camera-informed venue' : 'Preset venue';
    $('crowdModeLabel').textContent = sim.crowdMode === 'continuous' ? 'Continuous movement · modeled crowd density' : 'Tile movement · baseline crowd model';
    $('mapLegend').title = sim.crowdMode === 'continuous'
      ? 'Density colors: yellow ≥1.5, amber ≥2.5, coral ≥4 modeled people/m². Queues or body contact can also appear amber. Illustrative bands, not injury thresholds.'
      : 'Tile baseline: neighborhood occupancy and blocked queues.';
    $('runLabel').textContent = placingFire ? 'Choose a floor location to start' : rehearsal ? comparison ? 'Matched exit-awareness replay' : state.running ? 'Evacuation in progress' : sim.done ? 'Scenario complete' : 'Simulation paused' : 'Explore the venue';
    $('snapshotLabel').textContent = rehearsal && snapshotAt ? 'Snapshot captured ' + snapshotAt.toLocaleTimeString() : 'Inspect an opening or simulate a fire';
    $('placeFire').textContent = placingFire ? 'Cancel placement' : 'Simulate fire';
    $('placeFire').disabled = rehearsal;
    $('pause').disabled = !rehearsal || (comparison ? comparison.baseline.done && comparison.guided.done : sim.done);
    $('pause').textContent = state.running ? 'Pause' : 'Play';
    $('replay').disabled = !currentFire().length;
    $('speedLabel').textContent = (+$('speed').value * F.DT) + '×';
    $('population').textContent = sim.people.length + ' people';
    $('placementNote').textContent = (state.seen.size ? 'Camera counts · simulated placement' : 'Preset occupancy · simulated placement')
      + (sim.unplaced ? ' · ' + sim.unplaced + ' of ' + sim.requestedPeople + ' requested people could not fit' : '');
    if (Math.floor(t / 1000) === lastUiSecond) return;
    lastUiSecond = Math.floor(t / 1000);
    const blocked = sim.openings.filter(o => o.kind === 'exit' && o.ref.locked).length;
    const latest = Math.max(0, ...[...live.values()].map(o => o.stream?.lastFrame || 0));
    const age = latest ? Math.max(0, Math.floor(Date.now() / 1000 - latest)) : null;
    $('worldSummary').textContent = sim.people.length + ' modeled people across ' + state.layout.rooms.length + ' rooms. '
      + blocked + ' exits marked locked or blocked. '
      + (age === null ? 'Camera observations have yet to arrive.' : 'Latest camera frame ' + age + ' s ago.');
  }

  // Also paint after controls change: background tabs may not receive an animation frame promptly.
  function present(t) {
    const sim = state.sim;
    if (queueTick !== sim.substep) updateQueues(sim);
    view.draw(sim, t, { running: state.running, alpha: Math.min(1, state.acc / F.CROWD_DT), stepMs: 1000 / +$('speed').value, congestion: $('congestion').checked, cutaway: $('cutaway').checked, marks, tracked: trackedOpening, phones: [...live.values()].flatMap(o => (o.poses && o.poses.length ? o.poses : [o.pose])).filter(Boolean) });
    const s = sim.stats();
    STATS.forEach(([k]) => { $('stat-' + k).textContent = k === 'seconds' ? sim.seconds.toFixed(1) : s[k]; });
    updateWorkspace(sim, t);
  }

  function frame(t) {
    const dt = Math.max(0, (t - state.last) / 1000), sim = state.sim;
    state.last = t;
    if (state.running) {
      state.acc += dt * +$('speed').value * F.DT;
      const started = performance.now();
      // Preserve unfinished time when expensive crowds need another frame: no skipped physics steps.
      for (let n = 0; state.acc + 1e-9 >= F.CROWD_DT && n < 120; n++) {
        if (comparison) {
          comparison.baseline.advance(); comparison.guided.advance();
        } else if (!sim.done) sim.advance();
        state.acc = Math.max(0, state.acc - F.CROWD_DT);
        if (comparison ? comparison.baseline.done && comparison.guided.done : sim.done) break;
        if (performance.now() - started > 10) break;
      }
      if (comparison) updateComparison();
      else if (sim.done) onDone();
    }
    present(t);
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
    on('placeFire', 'click', () => {
      if (!$('liveView').hidden) setView('3d');
      placingFire = !placingFire;
      present(performance.now());
    });
    on('homeView', 'click', () => { view.home?.(state.sim); view.fit(state.sim); });
    window.addEventListener('twin:focus-opening', event => focusOpening(event.detail?.id));
    on('setup', 'click', () => $('setupDlg').showModal());
    on('crowdMode', 'change', () => {
      state.fix = null;
      $('apply').disabled = true;
      $('runs').replaceChildren(); $('fixes').replaceChildren();
      reset();
      setStatus('Crowd movement changed. Start a fresh rehearsal to compare this model.');
    });
    on('freeze', 'click', () => setFrozen(!state.frozen));
    on('liveOnly', 'change', () => setLiveOnly($('liveOnly').checked));
    setInterval(dropStopped, 2000);
    on('pause', 'click', () => {
      // Retain accrued substeps, but never include the time spent paused on resume.
      state.last = performance.now();
      state.running = !state.running && (comparison
        ? !(comparison.baseline.done && comparison.guided.done)
        : state.sim.alarmTick >= 0 && !state.sim.done);
      if (comparison) updateComparison();
      else if (!state.sim.done) setStatus(state.running
        ? 'Rehearsal resumed. Inspect an opening to see waiting time and smoke exposure.'
        : 'Rehearsal paused. Press Play to continue from this moment.');
      present(state.last);
    });
    on('speed', 'input', () => { $('speedLabel').textContent = (+$('speed').value * F.DT) + '×'; });
    on('compareAwareness', 'click', guarded('Comparison', startComparison));
    on('awarenessView', 'change', selectComparisonView);
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
    presetPicker = window.PresetPicker.create($('preset'));
    $('preset').value = 'malinGemini';
    setView('3d');
    setInterval(showLive, 1000);
    FEED.listen(onObservation, up => { if (up) syncFeed(); $('feedState').textContent = up ? FEED_ON : FEED_OFF; });
    // Read the remembered twin BEFORE the default layout loads: loading a layout overwrites what is remembered.
    if (!(FEED.presenter && restoreInformed())) loadLayout(F.clone(LAYOUTS[$('preset').value]));
    if (!FEED.presenter) {   // a copy opened from the feed server (a phone): follow the presenter's layout, link to the camera page
      $('pages').hidden = false; $('setup').hidden = $('presetPicker').hidden = $('freeze').hidden = true;
      FEED.layout().then(L => { if (L) loadLayout(L); }).catch(() => {});
    }
    requestAnimationFrame(frame);
  }

  init();
})();
