/* All LLM work is here: prompts + the Gemini REST calls. No sim logic, no DOM.
 * The LLM reads (floor plan, photo or video -> layout), speaks (PA text) and proposes (fixes).
 * It never decides: sim.js scores every proposal. */
(function () {
  'use strict';
  const API = 'https://generativelanguage.googleapis.com/';
  const ENDPOINT = API + 'v1beta/models/';
  const INLINE_MAX = 15 * 1048576;   // bytes; larger files use the Files API
  const POLL_MS = 2000, POLL_MAX = 90;
  const NOTES_MAX = 6, NOTE_LEN = 160;
  const PHOTO_MAX = 1024;            // px, long side of a room photo sent to the fast model
  const FAST = { thinking: 'low' }, DEEP = { deep: true };

  /* cfg = {key, model, deep}. Two Gemini 4 models, one job each:
   *   cfg.model (Hydrogen) = fast work while people wait: room photos, PA text, fix proposals. Low thinking level.
   *   cfg.deep (Neon or Carbon) = slow reasoning, done before the demo: floor plan -> layout. Default thinking level.
   *   (Fix proposals ran on Neon first: no answer after 60 s. The sim scores every proposal, so a fast model is enough.)
   * parts = Gemini "parts" array. opts = {deep, thinking}. Returns the reply text. */
  async function call(cfg, parts, wantJson, opts) {
    if (!cfg.key) throw new Error('no API key');
    opts = opts || {};
    const config = wantJson ? { responseMimeType: 'application/json' } : {};
    if (opts.thinking) config.thinkingConfig = { thinkingLevel: opts.thinking };
    const res = await fetch(ENDPOINT + encodeURIComponent((opts.deep && cfg.deep) || cfg.model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: config
      })
    });
    if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const data = await res.json();
    const out = ((data.candidates || [])[0] || {}).content;
    const text = ((out && out.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
    if (!text) throw new Error('Gemini: empty reply');
    return text;
  }

  function parseJson(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Gemini: no JSON in reply');
    return JSON.parse(text.slice(a, b + 1));
  }

  const toBase64 = file => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => fail(new Error('cannot read file'));
    r.readAsDataURL(file);
  });

  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const isVideo = file => /^video\//.test(file.type);

  /* Files API: resumable upload, then wait until Gemini has processed the file. Returns a "part". */
  async function upload(cfg, file, onStatus) {
    onStatus('uploading ' + file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)…');
    const start = await fetch(API + 'upload/v1beta/files', {
      method: 'POST',
      headers: {
        'x-goog-api-key': cfg.key, 'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size), 'X-Goog-Upload-Header-Content-Type': file.type
      },
      body: JSON.stringify({ file: { display_name: file.name } })
    });
    const url = start.ok && start.headers.get('x-goog-upload-url');
    if (!url) throw new Error('Gemini upload ' + start.status + ': no upload URL');
    const sent = await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: file });
    if (!sent.ok) throw new Error('Gemini upload ' + sent.status + ': ' + (await sent.text()).slice(0, 300));
    let f = (await sent.json()).file;
    for (let n = 0; f.state === 'PROCESSING' && n < POLL_MAX; n++) {
      onStatus('processing ' + file.name + '…');
      await sleep(POLL_MS);
      const res = await fetch(API + 'v1beta/' + f.name, { headers: { 'x-goog-api-key': cfg.key } });
      if (!res.ok) throw new Error('Gemini file ' + res.status);
      f = await res.json();
    }
    if (f.state !== 'ACTIVE') throw new Error('Gemini: file is ' + f.state);
    return { file_data: { mime_type: f.mimeType || file.type, file_uri: f.uri } };
  }

  /* A photo scaled down to PHOTO_MAX px on its long side. Smaller upload, faster reply. */
  async function shrink(file) {
    if (!/^image\//.test(file.type)) return file;
    const img = await createImageBitmap(file), k = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
    const canvas = new OffscreenCanvas(Math.round(img.width * k), Math.round(img.height * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return new File([await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })], file.name, { type: 'image/jpeg' });
  }

  /* Video and large files go through the Files API. Small images and PDFs go inline. */
  async function mediaPart(cfg, file, onStatus) {
    if (isVideo(file) || file.size > INLINE_MAX) return upload(cfg, file, onStatus);
    return { inline_data: { mime_type: file.type || 'image/jpeg', data: await toBase64(file) } };
  }

  const SCHEMA_RULES = [
    'Grid: 1 cell = about 1 m. Origin top-left, x to the right, y down. Cells not covered by a room are outside the building.',
    'rooms: axis-aligned rectangles {name,x,y,w,h,people}. Each rectangle INCLUDES its walls (1 cell thick).',
    'Adjacent rooms share a wall: their rectangles overlap by exactly 1 cell. Corridors and lobbies are rooms. Approximate irregular shapes with rectangles. Merge small rooms.',
    'doors: {id,x,y,w,h,locked} on a wall shared by 2 rooms. Not on a corner.',
    'exits: {id,name,x,y,w,h,locked} on a wall between a room and the outside. Not on a corner.',
    'Each room needs a door or an exit.',
    'Optional, for the 3D view: each room can have "color": "#rrggbb" (its floor color). The layout can have "wallColor": "#rrggbb".',
    'Optional objects: maximum 80 items {type,x,y,w,h,color}. type = table, desk, chair, sofa, counter, bar, stage, shelf, plant or screen. Large furniture inside a room, not on a wall cell. color = "#rrggbb".',
    'notes: maximum 6 short strings. Each note says one thing you saw or heard in the input and where (with the video time, if there is one).'
  ].join('\n');

  const VIDEO_RULES = [
    'A video is a walkthrough of the venue. Find the rooms and their connections from the path of the camera.',
    'Estimate sizes from people, doors (about 1 m wide) and furniture.',
    'Set locked=true for a door or exit that is blocked, chained or closed off in the video.',
    'Make the result look like the video: give the floor, wall and furniture colors that you see, and put the furniture where you see it.',
    'For each room in the video, people = the count that you see. Use the audio too (crowd noise, alarms, speech about exits).'
  ].join('\n');

  const NEW_RULES = [
    'Convert the venue input (floor plan photo, PDF, drawing, hand sketch, or walkthrough video) to JSON for an evacuation simulator.',
    'Use a grid of about 80 x 46 cells.',
    SCHEMA_RULES, VIDEO_RULES,
    'If there is no video, people = a realistic count for the room type.',
    'If there is a floor plan and a video: take the geometry from the floor plan; take exits, locked state and people counts from the video.',
    'Return only the JSON object. Example of the format (add "notes"; add colors and "objects" if you can see them):'
  ].join('\n');

  const OBSERVE_RULES = [
    'The photo or video shows one or more rooms of a venue. The JSON below is the layout of that venue in an evacuation simulator.',
    'Grid: 1 cell = about 1 m. Origin top-left, x to the right, y down. Each room rectangle includes its walls (1 cell thick).',
    'Find the room or rooms of the layout that the input shows. Use the room names, sizes, furniture, doors and signs.',
    'Return only this JSON object:',
    '{"rooms":[{"name":"<exact room name from the layout>","people":<count of the people you see in that room>,"color":"#rrggbb","why":"<short reason for the match>"}],',
    ' "wallColor":"#rrggbb",',
    ' "objects":[{"type":"table|desk|chair|sofa|counter|bar|stage|shelf|plant|screen","x":<int>,"y":<int>,"w":<int>,"h":<int>,"color":"#rrggbb"}],',
    ' "openings":[{"id":"<id of a door or exit in the layout>","locked":true}],',
    ' "notes":["..."]}',
    'rooms.color = the floor color you see. wallColor = the wall color you see.',
    'objects: the large furniture you see, in layout grid cells INSIDE a matched room and not on its wall cells. Keep the arrangement that you see. Maximum 40 items.',
    'openings: only a door or exit of a matched room that is blocked or closed off in the input. If none, an empty list.',
    'notes: maximum 6 short strings. Each note says one thing you saw or heard that matters in an evacuation (people, exit signs, blocked paths, furniture in the way) and where.',
    'Layout:'
  ].join('\n');

  /* The part of a layout that Gemini needs to place a photo: geometry and ids only. */
  const geometryOf = L => ({ name: L.name, width: L.width, height: L.height,
    rooms: L.rooms.map(r => ({ name: r.name, x: r.x, y: r.y, w: r.w, h: r.h })),
    doors: L.doors.map(d => ({ id: d.id, x: d.x, y: d.y })),
    exits: L.exits.map(e => ({ id: e.id, name: e.name, x: e.x, y: e.y })) });

  async function layoutFrom(cfg, prompt, files, onStatus, opts) {
    if (!cfg.key) throw new Error('no API key');
    const parts = [{ text: prompt }];
    for (const file of files) parts.push(await mediaPart(cfg, file, onStatus));
    onStatus('reading ' + files.map(f => f.name).join(' + ') + '…');
    return parseJson(await call(cfg, parts, true, opts));
  }

  /* files = floor plan and/or walkthrough video. Returns a new layout (+ notes). */
  const layoutFromMedia = (cfg, files, example, onStatus) => layoutFrom(cfg, NEW_RULES + '\n' + JSON.stringify(example), files, onStatus, DEEP);

  /* files = photos or video of rooms of `layout`. Returns an observation for FireSim.applyObservation.
   * The reply is a small patch, not a whole layout: that keeps the call fast. */
  const observe = async (cfg, files, layout, onStatus) =>
    layoutFrom(cfg, OBSERVE_RULES + '\n' + JSON.stringify(geometryOf(layout)), await Promise.all(files.map(shrink)), onStatus, FAST);

  /* The same, for a camera frame of a room that is KNOWN (the phone user picked it): Gemini does not
   * have to find the room, only to read it. The result always names that room. */
  /* poses[k] = where the phone stood and faced for files[k]: {x, y, yaw} (yaw: 0 = north = smaller y, 90 = east = larger x), or null. */
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function poseHint(poses) {
    const known = (poses || []).map((p, k) => p && 'Picture ' + (k + 1) + ': the camera stood at cell (' + p.x + ', ' + p.y + ') and looked ' +
      COMPASS[Math.round(p.yaw / 45) % 8] + ' (' + p.yaw + ' degrees).').filter(Boolean);
    if (!known.length) return '';
    return 'On this plan north = smaller y, east = larger x, south = larger y, west = smaller x. ' + known.join(' ') +
      ' Use this to place things: the centre of a picture is in the look direction, things on the left of the picture are to the camera\'s left, ' +
      'near things are close to the camera cell and far things are near the wall it looks at. ';
  }

  async function observeRoom(cfg, files, layout, roomName, poses) {
    const r = layout.rooms.find(x => x.name === roomName);
    const many = files.length > 1 ? 'The ' + files.length + ' pictures are frames of 1 video of the same room, taken a few seconds apart from different places. Use all of them: count each person and each piece of furniture once. ' : '';
    const hint = many + poseHint(poses) + 'The input shows the room "' + roomName + '": x ' + r.x + ', y ' + r.y + ', w ' + r.w + ', h ' + r.h +
      '. Its floor cells are x ' + (r.x + 1) + '..' + (r.x + r.w - 2) + ', y ' + (r.y + 1) + '..' + (r.y + r.h - 2) +
      '. Do not choose another room. Put every object on those floor cells, spread over the room as you see them.';
    const obs = await layoutFrom(cfg, OBSERVE_RULES + '\n' + JSON.stringify(geometryOf(layout)) + '\n' + hint, await Promise.all(files.map(shrink)), () => {}, FAST);
    const first = (Array.isArray(obs.rooms) && obs.rooms[0]) || {};
    obs.rooms = [Object.assign({}, first, { name: roomName })];
    return obs;
  }

  /* Layout "notes" as shown to the user: what Gemini saw or heard. */
  const notesOf = layout => (Array.isArray(layout.notes) ? layout.notes : []).slice(0, NOTES_MAX).map(n => String(n).slice(0, NOTE_LEN));

  /* status = Sim.status(). Used when there is no key, and as the facts for the LLM. */
  function fallbackAnnouncement(st) {
    const list = a => a.join(' and ');
    return ['Attention.',
      st.fireRooms.length ? 'Fire in ' + list(st.fireRooms.slice(0, 2)) + '.' : 'Fire alarm.',
      st.blocked.length ? 'Do not use ' + list(st.blocked) + '.' : '',
      st.open.length ? 'Leave now by ' + list(st.open) + '.' : 'No clear exit. Stay low and move away from smoke.'
    ].filter(Boolean).join(' ');
  }

  async function announce(cfg, st) {
    const text = await call(cfg, [{ text:
      'You are the public-address voice of a building fire system. Write the next announcement for the occupants: ' +
      'maximum 2 short sentences, calm, imperative, plain English. Use only these facts. Do not name an exit that is not in "open". ' +
      'Reply with the announcement text only.\nFacts: ' + JSON.stringify(st) }], false, FAST);
    return text.trim().slice(0, 300);
  }

  /* ctx = {layout, ignitions, baseline}. Returns up to 3 actions for FireSim.applyAction, each with a reason. */
  async function proposeFixes(cfg, ctx) {
    const text = await call(cfg, [{ text:
      'You are a fire safety engineer. A fire simulation of this building had the result below. ' +
      'Propose up to 3 different single changes that can decrease the number of people lost. Allowed actions:\n' +
      '{"action":"unlock","id":"<id of a locked door or exit>","reason":"..."}\n' +
      '{"action":"add_exit","x":<int>,"y":<int>,"reason":"..."}  (a wall cell between a room interior and the outside of the building, not a corner)\n' +
      'A deterministic simulator will score each proposal, so be specific. reason = 1 short sentence.\n' +
      'Return JSON: {"proposals":[...]}\n' +
      'Layout: ' + JSON.stringify(ctx.layout) + '\nFire start points (tick,x,y): ' + JSON.stringify(ctx.ignitions) +
      '\nBaseline result: ' + JSON.stringify(ctx.baseline) }], true, FAST);
    const list = parseJson(text).proposals;
    return (Array.isArray(list) ? list : []).filter(p => p && typeof p === 'object').slice(0, 3)
      .map(p => Object.assign({}, p, { reason: String(p.reason || '').slice(0, 200) }));
  }

  /* ---- Advisor: the same two models, streamed so the page can show their thinking as it happens. ----
   * onThought(text) gets each thought summary the model writes. Returns the reply text (thoughts excluded). */
  async function stream(cfg, prompt, opts, onThought) {
    if (!cfg.key) throw new Error('no API key');
    const config = { responseMimeType: 'application/json', thinkingConfig: { includeThoughts: true } };
    if (opts.thinking) config.thinkingConfig.thinkingLevel = opts.thinking;
    const model = (opts.deep && cfg.deep) || cfg.model;
    const res = await fetch(ENDPOINT + encodeURIComponent(model) + ':streamGenerateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: config })
    });
    if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const parts = ((((JSON.parse(line.slice(5)).candidates || [])[0] || {}).content || {}).parts) || [];
        for (const p of parts) {
          if (!p.text) continue;
          if (p.thought) { if (onThought) onThought(p.text); } else text += p.text;
        }
      }
    }
    if (!text) throw new Error('Gemini: empty reply');
    return text;
  }

  const ADVISOR_ACTIONS = [
    '{"action":"unlock","id":"<id of a locked door or exit>","reason":"..."}',
    '{"action":"widen","id":"<id of a door or exit>","reason":"..."}  (1 m wider)',
    '{"action":"cap_room","room":"<exact room name>","people":<new lower occupancy>,"reason":"..."}',
    '{"action":"add_exit","x":<int>,"y":<int>,"reason":"..."}  (a wall cell between a room interior and the outside, not a corner)'
  ].join('\n');

  /* Fast model: which changes are worth testing, given what went wrong in the runs. Returns up to 4 actions. */
  async function proposeChecks(cfg, layout, summary, onThought) {
    const text = await stream(cfg,
      'You are a venue safety analyst. A deterministic evacuation simulator ran many scenarios on this venue ' +
      '(fires in different rooms, falls at doorways, evacuations with no fire, a blocked exit). The summary is below. ' +
      'Propose up to 4 different single changes to test, aimed at the hazards that cost the most people. ' +
      'The simulator will run every scenario again with each change, so be specific. Allowed actions:\n' + ADVISOR_ACTIONS +
      '\nreason = 1 short sentence that names the hazard it targets. Return JSON: {"proposals":[...]}\n' +
      'Layout: ' + JSON.stringify(layout) + '\nSummary of the runs: ' + JSON.stringify(summary), FAST, onThought);
    const list = parseJson(text).proposals;
    return (Array.isArray(list) ? list : []).filter(p => p && typeof p === 'object').slice(0, 4)
      .map(p => Object.assign({}, p, { reason: String(p.reason || '').slice(0, 200) }));
  }

  const GUIDE_FORMAT = '{"headline":"<1 sentence: the main finding>",' +
    '"prevalent":[{"hazard":"...","where":"<room or door id>","howOften":"<from the runs>","impact":"<from the runs>"}],' +
    '"during":[{"when":"<trigger, e.g. queue at a door over 20 people, fire in a room, a person falls>","do":"<what staff do, 1-2 sentences>"}],' +
    '"prevent":[{"action":"...","priority":"high|medium|low","evidence":"<the measured change, or untested>"}],' +
    '"watch":["<what the cameras and staff should watch for, with a number>"],' +
    '"limits":"<1 sentence on what the simulation does not model>"}';

  /* Reasoning model: the advice guide. facts = {summary, tests, settings}. Only numbers from facts may be used. */
  async function adviseGuide(cfg, facts, onThought) {
    const text = await stream(cfg,
      'You are a crowd and fire safety advisor for an event venue. Write an advice guide for the venue manager from the ' +
      'simulation results below. Rules: use only numbers that are in the results; say which hazards are most prevalent and why; ' +
      'say what staff should do when each hazard happens; recommend prevention, best first, and give the measured effect for ' +
      'every change that was tested ("tests"); never recommend a change whose results were worse; say plainly when something is untested. ' +
      'Plain English, short sentences. Maximum 5 items in each list. Return only JSON in this format:\n' + GUIDE_FORMAT +
      '\nResults: ' + JSON.stringify(facts), DEEP, onThought);
    return parseJson(text);
  }

  /* Guide from the numbers alone, for no key or a failed call. Same format as adviseGuide. */
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

  window.Gemini = { call, layoutFromMedia, observe, observeRoom, notesOf, announce, fallbackAnnouncement, proposeFixes,
    proposeChecks, adviseGuide, fallbackGuide };
})();
