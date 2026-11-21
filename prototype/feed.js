/* Live feed from the perception server (server/, port 8000): phones in, Observations out.
 * This file only talks to that server. It does not change the sim: app.js decides what an Observation does.
 * An Observation's cameraId is a room name of the current layout (the phone user picks the room). */
(function () {
  'use strict';
  const HOST = 'localhost:8000', RETRY_MS = 3000;
  let socket = null;

  /* Give the server the API key and the room names. Local only: the server refuses this from other machines. */
  async function configure(key, rooms) {
    const res = await fetch('http://' + HOST + '/twin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, rooms })
    });
    if (!res.ok) throw new Error('feed server ' + res.status);
    return res.json();
  }

  /* onObservation(obs) for each update; onState(true|false) when the link opens or closes. Reconnects. */
  function listen(onObservation, onState) {
    const open = () => {
      socket = new WebSocket('ws://' + HOST + '/ws');
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

  window.Feed = { configure, listen };
})();
