/* Wiring: DOM events <-> sim.js, render.js, gemini.js. No physics, no prompts. */
(function () {
  'use strict';
  const F = window.FireSim, G = window.Gemini, LAYOUTS = window.FireLayouts;
  const $ = id => document.getElementById(id);
  const SEED = 7;
  const STATS = [['out', 'Out'], ['trapped', 'No route'], ['down', 'Down'], ['seconds', 'Time (s)']];

  const state = { layout: null, label: '', sim: null, running: false, lastIgn: [], fix: null, annKey: '', annSeq: 0, acc: 0, last: 0 };
  /* Two views of the same sim: 2D canvas and 3D voxels. Same interface; the 3D one starts on first use. */
  const VIEWS = {
    '2d': { canvas: 'cv', make: window.FireRender, other: '3d' },
    '3d': { canvas: 'cv3d', make: window.FireRender3D, other: '2d' }
  };
  let view = null;
  const simOpts = () => ({ seed: SEED, fireRate: +$('rate').value });
  const cfg = () => ({ key: $('key').value.trim(), model: $('model').value.trim() });
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

  function setView(mode) {
    const v = VIEWS[mode];
    Object.values(VIEWS).forEach(o => { $(o.canvas).hidden = o !== v; });
    v.view = v.view || v.make.create($(v.canvas), $('stage'));
    view = v.view;
    $('dim').textContent = v.other.toUpperCase();
    $('dim').dataset.next = v.other;
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
    on('dim', 'click', guarded('3D view', () => setView($('dim').dataset.next)));
    on('setup', 'click', () => $('setupDlg').showModal());
    on('pause', 'click', () => { state.running = !state.running && state.sim.alarmTick >= 0 && !state.sim.done; });
    on('reset', 'click', () => reset());
    on('replay', 'click', () => reset(currentFire().slice()));
    on('fix', 'click', guarded('Fix', findFix));
    on('apply', 'click', applyFix);
    on('loadJson', 'click', guarded('Layout', () => loadLayout(JSON.parse($('json').value))));
    on('preset', 'change', () => loadLayout(F.clone(LAYOUTS[$('preset').value])));
    const fromGemini = (what, job) => guarded(what, async ev => {
      const files = [...ev.target.files]; ev.target.value = '';
      if (!files.length) return;
      $('setupDlg').close();
      const L = await job(files, msg => log('Gemini: ' + msg));
      loadLayout(L);
      log(what + ': layout loaded.');
    });
    on('media', 'change', fromGemini('New twin', (files, status) => G.layoutFromMedia(cfg(), files, LAYOUTS.demo, status)));
    on('walk', 'change', fromGemini('Video update', (files, status) => G.updateFromVideo(cfg(), files[0], state.layout, status)));
    window.addEventListener('resize', () => view.fit(state.sim));
    Object.keys(LAYOUTS).forEach(k => { const o = el('option', LAYOUTS[k].name); o.value = k; $('preset').append(o); });
    setView('2d');
    loadLayout(F.clone(LAYOUTS[$('preset').value]));
    requestAnimationFrame(frame);
  }

  init();
})();
