/* Wiring: DOM events <-> sim.js, render.js, gemini.js. No physics, no prompts. */
(function () {
  'use strict';
  const F = window.FireSim, G = window.Gemini, LAYOUTS = window.FireLayouts, FEED = window.Feed;
  const $ = id => document.getElementById(id);
  const SEED = 7;
  const KEY_STORE = 'fireTwinGeminiKey';
  const LIVE_STALE_S = 5, LIVE_STOPPED = 'stopped', LIVE_NONE = 'No phone is sending. Open the phone link, pick a room, start the camera.';
  const FEED_ON = 'phones: on', FEED_OFF = 'phones: off';
  const KEY_SAVED = '· saved in this tab. Changes here apply at once.', KEY_MISSING = '· none. The Gemini steps are off.';
  const STATS = [['out', 'Out'], ['trapped', 'No route'], ['down', 'Down'], ['seconds', 'Time (s)']];

  const state = { layout: null, label: '', sim: null, running: false, lastIgn: [], fix: null, annKey: '', annSeq: 0, acc: 0, last: 0 };
  /* Three views of the same sim: 2D canvas, 3D voxels, live phone cameras. Same interface; each starts on first use. */
  const VIEWS = {
    '2d': { canvas: 'cv', make: window.FireRender },
    '3d': { canvas: 'cv3d', make: window.FireRender3D },
    'live': { canvas: 'liveView', make: { create: (node, wrap) => window.FireRenderLive.create(node, wrap,
      { cameras: () => [...live.values()], frameUrl: FEED.frameUrl, qrUrl: FEED.qrUrl, info: FEED.info }) } }
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

  /* New sim on the current layout. With ignitions: replay that fire. */
  function reset(ignitions) {
    state.sim = new F.Sim(state.layout, Object.assign(simOpts(), { ignitions }));
    state.running = !!(ignitions && ignitions.length);
    state.annKey = ''; state.acc = 0;
    view.fit(state.sim);
    showLabel();
  }

  /* What Gemini saw or heard in the last floor plan or video. Empty list = hide. */
  function showSeen(notes) {
    $('seen').replaceChildren(...notes.map(n => { const tr = el('tr'); tr.append(el('td', n)); return tr; }));
    $('seenTable').hidden = !notes.length;
  }

  /* ---- Live feed: phones -> perception server -> Observations, one per room. ---- */
  const live = new Map();   // room name -> latest Observation

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

  /* One camera update. Before the fire: its head count goes into the twin. A camera that sees fire starts the fire. */
  function onObservation(o) {
    const room = state.layout.rooms.find(r => r.name === o.cameraId);
    if (!room) return;
    live.set(o.cameraId, o);
    showLive();
    const sim = state.sim, idle = sim.alarmTick < 0;
    if (idle && o.stream && o.stream.ok && o.peopleCount !== room.people) {
      room.people = o.peopleCount;
      $('json').value = JSON.stringify(state.layout);
      reset();
    }
    if (idle && $('autofire').checked && o.events.includes('fire')) {
      if (state.sim.ignite(Math.floor(room.x + room.w / 2), Math.floor(room.y + room.h / 2))) {
        state.running = true;
        log('Camera in ' + room.name + ' sees fire. Fire started there.');
      }
    }
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

  function loadLayout(L) {
    const errs = F.validateLayout(L);
    if (errs.length) throw new Error(errs.join('; '));
    const s = new F.Sim(L).stats();
    if (!s.total) throw new Error('layout has no people');
    if (s.trapped) log('Warning: ' + s.trapped + ' of ' + s.total + ' people have no route to an exit.');
    state.layout = L; state.label = 'Baseline'; state.lastIgn = []; state.fix = null;
    $('json').value = JSON.stringify(L);
    $('apply').disabled = true;
    showSeen(G.notesOf(L));
    live.clear(); showLive();
    syncFeed();
    reset();
    say('Click the floor to start a fire. Click a door or exit to lock or unlock it.');
  }

  function onDone() {
    const r = state.sim.stats();
    state.running = false;
    state.lastIgn = state.sim.ignitions.slice();
    addRow($('runs'), state.label, r);
    say('Run complete. ' + r.out + ' out, ' + r.lost + ' lost.');
  }

  /* PA announcement when the set of blocked exits changes (and at the first fire). */
  async function checkAnnounce() {
    const st = state.sim.status(), key = st.blocked.join() + '|' + st.open.join();
    if (key === state.annKey) return;
    state.annKey = key;
    const seq = ++state.annSeq;
    let text = G.fallbackAnnouncement(st);
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
        (await G.proposeFixes(cfg(), { layout: state.layout, ignitions: ign, baseline: base }))
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
    view.draw(sim, t);
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
    requestAnimationFrame(frame);
  }

  init();
})();
