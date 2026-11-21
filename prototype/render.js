/* Canvas view of a Sim. Reads sim state only; never changes it. */
(function () {
  'use strict';
  const F = window.FireSim;
  const CELL = { [F.FLOOR]: '#171b22', [F.WALL]: '#465064', [F.LOCKED]: '#d0342c', [F.DOOR]: '#222a36', [F.EXIT]: '#2ecc71' };
  const OUTSIDE = '#0c0f14';
  const PERSON = { route: '#5ad1ff', trapped: '#ff4fd8', down: '#8a2626' };

  function create(canvas, wrap) {
    const ctx = canvas.getContext('2d');
    let cs = 12;   // cell size, px

    function fit(sim) {
      cs = Math.max(4, Math.floor(Math.min(wrap.clientWidth / sim.W, wrap.clientHeight / sim.H)));
      canvas.width = sim.W * cs; canvas.height = sim.H * cs;
    }

    function cellAt(sim, ev) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((ev.clientX - r.left) / r.width * sim.W), y = Math.floor((ev.clientY - r.top) / r.height * sim.H);
      return x < 0 || y < 0 || x >= sim.W || y >= sim.H ? null : { x, y, i: y * sim.W + x };
    }

    function text(str, x, y, size, color) {
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }

    function draw(sim, t) {
      const { W, N } = sim;
      for (let i = 0; i < N; i++) {
        const x = (i % W) * cs, y = ((i / W) | 0) * cs;
        ctx.fillStyle = sim.covered[i] ? CELL[sim.type[i]] : OUTSIDE; ctx.fillRect(x, y, cs, cs);
        if (sim.type[i] === F.FLOOR && sim.walkable && !sim.walkable[i]) {
          ctx.fillStyle = '#805f44'; ctx.fillRect(x, y, cs, cs);
        }
        if (sim.fire[i]) {
          const f = 0.5 + 0.5 * Math.sin(t / 90 + i * 1.7);
          ctx.fillStyle = 'rgb(255,' + Math.round(70 + 140 * f) + ',' + Math.round(20 + 40 * f) + ')';
          ctx.fillRect(x, y, cs, cs);
        } else if (sim.smoke[i] > 0.02) {
          ctx.fillStyle = 'rgba(175,175,185,' + Math.min(0.8, sim.smoke[i] * 0.9) + ')';
          ctx.fillRect(x, y, cs, cs);
        }
      }
      for (const r of sim.L.rooms) text(r.name, (r.x + r.w / 2) * cs, (r.y + r.h / 2) * cs, cs * 1.1, 'rgba(255,255,255,.16)');
      for (const o of sim.openings) {
        if (o.kind !== 'exit') continue;
        const e = o.ref, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const open = (x, y) => x >= 0 && y >= 0 && x < W && y < sim.H && !sim.solid(y * W + x);   // label goes on the room side
        const dx = open(e.x + e.w, e.y) ? 1.7 : open(e.x - 1, e.y) ? -1.7 : 0, dy = open(e.x, e.y + e.h) ? 1.4 : open(e.x, e.y - 1) ? -1.4 : 0;
        text(e.id, (cx + dx) * cs, (cy + dy) * cs, cs * 1.05, e.locked ? '#ff8a84' : '#7dffb0');
      }
      for (const p of sim.people) {
        if (p.state === F.OUT) continue;
        const down = p.state === F.DOWN;
        ctx.fillStyle = down ? PERSON.down : sim.trapped(p) ? PERSON.trapped : PERSON.route;
        ctx.beginPath();
        ctx.arc((p.i % W + 0.5) * cs, (((p.i / W) | 0) + 0.5) * cs, cs * (down ? 0.28 : 0.38), 0, 6.283);
        ctx.fill();
      }
    }

    return { fit, cellAt, draw };
  }

  window.FireRender = { create };
})();
