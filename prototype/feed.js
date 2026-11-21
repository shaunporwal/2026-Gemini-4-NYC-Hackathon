/* Live feed from the perception server (server/, port 8000): phones in, Observations out.
 * This file only talks to that server. It does not change the sim: app.js decides what an Observation does.
 * An Observation's cameraId is a room name of the current layout (the phone user picks the room). */
(function () {
  'use strict';
  /* On the demo machine the page comes from its own small server (port 8765) and the feed server is on port 8000.
   * Anywhere else the feed server serves the page too (/app/), so the feed is on the same address. */
  const PRESENTER = location.port === '8765';   // only the demo machine's page sets the server's key and floor plan
  const BASE = PRESENTER ? 'http://localhost:8000' : location.origin;
  const RETRY_MS = 3000;
  let socket = null;

  /* Give the server the API key and the floor plan (room names + rectangles, for the phone's room picker).
   * Local only: the server refuses this from other machines. */
  async function configure(key, layout) {
    if (!PRESENTER) return null;
    const plan = { width: layout.width, height: layout.height,
      rooms: layout.rooms.map(r => ({ name: r.name, x: r.x, y: r.y, w: r.w, h: r.h })) };
    const res = await fetch(BASE + '/twin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, plan, layout })
    });
    if (!res.ok) throw new Error('feed server ' + res.status);
    return res.json();
  }

  /* onObservation(obs) for each update; onState(true|false) when the link opens or closes. Reconnects. */
  function listen(onObservation, onState) {
    const open = () => {
      socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
      socket.onopen = () => onState(true);
      socket.onmessage = ev => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && msg.type === 'observation' && msg.observation) onObservation(msg.observation);
      };
      socket.onclose = () => { onState(false); setTimeout(open, RETRY_MS); };
    };
    open();
  }

  /* What the live view needs from the server: the newest frame of a room, and how phones join. */
  const frameUrl = room => BASE + '/frame/' + encodeURIComponent(room) + '/latest.jpg?t=' + Date.now();
  const qrUrl = () => BASE + '/qr.svg?t=' + Date.now();
  const info = () => fetch(BASE + '/').then(r => r.json());

  /* The presenter's current layout, for a copy of the page that someone else opens. Null if there is none. */
  const layout = () => fetch(BASE + '/layout').then(r => (r.ok ? r.json() : null));

  /* Frames the server saved from phones: {rooms: {room: [{file, t}]}}, and the address of one of them. */
  const captures = () => fetch(BASE + '/captures').then(r => r.json());
  const captureUrl = (room, file) => BASE + '/captures/' + encodeURIComponent(room) + '/' + encodeURIComponent(file);

  /* The server's Gemini agent (server/agent.py). The reply streams as NDJSON: onEvent gets each
   * {type: 'step' | 'thought', text} while it works. Resolves with the result, or throws the server's error. */
  async function streamed(path, body, onEvent) {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'agent service ' + res.status);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        if (ev.type === 'result') return ev.result;
        if (ev.type === 'error') throw new Error(ev.text);
        if (onEvent) onEvent(ev);
      }
    }
    throw new Error('the agent service closed the connection');
  }
  const agentAsk = (body, onEvent) => streamed('/agent/ask', body, onEvent);
  const advisorPropose = (body, onEvent) => streamed('/advisor/propose', body, onEvent);
  const advisorGuide = (body, onEvent) => streamed('/advisor/guide', body, onEvent);

  window.Feed = { configure, listen, frameUrl, qrUrl, info, layout, captures, captureUrl, presenter: PRESENTER,
    agentAsk, advisorPropose, advisorGuide };
})();
