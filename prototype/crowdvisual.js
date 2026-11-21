/* Renderer-only positions and local crowding. Never changes simulation state.
 * Crowding = active people in the surrounding 3 × 3 cells; queue membership comes from the engine. */
(function () {
  'use strict';
  function create() {
    let current = null, tick = -1, tracks = [], crowding = new Uint8Array(), queued = new Uint8Array();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    function update(sim, time, options) {
      const fresh = current !== sim;
      if (fresh) {
        current = sim; tick = -1;
        tracks = sim.people.map(p => ({ x: p.i % sim.W, y: Math.floor(p.i / sim.W), fromX: p.i % sim.W,
          fromY: Math.floor(p.i / sim.W), targetX: p.i % sim.W, targetY: Math.floor(p.i / sim.W), at: time, heading: 0, phase: 0, moving: false }));
        crowding = new Uint8Array(sim.N); queued = new Uint8Array(sim.N);
      }
      if (tick !== sim.tick) {
        crowding.fill(0); queued.fill(0);
        sim.people.forEach((p, index) => {
          const track = tracks[index], x = p.i % sim.W, y = Math.floor(p.i / sim.W);
          if (x !== track.targetX || y !== track.targetY) {
            track.fromX = track.x; track.fromY = track.y;
            track.heading = Math.atan2(x - track.targetX, y - track.targetY);
            track.targetX = x; track.targetY = y; track.at = time;
          }
          if (p.state !== window.FireSim.ACTIVE) return;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= sim.W || ny >= sim.H) continue;
            const i = ny * sim.W + nx;
            crowding[i]++;
            if (p.queueOpening >= 0) queued[i]++;
          }
        });
        tick = sim.tick;
      }
      tracks.forEach(track => {
        const progress = reduced.matches || !options.running ? 1 : Math.min(1, (time - track.at) / Math.max(16, options.stepMs));
        track.x = track.fromX + (track.targetX - track.fromX) * progress;
        track.y = track.fromY + (track.targetY - track.fromY) * progress;
        track.moving = progress < 1 && options.running && !reduced.matches
          && (track.fromX !== track.targetX || track.fromY !== track.targetY);
        track.phase = track.moving ? Math.sin(progress * Math.PI * 2) * 0.65 : 0;
      });
      return { tracks, crowding, queued };
    }
    return { update };
  }
  window.CrowdVisual = { create };
})();
