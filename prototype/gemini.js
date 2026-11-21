/* All LLM work is here: prompts + the Gemini REST call. No sim logic, no DOM.
 * The LLM reads (photo -> layout), speaks (PA text) and proposes (fixes).
 * It never decides: sim.js scores every proposal. */
(function () {
  'use strict';
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

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

  const LAYOUT_RULES = [
    'Convert this floor plan (photo, PDF, drawing or hand sketch) to JSON for an evacuation simulator.',
    'Grid: 1 cell = about 1 m. Origin top-left, x to the right, y down. Use a grid of about 80 x 46 cells. Cells not covered by a room are outside the building.',
    'rooms: axis-aligned rectangles {name,x,y,w,h,people}. Each rectangle INCLUDES its walls (1 cell thick).',
    'Adjacent rooms share a wall: their rectangles overlap by exactly 1 cell. Corridors and lobbies are rooms. Approximate irregular shapes with rectangles. Merge small rooms.',
    'doors: {id,x,y,w,h,locked} on a wall shared by 2 rooms. Not on a corner.',
    'exits: {id,name,x,y,w,h,locked} on a wall between a room and the outside. Not on a corner.',
    'Each room needs a door or an exit. people = a realistic count for the room type.',
    'Return only the JSON object. Example of the format:'
  ].join('\n');

  async function layoutFromPhoto(cfg, file, example) {
    const text = await call(cfg, [
      { text: LAYOUT_RULES + '\n' + JSON.stringify(example) },
      { inline_data: { mime_type: file.type || 'image/jpeg', data: await toBase64(file) } }
    ], true);
    return parseJson(text);
  }

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

  window.Gemini = { call, layoutFromPhoto, announce, fallbackAnnouncement, proposeFixes };
})();
