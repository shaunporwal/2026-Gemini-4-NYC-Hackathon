/* Live view: the newest frame from each phone, with the sim's smoke and fire of that room drawn over it.
 * Same interface as render.js: create() -> {fit, cellAt, draw}. Reads the sim and the feed; changes neither.
 * Below the pictures: the frames the server saved (tap one to look at it again), and how a phone joins. */
(function () {
  'use strict';
  const REFRESH_MS = 1000;     // a phone sends about 1 frame each second
  const INFO_MS = 5000;        // how often to ask the server for the phone link and the saved frames
  const STALE_S = 5;           // no frame for this long = the phone stopped
  const MAX_TILES = 4, MAX_SAVED = 12;
  const HAZE_MAX = 0.6;        // the picture must stay readable in full smoke
  const GLOW_GAIN = 5;
  const TEXT = {
    join: 'Join with a phone', steps: 'Scan the code. Pick your room. Start the camera.',
    noLink: 'No phone link yet. Start the tunnel to the feed server.', off: 'The feed server is off.',
    people: ' people', last: 'last frame ', saved: 'saved frame ', back: 'Tap the picture to go back to live.',
    savedTitle: 'Saved frames (tap to view)', none: 'No camera picture yet. Tap Camera, pick your room, and send one.', smoke: 'smoke ', fire: 'FIRE'
  };
  const clock = ms => new Date(ms).toLocaleTimeString();

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* src = { cameras(): Observation[], frameUrl(room), qrUrl(), info(), captures(), captureUrl(room, file) } */
  function create(root, wrap, src) {
    const grid = el('div', 'tiles'), saved = el('div', 'saved'), strip = el('div', 'strip'), join = el('div', 'join');
    const qr = el('img', 'qr'), joinText = el('div'), joinLink = el('span', 'link');
    qr.alt = 'QR code of the phone link';
    joinText.append(el('b', null, TEXT.join), joinLink, el('span', null, TEXT.steps));
    join.append(qr, joinText);
    saved.append(el('span', null, TEXT.savedTitle), strip);
    saved.hidden = true;
    root.append(grid, el('div', 'none', TEXT.none), saved, join);
    const tiles = new Map();    // room name -> {fig, img, haze, glow, cap, shown}
    const pinned = new Map();   // room name -> {url, t}: a saved frame shown in place of the live one
    let lastFrames = 0, lastInfo = -INFO_MS, link = null, stripKey = '';

    function tile(room) {
      const fig = el('figure'), img = el('img'), haze = el('div', 'haze'), glow = el('div', 'glow'), cap = el('figcaption');
      img.alt = 'Camera in ' + room;
      fig.append(img, haze, glow, cap);
      fig.onclick = () => { if (pinned.delete(room)) tiles.get(room).shown = null; };
      grid.append(fig);
      const t = { fig, img, haze, glow, cap, shown: null };
      tiles.set(room, t);
      return t;
    }

    /* Load the next picture off screen, then swap: no flicker, and a failed load keeps the last one. */
    function show(t, url) {
      const next = new Image();
      next.onload = () => { t.img.src = next.src; };
      next.src = url;
    }

    /* Share of the room that is smoke (0..1) and that is burning (0..1), from the sim. */
    function roomState(sim, name) {
      const ri = sim.L.rooms.findIndex(r => r.name === name);
      let n = 0, smoke = 0, fire = 0;
      if (ri >= 0) for (let i = 0; i < sim.N; i++) if (sim.roomOf[i] === ri) { n++; smoke += Math.min(1, sim.smoke[i]); if (sim.fire[i]) fire++; }
      return n ? { smoke: smoke / n, fire: fire / n } : { smoke: 0, fire: 0 };
    }

    function showJoin(j) {
      if (j.phoneUrl === link) return;
      link = j.phoneUrl;
      qr.hidden = !link;
      if (link) qr.src = src.qrUrl();
      joinLink.textContent = link || TEXT.noLink;
    }

    /* The strip of saved frames, newest first, across all rooms. */
    function showSaved(c) {
      const all = [];
      for (const room in c.rooms) for (const f of c.rooms[room]) all.push({ room, file: f.file, t: f.t });
      all.sort((a, b) => b.t - a.t);
      const list = all.slice(0, MAX_SAVED), key = list.map(f => f.room + f.file).join();
      saved.hidden = !list.length;
      if (key === stripKey) return;
      stripKey = key;
      strip.replaceChildren(...list.map(f => {
        const b = el('button'), img = el('img'), url = src.captureUrl(f.room, f.file);
        img.src = url; img.alt = ''; img.loading = 'lazy';
        b.append(img, el('span', null, f.room), el('span', null, clock(f.t)));
        b.onclick = () => { pinned.set(f.room, { url, t: f.t }); (tiles.get(f.room) || tile(f.room)).shown = null; };
        return b;
      }));
    }

    function poll(now) {
      if (now - lastInfo < INFO_MS) return;
      lastInfo = now;
      src.info().then(showJoin).catch(() => { link = null; qr.hidden = true; joinLink.textContent = TEXT.off; });
      src.captures().then(showSaved).catch(() => {});
    }

    function draw(sim, t) {
      const cams = new Map(src.cameras().map(o => [o.cameraId, o]));
      const rooms = [...new Set([...cams.keys(), ...pinned.keys()])].slice(0, MAX_TILES);
      const nowS = Date.now() / 1000, due = t - lastFrames >= REFRESH_MS;
      if (due) lastFrames = t;
      for (const [room, tl] of tiles) if (!rooms.includes(room)) { tl.fig.remove(); tiles.delete(room); }
      for (const room of rooms) {
        const tl = tiles.get(room) || tile(room), o = cams.get(room), pin = pinned.get(room), st = roomState(sim, room);
        const lastS = (o && o.stream && o.stream.lastFrame) || 0, stopped = nowS - lastS > STALE_S;
        if (pin) { if (tl.shown !== pin.url) { tl.shown = pin.url; show(tl, pin.url); } }
        // A running camera: each second. A stopped one (or a single photo): once for each new frame.
        else if (o && due && (!stopped || tl.shown !== o.timestamp)) { tl.shown = o.timestamp; show(tl, src.frameUrl(room)); }
        tl.haze.style.opacity = Math.min(HAZE_MAX, st.smoke * HAZE_MAX * 1.5);
        tl.glow.style.opacity = Math.min(1, st.fire * GLOW_GAIN) * (0.75 + 0.25 * Math.sin(t / 90));
        const sim1 = st.fire > 0 ? TEXT.fire : st.smoke > 0.02 ? TEXT.smoke + Math.round(st.smoke * 100) + '%' : '';
        const what = pin ? TEXT.saved + clock(pin.t) + '. ' + TEXT.back
          : o.peopleCount + TEXT.people + ' · ' + (stopped ? TEXT.last + clock(lastS * 1000) : [o.density].concat(o.events).join(', '));
        tl.cap.textContent = [room, what, sim1].filter(Boolean).join(' · ');
        tl.fig.classList.toggle('alarm', st.fire > 0);
      }
      root.classList.toggle('empty', !rooms.length);
      poll(t);
    }

    return { fit() {}, cellAt() { return null; }, draw };
  }

  window.FireRenderLive = { create };
})();
