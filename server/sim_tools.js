/* The agent's simulation tools, run by agent.py: node sim_tools.js < {op, layout, args, fireRate} > result JSON.
 * Loads the prototype's engine (prototype/sim.js, analysis.js), so the numbers are the ones the twin shows.
 * Every call runs on the layout snapshot it is given; nothing is kept between calls. */
'use strict';
const path = require('path');
global.window = globalThis;
const PROTO = path.join(__dirname, '..', 'prototype');
const F = require(path.join(PROTO, 'sim.js'));
const A = require(path.join(PROTO, 'analysis.js'));

const SWEEP_N = 24, SWEEP_SEED = 1;
const round1 = v => Math.round(v * 10) / 10;

function world(L) {
  const s = new F.Sim(F.clone(L));
  return {
    name: L.name, people: s.people.length, noRoute: s.counts().trapped,
    rooms: L.rooms.filter(r => r.people > 0).map(r => ({ name: r.name, people: r.people })),
    emptyRooms: L.rooms.filter(r => !r.people).map(r => r.name),
    exits: L.exits.map(e => ({ id: e.id, name: e.name || '', widthM: Math.max(e.w, e.h), locked: !!e.locked })),
    doors: L.doors.map(d => ({ id: d.id, widthM: Math.max(d.w, d.h), locked: !!d.locked }))
  };
}

/* One result, small enough for the model. */
function brief(r) {
  return { lost: r.lost, of: r.total, out: r.out, lostBy: r.lostBy, stillInside: r.active + r.injured, falls: r.falls,
    crushAt: r.crushAt, seconds: r.seconds, exitUse: r.exitUse,
    busiestOpenings: r.queues.slice().sort((a, b) => b.peak - a.peak).slice(0, 3).map(q => ({ id: q.id, peakQueue: q.peak })) };
}

async function main(req) {
  const L = req.layout, opts = { fireRate: Number.isFinite(+req.fireRate) ? +req.fireRate : 0.08 }, a = req.args || {};
  const errs = F.validateLayout(L);
  if (errs.length) return { error: 'layout: ' + errs.join('; ') };
  if (req.op === 'world') return world(L);
  if (req.op === 'scenario') {
    const made = A.makeScenario(L, a);
    if (made.error) return made;
    return Object.assign({ scenario: made.scenario }, brief(A.runOne(L, made.scenario, opts)));
  }
  const n = Math.max(6, Math.min(48, Math.round(+a.n) || SWEEP_N));
  const list = A.scenarios(L, n, SWEEP_SEED), base = await A.runAll(L, list, opts);
  const summary = A.summarize(L, list, base);
  if (req.op === 'sweep') {
    const byId = new Map(list.map(s => [s.id, s]));
    summary.worst = summary.worst.map(w => Object.assign({}, w, { scenario: byId.get(w.scenario) }));
    return summary;
  }
  if (req.op === 'test') {
    const actions = (Array.isArray(a.actions) ? a.actions : [a.action]).filter(x => x && typeof x === 'object').slice(0, 6);
    if (!actions.length) return { error: 'no action to test' };
    const tests = await A.testActions(L, list, base, actions, opts);
    return { scenarios: n, baselineMeanLost: summary.overall.meanLost, baselineCrushFalls: summary.overall.crushFalls,
      results: tests.map(t => ({ change: t.label, valid: t.valid, meanLost: t.meanLost, lostChange: t.lostChange,
        crushFalls: t.crushFalls, crushChange: t.crushChange, betterRuns: t.betterRuns, worseRuns: t.worseRuns, meanSeconds: t.meanSeconds })) };
  }
  if (req.op === 'search') return { actions: A.searchActions(L, req.summary || summary) };
  return { error: 'unknown op ' + req.op };
}

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let out;
  try { out = await main(JSON.parse(input)); } catch (e) { out = { error: String(e && e.message || e) }; }
  process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? round1(v) : v)));
  process.exit(0);   // analysis.js yields with a MessageChannel, which would keep Node alive
});
