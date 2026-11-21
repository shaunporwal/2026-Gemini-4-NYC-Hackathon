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

  /* cfg = {key, model}. parts = Gemini "parts" array. Returns the reply text. */
  async function call(cfg, parts, wantJson) {
    if (!cfg.key) throw new Error('no API key');
    const res = await fetch(ENDPOINT + encodeURIComponent(cfg.model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: wantJson ? { responseMimeType: 'application/json' } : {}
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
    'notes: maximum 6 short strings. Each note says one thing you saw or heard in the input and where (with the video time, if there is one).'
  ].join('\n');

  const VIDEO_RULES = [
    'A video is a walkthrough of the venue. Find the rooms and their connections from the path of the camera.',
    'Estimate sizes from people, doors (about 1 m wide) and furniture.',
    'Set locked=true for a door or exit that is blocked, chained or closed off in the video.',
    'For each room in the video, people = the count that you see. Use the audio too (crowd noise, alarms, speech about exits).'
  ].join('\n');

  const NEW_RULES = [
    'Convert the venue input (floor plan photo, PDF, drawing, hand sketch, or walkthrough video) to JSON for an evacuation simulator.',
    'Use a grid of about 80 x 46 cells.',
    SCHEMA_RULES, VIDEO_RULES,
    'If there is no video, people = a realistic count for the room type.',
    'If there is a floor plan and a video: take the geometry from the floor plan; take exits, locked state and people counts from the video.',
    'Return only the JSON object. Example of the format (add "notes"):'
  ].join('\n');

  const UPDATE_RULES = [
    'The JSON below is the current layout of a venue in an evacuation simulator. The video is a walkthrough of the same venue.',
    'Correct the layout from the video: add, move or remove exits and doors; set locked; set people for each room.',
    'Do not change a room rectangle unless the video clearly contradicts it. Keep width and height.',
    SCHEMA_RULES, VIDEO_RULES,
    'Return only the full corrected JSON object, with "notes". Current layout:'
  ].join('\n');

  async function layoutFrom(cfg, prompt, files, onStatus) {
    if (!cfg.key) throw new Error('no API key');
    const parts = [{ text: prompt }];
    for (const file of files) parts.push(await mediaPart(cfg, file, onStatus));
    onStatus('reading ' + files.map(f => f.name).join(' + ') + '…');
    return parseJson(await call(cfg, parts, true));
  }

  /* files = floor plan and/or walkthrough video. Returns a new layout (+ notes). */
  const layoutFromMedia = (cfg, files, example, onStatus) => layoutFrom(cfg, NEW_RULES + '\n' + JSON.stringify(example), files, onStatus);

  /* Returns `layout` corrected from a walkthrough video (+ notes). */
  const updateFromVideo = (cfg, file, layout, onStatus) => layoutFrom(cfg, UPDATE_RULES + '\n' + JSON.stringify(layout), [file], onStatus);

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
      'Reply with the announcement text only.\nFacts: ' + JSON.stringify(st) }], false);
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
      '\nBaseline result: ' + JSON.stringify(ctx.baseline) }], true);
    const list = parseJson(text).proposals;
    return (Array.isArray(list) ? list : []).filter(p => p && typeof p === 'object').slice(0, 3)
      .map(p => Object.assign({}, p, { reason: String(p.reason || '').slice(0, 200) }));
  }

  window.Gemini = { call, layoutFromMedia, updateFromVideo, notesOf, announce, fallbackAnnouncement, proposeFixes };
})();
