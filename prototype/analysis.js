/* Analysis: run many scenarios on one layout, aggregate what goes wrong, test changes on the same scenarios.
 * No DOM, no network. Uses sim.js only. Every number the Advisor shows comes from here. */
(function (root) {
  'use strict';
  const F = root.FireSim;
  const KINDS = {
    fire: 'Fire',
    fall: 'Fire + a fall at a doorway',
    crush: 'Evacuation with no fire (false alarm, threat)',
    blocked: 'Evacuation with an exit blocked'
  };
  const MIX = { fire: 0.45, fall: 0.2, crush: 0.2, blocked: 0.15 };   // share of runs of each kind
  const BUSY_QUEUE = 20;   // a peak queue this long at an opening counts as a bottleneck in that run
  /* Let the page draw between runs. A MessageChannel, not setTimeout: background tabs slow timers to 1 per second. */
  const pause = typeof MessageChannel === 'undefined' ? () => Promise.resolve()
    : () => new Promise(ok => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); });
  let lastPause = 0;
  const maybePause = () => { const now = Date.now(); if (now - lastPause < 40) return null; lastPause = now; return pause(); };

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* n scenarios, the same list every time for the same layout, n and seed. */
  function scenarios(layout, n, seed) {
    const r = rng(seed || 1), probe = new F.Sim(F.clone(layout));
    const floorOf = ri => { const c = []; for (let i = 0; i < probe.N; i++) if (probe.roomOf[i] === ri && probe.type[i] === F.FLOOR) c.push(i); return c; };
    const rooms = layout.rooms.map((room, ri) => ({ room, cells: floorOf(ri) })).filter(x => x.cells.length);
    const area = rooms.reduce((s, x) => s + x.cells.length, 0);
    const pickRoom = () => { let k = r() * area; for (const x of rooms) if ((k -= x.cells.length) < 0) return x; return rooms[rooms.length - 1]; };
    const cellXY = i => ({ x: i % layout.width, y: (i / layout.width) | 0 });
    const doors = probe.openings.filter(o => !o.ref.locked);
    const openExits = layout.exits.filter(e => !e.locked);
    const kinds = Object.keys(MIX), list = [];
    for (let k = 0; k < n; k++) {
      let kind = 'fire', v = (k + r() * 0.999) / n;   // stratified: the mix holds even for small n
      for (const name of kinds) { if (v < MIX[name]) { kind = name; break; } v -= MIX[name]; }
      if (kind === 'blocked' && openExits.length < 2) kind = 'crush';
      const s = { id: k + 1, kind, seed: 1 + Math.floor(r() * 100000), ignitions: [], events: [] };
      if (kind === 'fire' || kind === 'fall') {
        const x = pickRoom();
        s.room = x.room.name;
        s.ignitions.push(Object.assign({ tick: 0 }, cellXY(x.cells[Math.floor(r() * x.cells.length)])));
      }
      if (kind === 'fall') {
        const d = doors[Math.floor(r() * doors.length)];
        s.fallAt = d.ref.id;
        s.events.push(Object.assign({ tick: 10 + Math.floor(r() * 40), type: 'fall' }, cellXY(d.cells[0])));
      }
      if (kind === 'crush' || kind === 'blocked') s.events.push({ tick: 0, type: 'alarm' });
      if (kind === 'blocked') {
        s.blocked = openExits[Math.floor(r() * openExits.length)].id;
        s.events.push({ tick: 0, type: 'block', id: s.blocked });
      }
      s.label = KINDS[kind] + (s.room ? ' · fire in ' + s.room : '') + (s.fallAt ? ' · fall at ' + s.fallAt : '') + (s.blocked ? ' · ' + s.blocked + ' blocked' : '');
      list.push(s);
    }
    return list;
  }

  /* One scenario, headless. opts = {fireRate}. Returns the result plus where people were lost and fell. */
  function runOne(layout, s, opts) {
    const sim = new F.Sim(F.clone(layout), { seed: s.seed, fireRate: opts.fireRate, crowd: true, ignitions: s.ignitions, events: s.events });
    while (!sim.done) sim.step();
    const st = sim.stats();
    return Object.assign(st, {
      scenario: s.id, kind: s.kind,
      queues: sim.queueStats().map(q => ({ id: q.id, kind: q.kind, peak: q.peak, waitSeconds: q.waitSeconds })),
      lostCells: sim.people.filter(p => p.state !== F.OUT).map(p => p.i),
      fallCells: sim.fallLog.map(f => f.i)
    });
  }

  /* All scenarios, a few per frame. onRun(result, scenario, k) after each. */
  async function runAll(layout, list, opts, onRun, cancelled) {
    const out = [];
    for (let k = 0; k < list.length; k++) {
      if (cancelled && cancelled()) break;
      const res = runOne(layout, list[k], opts);
      out.push(res);
      if (onRun) onRun(res, list[k], k);
      const p = maybePause();
      if (p) await p;
    }
    return out;
  }

  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const round1 = v => Math.round(v * 10) / 10;

  /* What the runs say. Small enough to give to Gemini as the facts. */
  function summarize(layout, list, results) {
    const byId = new Map(list.map(s => [s.id, s]));
    const group = (key) => {
      const g = {};
      for (const r of results) { const k = key(r); if (k == null) continue; (g[k] = g[k] || []).push(r); }
      return g;
    };
    const stat = rs => ({ runs: rs.length, meanLost: round1(mean(rs.map(r => r.lost))), maxLost: Math.max(...rs.map(r => r.lost)),
      runsWithLoss: rs.filter(r => r.lost > 0).length, meanSeconds: Math.round(mean(rs.map(r => r.seconds))),
      crushFalls: rs.reduce((s, r) => s + r.falls.crush, 0), crushLost: rs.reduce((s, r) => s + r.lostBy.crush, 0) });
    const kinds = Object.entries(group(r => r.kind)).map(([k, rs]) => Object.assign({ kind: k, label: KINDS[k] }, stat(rs)));
    const fireRooms = Object.entries(group(r => byId.get(r.scenario).room))
      .map(([room, rs]) => Object.assign({ room }, stat(rs))).sort((a, b) => b.meanLost - a.meanLost);
    const openings = {};
    for (const r of results) {
      for (const q of r.queues) {
        const o = openings[q.id] = openings[q.id] || { id: q.id, kind: q.kind, peaks: [], busyRuns: 0, crushFalls: 0 };
        o.peaks.push(q.peak); if (q.peak >= BUSY_QUEUE) o.busyRuns++;
      }
      for (const [id, n] of Object.entries(r.crushAt)) if (openings[id]) openings[id].crushFalls += n;
    }
    const named = id => { const o = F.openingsOf(layout).find(e => e.id === id); return o && o.name ? id + ' (' + o.name + ')' : id; };
    const bottlenecks = Object.values(openings).map(o => ({ id: o.id, name: named(o.id), kind: o.kind, width: (() => { const e = F.openingsOf(layout).find(x => x.id === o.id); return e ? Math.max(e.w, e.h) : 1; })(),
      meanPeak: round1(mean(o.peaks)), maxPeak: Math.max(...o.peaks), busyRuns: o.busyRuns, crushFalls: o.crushFalls }))
      .filter(o => o.busyRuns || o.crushFalls).sort((a, b) => b.crushFalls - a.crushFalls || b.busyRuns - a.busyRuns || b.meanPeak - a.meanPeak).slice(0, 6);
    const sum = f => results.reduce((s, r) => s + f(r), 0);
    const total = results[0] ? results[0].total : 0;
    const worst = results.slice().sort((a, b) => b.lost - a.lost).slice(0, 3).map(r => ({ scenario: r.scenario, label: byId.get(r.scenario).label, lost: r.lost, seconds: r.seconds }));
    return {
      layout: layout.name, occupants: total, runs: results.length,
      overall: stat(results),
      causes: { fire: sum(r => r.lostBy.fire), smoke: sum(r => r.lostBy.smoke), crush: sum(r => r.lostBy.crush),
        stillInside: sum(r => r.active + r.injured), crushFalls: sum(r => r.falls.crush), trips: sum(r => r.falls.trip), fallsAtDoorways: sum(r => r.falls.event) },
      kinds, fireRooms: fireRooms.slice(0, 6), bottlenecks, worst,
      lockedOpenings: F.openingsOf(layout).filter(o => o.locked).map(o => named(o.id)),
      rooms: layout.rooms.filter(r => r.people > 0).map(r => ({ name: r.name, people: r.people }))
    };
  }

  /* Changes worth testing without asking anyone: open each locked exit, widen the worst bottlenecks,
   * cap the room whose fires cost the most. Gemini's proposals are added to these. */
  function searchActions(layout, summary) {
    const acts = F.openingsOf(layout).filter(o => o.locked && layout.exits.includes(o)).map(o => ({ action: 'unlock', id: o.id, reason: 'Locked exit.' }));
    for (const b of summary.bottlenecks.slice(0, 2)) acts.push({ action: 'widen', id: b.id, reason: 'Busiest queue in the runs.' });
    const room = summary.fireRooms[0] && layout.rooms.find(r => r.name === summary.fireRooms[0].room);
    if (room && room.people >= 8) acts.push({ action: 'cap_room', room: room.name, people: Math.round(room.people * 0.7), reason: 'Fires here cost the most.' });
    return acts;
  }

  /* Each action on the SAME scenarios. Returns [{action, label, valid, meanLost, crushFalls, meanSeconds, delta...}]. */
  async function testActions(layout, list, baseline, actions, opts, onTest, cancelled) {
    const base = { meanLost: mean(baseline.map(r => r.lost)), crushFalls: baseline.reduce((s, r) => s + r.falls.crush, 0), meanSeconds: mean(baseline.map(r => r.seconds)) };
    const seen = new Set(), out = [];
    for (const a of actions) {
      if (cancelled && cancelled()) break;
      const label = F.actionLabel(a);
      if (seen.has(label)) continue;
      seen.add(label);
      const L = F.applyAction(layout, a);
      const row = { action: a, label, source: a.source || 'Search', reason: a.reason || '', valid: !!L };
      if (L) {
        const rs = await runAll(L, list, opts, null, cancelled);
        row.meanLost = round1(mean(rs.map(r => r.lost)));
        row.crushFalls = rs.reduce((s, r) => s + r.falls.crush, 0);
        row.meanSeconds = Math.round(mean(rs.map(r => r.seconds)));
        row.lostChange = round1(row.meanLost - base.meanLost);
        row.crushChange = row.crushFalls - base.crushFalls;
        row.worseRuns = rs.filter((r, k) => r.lost > baseline[k].lost).length;
        row.betterRuns = rs.filter((r, k) => r.lost < baseline[k].lost).length;
      }
      out.push(row);
      if (onTest) onTest(row);
    }
    return out.sort((a, b) => (a.valid ? a.meanLost : 1e9) - (b.valid ? b.meanLost : 1e9) || (a.valid ? a.crushFalls : 0) - (b.valid ? b.crushFalls : 0));
  }

  /* Where people were lost or fell, summed over all runs: one number per cell, for the risk map. */
  function heat(layout, results) {
    const lost = new Float32Array(layout.width * layout.height), falls = new Float32Array(lost.length);
    for (const r of results) { for (const i of r.lostCells) lost[i]++; for (const i of r.fallCells) falls[i]++; }
    return { lost, falls, runs: results.length };
  }

  /* One named scenario (for the agent): spec = {kind, room?, exit?, door?, seed?}. Fire starts at the floor cell nearest
   * the room's centre. Returns {scenario} or {error}. */
  function makeScenario(layout, spec) {
    const kind = KINDS[spec.kind] ? spec.kind : 'fire', probe = new F.Sim(F.clone(layout));
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const s = { id: 1, kind, seed: Math.max(1, Math.round(+spec.seed) || 7), ignitions: [], events: [] };
    const cellXY = i => ({ x: i % layout.width, y: (i / layout.width) | 0 });
    if (kind === 'fire' || kind === 'fall') {
      const ri = layout.rooms.findIndex(r => same(r.name, spec.room));
      if (ri < 0) return { error: 'unknown room "' + spec.room + '". Rooms: ' + layout.rooms.map(r => r.name).join(', ') };
      const r = layout.rooms[ri], cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < probe.N; i++) {
        if (probe.roomOf[i] !== ri || probe.type[i] !== F.FLOOR) continue;
        const d = (i % layout.width + 0.5 - cx) ** 2 + (((i / layout.width) | 0) + 0.5 - cy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return { error: 'room "' + r.name + '" has no floor' };
      s.room = r.name;
      s.ignitions.push(Object.assign({ tick: 0 }, cellXY(best)));
    }
    if (kind === 'fall') {
      const o = probe.openings.find(x => same(x.ref.id, spec.door || spec.exit)) || probe.openings.find(x => !x.ref.locked);
      s.fallAt = o.ref.id;
      s.events.push(Object.assign({ tick: 20, type: 'fall' }, cellXY(o.cells[0])));
    }
    if (kind === 'crush' || kind === 'blocked') s.events.push({ tick: 0, type: 'alarm' });
    if (kind === 'blocked') {
      const e = layout.exits.find(x => same(x.id, spec.exit));
      if (!e) return { error: 'unknown exit "' + spec.exit + '". Exits: ' + layout.exits.map(x => x.id).join(', ') };
      s.blocked = e.id;
      s.events.push({ tick: 0, type: 'block', id: e.id });
    }
    s.label = KINDS[kind] + (s.room ? ' · fire in ' + s.room : '') + (s.fallAt ? ' · fall at ' + s.fallAt : '') + (s.blocked ? ' · ' + s.blocked + ' blocked' : '');
    return { scenario: s };
  }

  /* Advice guide from the numbers alone, for when Gemini is not reachable. Same format as the server's guide. */
  function fallbackGuide(facts) {
    const s = facts.summary, b = s.bottlenecks[0], room = s.fireRooms[0];
    const good = facts.tests.filter(t => t.valid && t.lostChange < 0 && t.betterRuns > t.worseRuns);
    const lead = s.causes.crush > s.causes.fire ? 'crowd crush at doorways' : 'fire spread before people got out';
    const falls = s.causes.trips + s.causes.fallsAtDoorways;
    return {
      headline: 'Across ' + s.runs + ' runs, ' + s.overall.meanLost + ' of ' + s.occupants + ' people were lost on average; most losses came from ' + lead + '.',
      prevalent: [
        b && { hazard: 'Crowd crush', where: b.name, howOften: 'long queue in ' + b.busyRuns + ' of ' + s.runs + ' runs (up to ' + b.maxPeak + ' people)', impact: b.crushFalls + ' falls in the press' },
        room && { hazard: 'Fire', where: room.room, howOften: room.runs + ' runs started here', impact: room.meanLost + ' lost on average' },
        falls ? { hazard: 'Falls', where: 'routes and doorways', howOften: falls + ' falls in all runs', impact: 'a fallen person blocks the way until helped up' } : null
      ].filter(Boolean),
      during: [
        b && { when: 'Queue at ' + b.id + ' over 20 people', do: 'Send a steward to ' + b.id + ' to slow the flow and direct people to the next open exit.' },
        { when: 'Fire or smoke seen', do: 'Start the alarm, announce the open exits by name, keep people away from the fire room.' },
        { when: 'A person falls in a queue', do: 'Stop the flow behind them, help them up, then restart the flow.' }
      ].filter(Boolean),
      prevent: good.slice(0, 5).map(t => ({ action: t.label, priority: t.lostChange <= -3 ? 'high' : 'medium',
        evidence: 'mean lost ' + t.lostChange + ' per run, crush falls ' + t.crushChange + ' (' + t.betterRuns + ' runs better, ' + t.worseRuns + ' worse)' })),
      watch: b ? ['Queue length at ' + b.id + ' (over 20 people: act)'] : [],
      limits: 'Fire, smoke and crush are demo heuristics on a 1 m grid, not calibrated engineering models.'
    };
  }

  const api = { KINDS, scenarios, makeScenario, runOne, runAll, summarize, searchActions, testActions, heat, fallbackGuide };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
