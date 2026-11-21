/* Wiring: DOM events <-> sim.js, render.js, gemini.js. No physics, no prompts. */
(function () {
  'use strict';
  const F = window.FireSim, G = window.Gemini, LAYOUTS = window.FireLayouts;
  const $ = id => document.getElementById(id);
  const SEED = 7;
  const KEY_STORE = 'fireTwinGeminiKey';
  const KEY_SAVED = '· saved in this tab. Changes here apply at once.', KEY_MISSING = '· none. The Gemini steps are off.';
  const STATS = [['out', 'Out'], ['trapped', 'No route'], ['down', 'Down'], ['seconds', 'Time (s)']];

  const state = { layout: null, label: '', sim: null, running: false, lastIgn: [], fix: null, annKey: '', annSeq: 0, acc: 0, last: 0 };
  /* Two views of the same sim: 2D canvas and 3D voxels. Same interface; the 3D one starts on first use. */
  const VIEWS = {
    '2d': { canvas: 'cv', make: window.FireRender, other: '3d' },
    '3d': { canvas: 'cv3d', make: window.FireRender3D, other: '2d' }
  };
  let view = null;
  let comparison = null;
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
    comparison = null;
    $('awarenessResults').hidden = true;
    state.annSeq++;
    state.sim = new F.Sim(state.layout, Object.assign(simOpts(), { ignitions }));
    state.running = !!(ignitions && ignitions.length);
    state.annKey = ''; state.acc = 0;
    view.fit(state.sim);
    buildQueueMenu(state.sim);
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
    if (comparison) return log('Use Reset to leave the awareness comparison before finding layout fixes.');
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
    if (comparison) return log('Use Reset to leave the comparison before applying a layout fix.');
    if (!state.fix) return;
    state.layout = state.fix.layout; state.label = state.fix.label;
    reset(state.fix.ign);
    say('Fix applied: ' + state.label + '. Same fire, new run.');
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
      baseline: new F.Sim(F.clone(state.layout), Object.assign({}, options,
        { awareness: { familiar, second, cueSeconds: Infinity, reception: 0 } })),
      guided: new F.Sim(F.clone(state.layout), Object.assign({}, options,
        { awareness: { familiar, second, cueSeconds, reception } }))
    };
    state.annSeq++;
    state.acc = 0;
    state.running = true;
    state.lastIgn = ignitions;
    $('awarenessResults').hidden = false;
    $('awarenessConfig').textContent = 'Seed ' + SEED + ' · ' + familiar + ' familiar · cue for ' + second
      + ' at ' + cueSeconds + ' s after alarm · ' + Math.round(reception * 100) + '% reception. '
      + 'Both runs end at 120 s after alarm or when everyone has exited or gone down. Placement, delays and fire settings are matched. Reception is a scenario assumption.';
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
  }

  function updateComparison() {
    const { baseline, guided } = comparison;
    const tickKey = baseline.tick + '/' + guided.tick;
    if (comparison.lastTickKey === tickKey) return;
    comparison.lastTickKey = tickKey;
    const measure = sim => {
      const s = sim.stats(), queues = sim.queueStats();
      return [s.out + '/' + s.total, s.active, s.down,
        sim.done && s.out === s.total ? (sim.lastOutTick * F.DT) + ' s' : sim.done ? 'Not reached' : 'Pending',
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
    $('awarenessStatus').textContent = (complete ? 'Complete' : 'Running') + ' · '
      + Math.max(baseline.tick, guided.tick) * F.DT + ' s · '
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

  function onCanvasClick(ev) {
    if (comparison) return log('Use Reset to edit the room or start a different fire.');
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
    if (state.running && comparison) {
      state.acc += dt * +$('speed').value;
      for (let n = 0; state.acc >= 1 && n < 40; n++, state.acc--) {
        comparison.baseline.step();
        comparison.guided.step();
      }
      updateComparison();
    } else if (state.running && !sim.done) {
      state.acc += dt * +$('speed').value;
      for (let n = 0; state.acc >= 1 && n < 40 && !sim.done; n++, state.acc--) sim.step();
      checkAnnounce();
      if (sim.done) onDone();
    }
    if (queueTick !== sim.tick) updateQueues(sim);
    view.draw(sim, t, trackedOpening);
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
    on('queueOpening', 'change', () => updateQueues(state.sim));
    on('dim', 'click', guarded('3D view', () => setView($('dim').dataset.next)));
    on('setup', 'click', () => $('setupDlg').showModal());
    on('pause', 'click', () => {
      state.running = !state.running && (comparison
        ? !(comparison.baseline.done && comparison.guided.done)
        : state.sim.alarmTick >= 0 && !state.sim.done);
    });
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
    };
    $('key').value = sessionStorage.getItem(KEY_STORE) || '';
    on('key', 'input', keyChanged);
    keyChanged();
    setView('2d');
    loadLayout(F.clone(LAYOUTS[$('preset').value]));
    requestAnimationFrame(frame);
  }

  init();
})();
