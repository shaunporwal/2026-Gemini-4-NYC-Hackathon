/* Live view: the newest frame from each phone, with the sim's smoke and fire of that room drawn over it.
 * Same interface as render.js: create() -> {fit, cellAt, draw}. Reads the sim and the feed; changes neither.
 * It always shows how a phone joins (QR code + link): large with no phone, small beside the cameras. */
(function () {
  'use strict';
  const REFRESH_MS = 1000;     // a phone sends about 1 frame each second
  const INFO_MS = 5000;        // how often to ask the server for the phone link
  const STALE_S = 5;           // no frame for this long = the phone stopped
  const MAX_TILES = 4;
  const HAZE_MAX = 0.88, GLOW_GAIN = 5;
  const TEXT = {
    join: 'Join with a phone', steps: 'Scan the code. Pick your room. Start the camera.',
    noLink: 'No phone link yet. Start the tunnel to the feed server.', off: 'The feed server is off.',
    stopped: 'stopped', people: ' people'
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* src = { cameras(): Observation[], frameUrl(room), qrUrl(), info(): Promise<{phoneUrl}> } */
  function create(root, wrap, src) {
    const grid = el('div', 'tiles'), join = el('div', 'join');
    const qr = el('img', 'qr'), joinText = el('div'), joinTitle = el('b', null, TEXT.join), joinLink = el('span', 'link'), joinSteps = el('span', null, TEXT.steps);
    qr.alt = 'QR code of the phone link';
    joinText.append(joinTitle, joinLink, joinSteps);
    join.append(qr, joinText);
    root.append(grid, join);
    const tiles = new Map();   // room name -> {fig, img, haze, glow, cap}
    let lastFrames = 0, lastInfo = -INFO_MS, link = null;

    function tile(room) {
      const fig = el('figure'), img = el('img'), haze = el('div', 'haze'), glow = el('div', 'glow'), cap = el('figcaption');
      img.alt = 'Live camera in ' + room;
      fig.append(img, haze, glow, cap);
      grid.append(fig);
      const t = { fig, img, haze, glow, cap };
      tiles.set(room, t);
      return t;
    }

    /* Load the next frame off screen, then swap: no flicker, and a failed load keeps the last frame. */
    function refresh(t, room) {
      const next = new Image();
      next.onload = () => { t.img.src = next.src; };
      next.src = src.frameUrl(room);
    }

    /* Share of the room that is smoke (0..1) and that is burning (0..1), from the sim. */
    function roomState(sim, name) {
      const ri = sim.L.rooms.findIndex(r => r.name === name);
      let n = 0, smoke = 0, fire = 0;
      if (ri >= 0) for (let i = 0; i < sim.N; i++) if (sim.roomOf[i] === ri) { n++; smoke += Math.min(1, sim.smoke[i]); if (sim.fire[i]) fire++; }
      return n ? { smoke: smoke / n, fire: fire / n } : { smoke: 0, fire: 0 };
    }

    function showJoin(now) {
      if (now - lastInfo < INFO_MS) return;
      lastInfo = now;
      src.info().then(j => {
        if (j.phoneUrl === link) return;
        link = j.phoneUrl;
        qr.hidden = !link;
        if (link) qr.src = src.qrUrl();
        joinLink.textContent = link || TEXT.noLink;
      }).catch(() => { link = null; qr.hidden = true; joinLink.textContent = TEXT.off; });
    }

    function draw(sim, t) {
      const cams = src.cameras().slice(0, MAX_TILES), nowS = Date.now() / 1000, due = t - lastFrames >= REFRESH_MS;
      if (due) lastFrames = t;
      const names = new Set(cams.map(o => o.cameraId));
      for (const [room, tl] of tiles) if (!names.has(room)) { tl.fig.remove(); tiles.delete(room); }
      for (const o of cams) {
        const tl = tiles.get(o.cameraId) || tile(o.cameraId), st = roomState(sim, o.cameraId);
        const stopped = nowS - ((o.stream && o.stream.lastFrame) || 0) > STALE_S;
        // A running camera: each second. A stopped one (or a single photo): once for each new frame.
        if (due && (!stopped || tl.shown !== o.timestamp)) { tl.shown = o.timestamp; refresh(tl, o.cameraId); }
        tl.fig.classList.toggle('stopped', stopped);
        tl.haze.style.opacity = Math.min(HAZE_MAX, st.smoke * HAZE_MAX * 1.5);
        tl.glow.style.opacity = Math.min(1, st.fire * GLOW_GAIN) * (0.75 + 0.25 * Math.sin(t / 90));
        tl.cap.textContent = o.cameraId + ' · ' + o.peopleCount + TEXT.people + ' · ' +
          (stopped ? TEXT.stopped : [o.density].concat(o.events).join(', '));
      }
      root.classList.toggle('empty', !cams.length);
      showJoin(t);
    }

    return { fit() {}, cellAt() { return null; }, draw };
  }

  window.FireRenderLive = { create };
})();
