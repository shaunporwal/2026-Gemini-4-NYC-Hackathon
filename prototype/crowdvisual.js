/* Renderer-only interpolation and crowding. Never changes simulation positions or randomness.
 * Continuous crowds use real substep positions; tile mode keeps its legacy interpolation. */
(function () {
  'use strict';
  function create() {
    let current = null, tick = -1, tracks = [], crowding = new Uint16Array(), queued = new Uint16Array();
    let clock = 0, previousTime = null;
    let density = new Float32Array(), densityWeight = new Float32Array(), contact = new Uint8Array(), heat = new Uint8Array();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    function update(sim, time, options) {
      const fresh = current !== sim;
      const elapsed = previousTime == null ? 0 : Math.min(50, Math.max(0, time - previousTime));
      previousTime = time;
      const animate = options.running && !reduced.matches && !sim.done;
      if (fresh) {
        current = sim; tick = -1; clock = 0;
        tracks = sim.people.map(p => ({ x: p.i % sim.W, y: Math.floor(p.i / sim.W), fromX: p.i % sim.W,
          fromY: Math.floor(p.i / sim.W), targetX: p.i % sim.W, targetY: Math.floor(p.i / sim.W), at: 0,
          heading: 0, targetHeading: 0, phase: 0, gait: 0, moving: false, slotX: 0, slotY: 0, size: 1 }));
        crowding = new Uint16Array(sim.N); queued = new Uint16Array(sim.N);
        density = new Float32Array(sim.N); densityWeight = new Float32Array(sim.N); contact = new Uint8Array(sim.N); heat = new Uint8Array(sim.N);
      }
      if (animate) clock += elapsed;
      if (sim.crowdMode === 'continuous') {
        const alpha = options.running && !sim.done && !reduced.matches ? Math.max(0, Math.min(1, options.alpha ?? 1)) : 1;
        if (tick !== sim.substep) {
          density.fill(0); densityWeight.fill(0); queued.fill(0); contact.fill(0); heat.fill(0);
          const radius = Math.max(1, Math.ceil(0.8 / sim.cellSize));
          sim.people.forEach(p => {
            if (p.state !== window.FireSim.ACTIVE) return;
            const cx = Math.floor(p.x), cy = Math.floor(p.y);
            if (p.compression > 0.08) contact[p.i] = Math.max(contact[p.i], p.contact || 0);
            for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
              const x = cx + dx, y = cy + dy;
              if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue;
              const distance = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) * sim.cellSize;
              const weight = Math.max(0, 1 - distance / 1.1);
              if (!weight) continue;
              const i = y * sim.W + x;
              density[i] += Math.max(0, p.density || 0) * weight;
              densityWeight[i] += weight;
              if (p.queueOpening >= 0) queued[i]++;
            }
          });
          for (let i = 0; i < sim.N; i++) {
            if (densityWeight[i]) density[i] /= densityWeight[i];
            // Illustrative occupancy bands, not injury or crowd-pressure thresholds.
            heat[i] = density[i] >= 4 ? 3 : density[i] >= 2.5 || queued[i] >= 2 || contact[i] >= 2 ? 2 : density[i] >= 1.5 || queued[i] ? 1 : 0;
          }
          tick = sim.substep;
        }
        tracks.forEach((track, index) => {
          const p = sim.people[index];
          const x = (p.prevX ?? p.x) + (p.x - (p.prevX ?? p.x)) * alpha;
          const y = (p.prevY ?? p.y) + (p.y - (p.prevY ?? p.y)) * alpha;
          const distance = fresh ? 0 : Math.hypot(x - 0.5 - track.x, y - 0.5 - track.y);
          track.x = x - 0.5; track.y = y - 0.5;
          track.size = 1; track.slotX = 0; track.slotY = 0;
          const speed = Math.hypot(p.vx || 0, p.vy || 0) * sim.cellSize;
          track.moving = p.state === window.FireSim.ACTIVE && speed > 0.08;
          if (track.moving) track.targetHeading = Math.atan2(p.vx, p.vy);
          const turn = Math.atan2(Math.sin(track.targetHeading - track.heading), Math.cos(track.targetHeading - track.heading));
          track.heading += fresh || reduced.matches ? turn : animate ? turn * Math.min(1, elapsed / 90) : 0;
          if (animate) track.gait += distance * sim.cellSize * 9;
          track.phase = Math.sin(track.gait + index * 2.4);
          track.alert = p.state === window.FireSim.ACTIVE && sim.alarmTick >= 0 && sim.seconds >= (sim.alarmSeconds ?? sim.alarmTick * window.FireSim.DT) + p.delay * window.FireSim.DT;
          track.waiting = track.alert && !track.moving;
          const idle = clock / 1000 * 5 + index * 2.399;
          track.shuffle = track.waiting && !reduced.matches ? Math.sin(idle) * 0.45 : 0;
          // Do not fan out, shrink, or sway body positions: tight spacing comes from physics.
          track.sway = 0;
          track.bob = track.moving && !reduced.matches ? Math.abs(track.phase) * 0.065 * Math.min(1, speed / 0.7) : 0;
          track.wave = track.alert && !reduced.matches ? Math.sin(clock / 1000 * 7 + index * 1.7) : 0;
        });
        return { tracks, crowding, queued, density, contact, heat, clock, reduced: reduced.matches };
      }
      if (tick !== sim.tick) {
        crowding.fill(0); queued.fill(0);
        const occupants = new Map();
        sim.people.forEach((p, index) => {
          const track = tracks[index], x = p.i % sim.W, y = Math.floor(p.i / sim.W);
          if (x !== track.targetX || y !== track.targetY) {
            const snap = !options.running || sim.tick - tick > 4
              || Math.abs(x - track.targetX) > 1 || Math.abs(y - track.targetY) > 1;
            track.fromX = track.x - track.slotX; track.fromY = track.y - track.slotY;
            track.targetHeading = Math.atan2(x - track.targetX, y - track.targetY);
            track.targetX = x; track.targetY = y; track.at = clock;
            // The engine's cooldown controls how long one rendered step takes.
            track.duration = Math.max(16, options.stepMs * Math.max(1, p.cool));
            // A view reopened while paused must show the latest cell, not an old interpolation.
            if (snap) { track.fromX = x; track.fromY = y; track.heading = track.targetHeading; }
          }
          if (p.state !== window.FireSim.ACTIVE) return;
          if (!occupants.has(p.i)) occupants.set(p.i, []);
          occupants.get(p.i).push(track);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= sim.W || ny >= sim.H) continue;
            const i = ny * sim.W + nx;
            crowding[i]++;
            if (p.queueOpening >= 0) queued[i]++;
          }
        });
        // Normally one active person per cell. Defensive fan-out for overlapping imported spawns.
        for (const group of occupants.values()) group.forEach((track, slot) => {
          const angle = slot / group.length * Math.PI * 2;
          track.slotX = group.length > 1 ? Math.cos(angle) * 0.23 : 0;
          track.slotY = group.length > 1 ? Math.sin(angle) * 0.23 : 0;
          track.size = group.length > 1 ? Math.max(0.25, 0.75 / Math.sqrt(group.length)) : 1;
        });
        tick = sim.tick;
        for (let i = 0; i < sim.N; i++) {
          const count = crowding[i], waiting = queued[i];
          heat[i] = waiting >= 2 || count >= 6 ? 3 : count >= 4 ? 2 : count >= 3 || waiting ? 1 : 0;
        }
      }
      tracks.forEach((track, index) => {
        const p = sim.people[index], oldX = track.x, oldY = track.y;
        const progress = reduced.matches ? 1 : Math.min(1, (clock - track.at) / (track.duration || 1));
        track.x = track.fromX + (track.targetX - track.fromX) * progress + track.slotX;
        track.y = track.fromY + (track.targetY - track.fromY) * progress + track.slotY;
        track.moving = progress < 1 && (track.fromX !== track.targetX || track.fromY !== track.targetY);
        const turn = Math.atan2(Math.sin(track.targetHeading - track.heading), Math.cos(track.targetHeading - track.heading));
        track.heading += reduced.matches ? turn : animate ? turn * Math.min(1, elapsed / 75) : 0;
        const distance = Math.hypot(track.x - oldX, track.y - oldY);
        if (animate) track.gait += distance * 8;
        track.phase = Math.sin(track.gait + index * 2.4);
        track.alert = p.state === window.FireSim.ACTIVE && sim.alarmTick >= 0 && sim.tick - sim.alarmTick >= p.delay;
        track.waiting = track.alert && !track.moving;
        // A small weight shift and foot shuffle, not movement into a blocked tile.
        const idle = clock / 1000 * 5 + index * 2.399;
        track.shuffle = track.waiting && !reduced.matches ? Math.sin(idle) : 0;
        track.sway = track.waiting && !reduced.matches ? Math.sin(idle * 0.6) * 0.035 : 0;
        track.bob = track.moving && !reduced.matches ? Math.abs(Math.sin(track.gait + index * 2.4)) * 0.085 : 0;
        track.wave = track.alert && !reduced.matches ? Math.sin(clock / 1000 * 7 + index * 1.7) : 0;
      });
      return { tracks, crowding, queued, density, heat, clock, reduced: reduced.matches };
    }
    return { update };
  }
  window.CrowdVisual = { create };
})();
