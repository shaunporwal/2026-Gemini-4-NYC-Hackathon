/* The advisor: wires the Advisor tab and the assistant chat to analysis.js (runs) and the server's agent (feed.js).
 * No physics, no prompts, no API key: every Gemini call is made by server/agent.py.
 * Advisor tab: run many scenarios -> find what goes wrong -> Gemini (fast) proposes changes -> the sim tests every
 * change on the same scenarios -> Gemini (reasoning) writes the advice guide from the measured numbers.
 * Chat: each question goes to the server agent with a snapshot of the twin; it runs simulations itself and answers. */
(function () {
  'use strict';
  const F = window.FireSim, A = window.FireAnalysis, FEED = window.Feed;
  const $ = id => document.getElementById(id);
  const PROPOSE_WAIT_S = 45, GUIDE_WAIT_S = 150;
  const app = () => window.FireApp;
  let job = 0, map = null, lastGuide = null, running = false;

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  /* One line in "Agent thoughts". who = Agent (the loop's own steps), Sim (a measured result) or a Gemini model. */
  function think(who, text, kind) {
    const li = el('li', null, kind || 'agent');
    li.append(el('b', who));
    const m = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(String(text).trim());   // Gemini thought summaries start with **Title**
    if (m) { li.append(el('strong', m[1])); if (m[2]) li.append(el('span', m[2])); } else li.append(el('span', text));
    const box = $('advThoughts'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.append(li);
    if (atEnd) box.scrollTop = box.scrollHeight;
  }

  const late = (s, what) => new Promise((ok, fail) => setTimeout(() => fail(new Error(what + ' took more than ' + s + ' s')), s * 1000));

  function setOpen(on) {
    document.body.classList.toggle('advising', on);
    $('advisorTab').setAttribute('aria-pressed', String(on));
    if (on) drawMap();
  }

  function drawMap() {
    if (!document.body.classList.contains('advising') || !app()) return;
    const L = (lastGuide && lastGuide.layout) || app().layout();
    map = map || window.FireRender.create($('advMap'), $('advMapWrap'));
    const sim = new F.Sim(F.clone(L));
    map.fit(sim);
    map.draw(sim, 0, { heat: (lastGuide && lastGuide.heat) || { lost: new Float32Array(sim.N), falls: new Float32Array(sim.N) } });
  }

  function progress(done, total, text) {
    $('advProgress').max = total; $('advProgress').value = done;
    $('advStatus').textContent = text;
  }

  function scenarioRow(s, r) {
    const tr = el('tr');
    tr.title = 'Show this scenario in the twin';
    const lostBy = [r.lostBy.crush && r.lostBy.crush + ' crush', r.lostBy.fire && r.lostBy.fire + ' fire', r.lostBy.smoke && r.lostBy.smoke + ' smoke'].filter(Boolean).join(', ');
    [s.id, s.label, r.lost + (lostBy ? ' (' + lostBy + ')' : ''), r.falls.crush + r.falls.trip + r.falls.event, r.seconds + ' s']
      .forEach((v, k) => tr.append(el('td', v, k === 2 && r.lost ? 'bad' : '')));
    tr.addEventListener('click', () => { setOpen(false); app().replay(s); });
    $('advScenarios').append(tr);
  }

  function testRows(tests, baseLost) {
    const rows = [el('tr')];
    ['No change', 'Baseline', baseLost, '', ''].forEach(v => rows[0].append(el('td', v)));
    for (const t of tests) {
      const tr = el('tr');
      [t.label, t.source, t.valid ? t.meanLost + ' (' + (t.lostChange > 0 ? '+' : '') + t.lostChange + ')' : 'not valid here',
        t.valid ? (t.crushChange > 0 ? '+' : '') + t.crushChange : '', t.valid ? t.betterRuns + ' / ' + t.worseRuns : '']
        .forEach((v, k) => tr.append(el('td', v, k === 2 && t.valid ? (t.lostChange < 0 ? 'good' : t.lostChange > 0 ? 'bad' : '') : '')));
      rows.push(tr);
      if (t.reason) { const td = el('td', t.reason, 'note'); td.colSpan = 5; const r = el('tr'); r.append(td); rows.push(r); }
    }
    $('advTests').replaceChildren(...rows);
  }

  /* The guide on screen. Every list is optional: a model may leave one out. */
  function showGuide(g, by) {
    const box = $('advGuide'), list = v => (Array.isArray(v) ? v : []).filter(Boolean).slice(0, 6);
    box.replaceChildren(el('p', String(g.headline || ''), 'headline'));
    const prevalent = list(g.prevalent);
    if (prevalent.length) {
      box.append(el('h4', 'Most prevalent hazards'));
      const t = el('table'), head = el('tr');
      ['Hazard', 'Where', 'How often', 'Impact'].forEach(h => head.append(el('th', h)));
      t.append(head);
      prevalent.forEach(p => { const tr = el('tr'); [p.hazard, p.where, p.howOften, p.impact].forEach(v => tr.append(el('td', v == null ? '' : String(v)))); t.append(tr); });
      box.append(t);
    }
    const during = list(g.during);
    if (during.length) {
      box.append(el('h4', 'When it happens'));
      const ol = el('ol');
      during.forEach(d => { const li = el('li'); li.append(el('b', String(d.when || '')), el('span', ' ' + String(d.do || ''))); ol.append(li); });
      box.append(ol);
    }
    const prevent = list(g.prevent);
    if (prevent.length) {
      box.append(el('h4', 'Prevent it'));
      const ol = el('ol');
      prevent.forEach(p => {
        const li = el('li');
        li.append(el('span', String(p.priority || 'medium'), 'prio ' + String(p.priority || 'medium')), el('b', ' ' + String(p.action || '')));
        if (p.evidence) li.append(el('div', String(p.evidence), 'evidence'));
        ol.append(li);
      });
      box.append(ol);
    }
    const watch = list(g.watch);
    if (watch.length) {
      box.append(el('h4', 'Watch for'));
      const ul = el('ul');
      watch.forEach(w => ul.append(el('li', String(w))));
      box.append(ul);
    }
    if (g.limits) box.append(el('p', String(g.limits), 'limits'));
    box.append(el('p', by, 'by'));
    $('advCopy').disabled = false;
  }

  /* The guide as Markdown, for the clipboard. */
  function guideText(g) {
    const list = v => (Array.isArray(v) ? v : []).filter(Boolean);
    return ['# Safety advice: ' + lastGuide.layout.name, '', String(g.headline || ''), '',
      '## Most prevalent hazards', ...list(g.prevalent).map(p => '- **' + p.hazard + '** (' + p.where + '): ' + p.howOften + '; ' + p.impact), '',
      '## When it happens', ...list(g.during).map((d, k) => (k + 1) + '. **' + d.when + '**: ' + d.do), '',
      '## Prevent it', ...list(g.prevent).map((p, k) => (k + 1) + '. [' + p.priority + '] **' + p.action + '**: ' + (p.evidence || '')), '',
      '## Watch for', ...list(g.watch).map(w => '- ' + w), '', '_' + String(g.limits || '') + '_'].join('\n');
  }

  async function run() {
    if (running) { job++; running = false; $('advRun').textContent = 'Run analysis'; return progress(0, 1, 'Stopped.'); }
    const my = ++job, cancelled = () => my !== job;
    const L = F.clone(app().layout()), opts = { fireRate: app().fireRate() };
    const n = +$('advRuns').value, list = A.scenarios(L, n, 1);
    running = true; $('advRun').textContent = 'Stop';
    $('advThoughts').textContent = ''; $('advScenarios').textContent = ''; $('advTests').textContent = '';
    $('advGuide').replaceChildren(el('p', 'Working… the guide appears when the runs and the tests are done.', 'by'));
    $('advCopy').disabled = true;
    lastGuide = { layout: L, heat: null };
    drawMap();
    try {
      const count = k => list.filter(s => s.kind === k).length;
      think('Agent', 'Plan: ' + n + ' scenarios on ' + L.name + ' (' + L.rooms.reduce((s, r) => s + r.people, 0) + ' people): ' +
        Object.keys(A.KINDS).map(k => count(k) + ' × ' + A.KINDS[k].toLowerCase()).join(', ') + '. Crowd crush and falls are on in every run.');
      const expected = n * 7;
      const base = await A.runAll(L, list, opts, (r, s, k) => {
        scenarioRow(s, r);
        progress(k + 1, expected, 'Scenario ' + (k + 1) + ' of ' + n);
        think('Sim', s.label + ': ' + r.lost + ' lost' + (r.lostBy.crush ? ' (' + r.lostBy.crush + ' in a crush)' : '') + ', ' +
          (r.falls.crush + r.falls.trip + r.falls.event) + ' falls, ' + r.seconds + ' s.', 'sim');
      }, cancelled);
      if (cancelled()) return;
      const summary = A.summarize(L, list, base);
      lastGuide.heat = A.heat(L, base);
      drawMap();
      const b = summary.bottlenecks[0], room = summary.fireRooms[0], c = summary.causes;
      think('Agent', 'Findings: ' + summary.overall.meanLost + ' lost per run on average (worst ' + summary.overall.maxLost + '). Causes over all runs: ' +
        c.fire + ' fire, ' + c.smoke + ' smoke, ' + c.crush + ' crush, ' + c.stillInside + ' still inside at the end.' +
        (b ? ' Busiest opening: ' + b.name + ' (' + b.width + ' m wide, long queue in ' + b.busyRuns + ' of ' + n + ' runs, ' + b.crushFalls + ' crush falls).' : '') +
        (room ? ' Costliest fire start: ' + room.room + ' (' + room.meanLost + ' lost on average).' : ''));

      const actions = A.searchActions(L, summary).map(a => Object.assign({ source: 'Search' }, a));
      think('Agent', 'Changes from search: ' + (actions.map(a => F.actionLabel(a)).join(', ') || 'none') + '.');
      think('Agent', 'Asking the server agent (Gemini 4 Hydrogen) which changes to test.');
      try {
        const ps = await Promise.race([FEED.advisorPropose({ layout: L, summary }, ev => think(ev.model || 'Gemini', ev.text, 'gemini')), late(PROPOSE_WAIT_S, 'Proposals')]);
        if (cancelled()) return;
        ps.forEach(p => actions.push(Object.assign({}, p, { source: 'Gemini' })));
        think('Agent', 'Gemini proposed: ' + (ps.map(p => F.actionLabel(p)).join(', ') || 'nothing') + '.');
      } catch (e) { think('Agent', 'Proposals unavailable (' + e.message + '). Testing the search changes only.'); }

      think('Agent', 'Testing ' + actions.length + ' changes, each on the same ' + n + ' scenarios.');
      let tested = 0;
      const tests = await A.testActions(L, list, base, actions, opts, t => {
        tested++;
        progress(n + tested * n, n + actions.length * n, 'Tested ' + tested + ' of ' + actions.length + ' changes');
        think('Sim', t.valid
          ? t.label + ': ' + t.meanLost + ' lost per run (' + (t.lostChange > 0 ? '+' : '') + t.lostChange + '), crush falls ' + (t.crushChange > 0 ? '+' : '') + t.crushChange + '; ' + t.betterRuns + ' runs better, ' + t.worseRuns + ' worse.'
          : t.label + ': not valid on this layout, skipped.', 'sim');
      }, cancelled);
      if (cancelled()) return;
      testRows(tests, summary.overall.meanLost);

      const facts = { summary, settings: { scenarios: n, fireSpread: opts.fireRate,
          crowdModel: 'crush when more than 16 people queue per metre of door width; random trips; a fallen person blocks the cell and gets up after 25 s' },
        tests: tests.map(t => ({ change: t.label, source: t.source, reason: t.reason, valid: t.valid, meanLost: t.meanLost, lostChange: t.lostChange,
          crushFalls: t.crushFalls, crushChange: t.crushChange, betterRuns: t.betterRuns, worseRuns: t.worseRuns, meanSeconds: t.meanSeconds })) };
      let guide = null, by = '';
      progress(1, 1, 'Writing the guide…');
      think('Agent', 'Asking the server agent (Gemini 4 Neon) to write the advice guide from these numbers.');
      try {
        guide = await Promise.race([FEED.advisorGuide({ facts }, ev => think(ev.model || 'Gemini', ev.text, 'gemini')), late(GUIDE_WAIT_S, 'The guide')]);
        by = 'Written by Gemini 4 Neon on the server from the measured runs. Changes were proposed by search and Gemini 4 Hydrogen, and tested by the simulator.';
      } catch (e) { think('Agent', 'Guide unavailable (' + e.message + '). Showing the template guide.'); by = 'Template from the numbers (' + e.message + ').'; }
      if (cancelled()) return;
      guide = guide || A.fallbackGuide({ summary, tests });
      lastGuide.guide = guide;
      showGuide(guide, by);
      progress(1, 1, 'Done: ' + n + ' scenarios, ' + tests.length + ' changes tested.');
      think('Agent', 'Done. Click a scenario to watch it in the twin.');
    } catch (e) {
      think('Agent', 'Error: ' + e.message);
      progress(0, 1, 'Error: ' + e.message);
    } finally {
      if (my === job) { running = false; $('advRun').textContent = 'Run analysis'; }
    }
  }

  /* ---- Chat: the assistant panel (assistant.js) gets its answers from the server agent. ---- */
  const history = [];   // [{role, text}], sent back so follow-up questions have context
  const status = text => { $('agentConnection').textContent = text; };
  const agentService = {
    async ask(question) {
      const layout = F.clone(app().layout());
      app().log('Advisor: "' + question.slice(0, 80) + '"');
      const reply = await FEED.agentAsk({ question, history: history.slice(-6), layout, fireRate: app().fireRate() }, ev => {
        if (ev.type === 'step') { status(ev.text); app().log('Advisor: ' + ev.text); }
        else if (ev.type === 'thought') status('Thinking: ' + String(ev.text).replace(/\*\*/g, '').split('\n')[0].slice(0, 80));
      });
      history.push({ role: 'user', text: question }, { role: 'assistant', text: reply.text });
      if (reply.replay) { app().replay(reply.replay); app().log('Advisor replays: ' + reply.replay.label); }
      return reply;
    }
  };
  /* A camera warning (person down, crowd surge) in the assistant panel, with a "What if?" button. The button asks the
   * agent to simulate that risk on the twin as it is now; nothing runs until the organizer clicks (DECISIONS C9). */
  const ALERT = {
    person_down: { title: 'Person down', ask: (room, doors) => 'A camera in ' + room + ' sees a person on the floor. If an evacuation started now and they ' +
      'fell at ' + (doors[0] || 'the nearest doorway') + ', what would happen? Run it as a fall without fire' + (doors[0] ? ' at ' + doors[0] : '') +
      ' on the current twin, compare with no fall, and tell me what staff should do.' },
    crowd_surge: { title: 'Crowd surge', ask: room => 'A camera in ' + room + ' sees the crowd pushing or surging. If everyone evacuated now, ' +
      'where would a crush happen and how bad would it be? Run the evacuation on the current twin, then test one change that would reduce it.' }
  };
  function doorsOf(roomName) {
    const L = app().layout(), r = L.rooms.find(x => x.name === roomName);
    if (!r) return [];
    return F.openingsOf(L).filter(o => !o.locked && o.x >= r.x && o.y >= r.y && o.x < r.x + r.w && o.y < r.y + r.h).map(o => o.id);
  }
  function crowdAlert(room, type, p) {
    const a = ALERT[type];
    if (!a) return;
    const doors = doorsOf(room), node = el('div', null, 'agent-message assistant crowd-alert');
    node.append(el('strong', a.title + ' · ' + room), el('span', 'The camera reports this' + (p != null ? ' with probability ' + p : '') +
      '. Nothing is simulated until you ask.' + (doors.length ? ' Doors of this room: ' + doors.join(', ') + '.' : '')));
    const what = el('button', 'What if? ↗', 'text-button');
    what.type = 'button';
    what.addEventListener('click', () => {
      const q = $('agentQuestion');
      if (q.disabled) return app().log('The agent is busy or not connected. Try again in a moment.');
      q.value = a.ask(room, doors);
      $('agentForm').requestSubmit();
    });
    const wrap = el('div'); wrap.append(what); node.append(wrap);
    $('agentMessages').append(node);
    if (window.TwinAssistant) window.TwinAssistant.showPanel('assistantPanel');
    node.scrollIntoView({ block: 'nearest' });
  }
  window.FireAdvisor = { crowdAlert };

  /* Connect when this page can reach the agent: the organizer's laptop (port 8765) with the server running. */
  if (FEED.presenter && window.TwinAssistant) {
    const tryConnect = () => FEED.info().then(info => {
      clearInterval(retry);
      window.TwinAssistant.connect(agentService);
      if (!info.ready) status('Connected · the server has no API key yet (add it in Settings)');
    }).catch(() => {});
    const retry = setInterval(tryConnect, 5000);
    tryConnect();
  }

  $('advisorTab').addEventListener('click', () => setOpen(!document.body.classList.contains('advising')));
  document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setOpen(false)));
  $('advRun').addEventListener('click', run);
  $('advCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(guideText(lastGuide.guide)); $('advStatus').textContent = 'Guide copied as Markdown.'; }
    catch (e) { $('advStatus').textContent = 'Copy failed: ' + e.message; }
  });
  window.addEventListener('resize', drawMap);
})();
