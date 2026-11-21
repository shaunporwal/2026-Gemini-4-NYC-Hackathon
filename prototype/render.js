/* Canvas view of a Sim. Reads sim state only; never changes it. */
(function () {
  'use strict';
  const F = window.FireSim;
  const CELL = { [F.FLOOR]: '#171b22', [F.WALL]: '#465064', [F.LOCKED]: '#d0342c', [F.DOOR]: '#222a36', [F.EXIT]: '#2ecc71' };
  const OUTSIDE = '#1c2420', FURNITURE = '#7a5a3a';
  const PERSON = { route: '#5ad1ff', trapped: '#ff4fd8', down: '#8a2626', fallen: '#ffb020' };
  const HEAT = { lost: [255, 79, 79], falls: [255, 176, 32] };   // risk map: where people were lost, where they fell
  const LABEL = { px: 11, minPx: 9, color: '#e6e9ee', halo: 'rgba(12,15,20,.9)', pad: 4, font: 'px system-ui, -apple-system, sans-serif' };
  const EXIT_PX = 11;
  const MARK = { ms: 2500, px: 3, color: '#7cc4ff' };
  const PHONE = { reach: 6, spread: 0.85, dot: '#ffffff', cone: 'rgba(124,196,255,.3)' };   // reach in cells, spread in radians each side

  /* Words of a room name that fit a box: full name on 1 or 2 lines, else its short form.
   * Short form = the text in brackets ("Bricken Office (10)" -> "10"), else the first word. */
  function fitLabel(ctx, name, maxW, maxLines) {
    const fits = t => ctx.measureText(t).width <= maxW;
    if (fits(name)) return [name];
    const words = name.split(' ');
    if (maxLines > 1) for (let k = words.length - 1; k > 0; k--) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      if (fits(a) && fits(b)) return [a, b];
    }
    const short = (name.match(/\(([^)]+)\)/) || [])[1] || words[0];
    return fits(short) ? [short] : [];
  }

  function create(canvas, wrap) {
    const ctx = canvas.getContext('2d');
    const crowd = window.CrowdVisual.create();
    let cs = 12;   // cell size, device px
    let dpr = 1, shown = null;

    /* Whole device pixels per cell: sharp edges and text on a high-density screen. */
    function fit(sim) {
      dpr = window.devicePixelRatio || 1;
      cs = Math.max(2, Math.floor(Math.min(wrap.clientWidth * dpr / sim.W, wrap.clientHeight * dpr / sim.H)));
      canvas.width = sim.W * cs; canvas.height = sim.H * cs;
      canvas.style.width = canvas.width / dpr + 'px'; canvas.style.height = canvas.height / dpr + 'px';
    }

    /* Hover: the full room name and head count (small rooms show a short label only). */
    canvas.addEventListener('mousemove', ev => {
      const c = shown && cellAt(shown, ev), room = c && shown.roomOf[c.i] >= 0 ? shown.L.rooms[shown.roomOf[c.i]] : null;
      canvas.title = room ? room.name + ' · ' + room.people + ' people' : '';
    });

    function cellAt(sim, ev) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((ev.clientX - r.left) / r.width * sim.W), y = Math.floor((ev.clientY - r.top) / r.height * sim.H);
      return x < 0 || y < 0 || x >= sim.W || y >= sim.H ? null : { x, y, i: y * sim.W + x };
    }

    /* Text with a dark halo, so it reads on floor, smoke and fire. */
    function text(str, x, y, size, color) {
      ctx.font = '600 ' + size + LABEL.font;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 3.5); ctx.strokeStyle = LABEL.halo;
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }

    function roomLabels(sim) {
      for (const r of sim.L.rooms) {
        const w = (r.w - 2) * cs - LABEL.pad * dpr, h = (r.h - 2) * cs;
        for (const px of [LABEL.px, LABEL.minPx]) {
          const size = px * dpr, line = size * 1.15;
          ctx.font = '600 ' + size + LABEL.font;
          const lines = fitLabel(ctx, r.name, w, Math.floor(h / line));
          if (!lines.length || h < line) continue;
          const y0 = (r.y + r.h / 2) * cs - (lines.length - 1) * line / 2;
          lines.forEach((t, k) => text(t, (r.x + r.w / 2) * cs, y0 + k * line, size, LABEL.color));
          break;
        }
      }
    }

    /* A room that a phone just reported: a ring that fades. marks = Map(room name -> time). */
    function flash(sim, t, marks) {
      if (!marks) return;
      for (const r of sim.L.rooms) {
        const age = t - (marks.has(r.name) ? marks.get(r.name) : -Infinity);
        if (age < 0 || age > MARK.ms) continue;
        ctx.globalAlpha = 1 - age / MARK.ms;
        ctx.strokeStyle = MARK.color; ctx.lineWidth = MARK.px * dpr;
        ctx.strokeRect(r.x * cs, r.y * cs, r.w * cs, r.h * cs);
        ctx.globalAlpha = 1;
      }
    }

    /* Where each phone stands and looks (from the phone's own room map): a dot and its field of view. */
    function phones(list) {
      for (const p of list || []) {
        const a = p.yaw * Math.PI / 180, ray = d => [(p.x + Math.sin(a + d) * PHONE.reach) * cs, (p.y - Math.cos(a + d) * PHONE.reach) * cs];
        ctx.fillStyle = PHONE.cone;
        ctx.beginPath(); ctx.moveTo(p.x * cs, p.y * cs); ctx.lineTo(...ray(-PHONE.spread)); ctx.lineTo(...ray(PHONE.spread)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PHONE.dot;
        ctx.beginPath(); ctx.arc(p.x * cs, p.y * cs, cs * 0.6, 0, 6.283); ctx.fill();
      }
    }

    /* Risk map (Advisor): heat = {lost, falls, runs} per cell, summed over many runs. Brighter = more often. */
    function riskOverlay(sim, heat) {
      for (const [key, rgb] of [['lost', HEAT.lost], ['falls', HEAT.falls]]) {
        const h = heat[key]; let max = 0;
        for (let i = 0; i < sim.N; i++) if (h[i] > max) max = h[i];
        if (!max) continue;
        for (let i = 0; i < sim.N; i++) {
          if (!h[i]) continue;
          ctx.fillStyle = 'rgba(' + rgb.join(',') + ',' + (0.35 + 0.65 * Math.sqrt(h[i] / max)).toFixed(2) + ')';
          ctx.fillRect((i % sim.W) * cs, ((i / sim.W) | 0) * cs, cs, cs);
        }
      }
    }

    function draw(sim, t, extra) {
      const marks = extra && extra.marks;
      const { W, N } = sim;
      for (let i = 0; i < N; i++) {
        const x = (i % W) * cs, y = ((i / W) | 0) * cs;
        const blocked = sim.furn[i] || (sim.type[i] === F.FLOOR && sim.walkable && !sim.walkable[i]);   // furniture, or a blocked voxel of a grid map
        ctx.fillStyle = !sim.covered[i] ? OUTSIDE : blocked ? FURNITURE : CELL[sim.type[i]]; ctx.fillRect(x, y, cs, cs);
        if (sim.fire[i]) {
          const f = 0.5 + 0.5 * Math.sin(t / 90 + i * 1.7);
          ctx.fillStyle = 'rgb(255,' + Math.round(70 + 140 * f) + ',' + Math.round(20 + 40 * f) + ')';
          ctx.fillRect(x, y, cs, cs);
        } else if (sim.smoke[i] > 0.02) {
          ctx.fillStyle = 'rgba(175,175,185,' + Math.min(0.8, sim.smoke[i] * 0.9) + ')';
          ctx.fillRect(x, y, cs, cs);
        }
      }
      shown = sim;
      if (extra && extra.heat) riskOverlay(sim, extra.heat);
      const visual = crowd.update(sim, t, extra || {});
      if (extra?.congestion) {
        for (let i = 0; i < N; i++) {
          const count = visual.crowding[i], waiting = visual.queued[i];
          if (!sim.covered[i] || sim.solid(i) || sim.fire[i] || (count < 3 && !waiting)) continue;
          ctx.fillStyle = waiting >= 2 || count >= 6 ? '#df766799' : count >= 4 ? '#e5a56c88' : '#dbca7966';
          ctx.fillRect(i % W * cs, Math.floor(i / W) * cs, cs, cs);
        }
      }
      const tracked = sim.openings[extra?.tracked];
      if (tracked) {
        const o = tracked.ref;
        ctx.strokeStyle = '#f2ad70'; ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(o.x * cs - 2, o.y * cs - 2, o.w * cs + 4, o.h * cs + 4);
      }
      for (const o of sim.openings) {
        if (o.kind !== 'exit') continue;
        const e = o.ref, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const open = (x, y) => x >= 0 && y >= 0 && x < W && y < sim.H && !sim.solid(y * W + x);   // label goes on the room side
        const dx = open(e.x + e.w, e.y) ? 1.7 : open(e.x - 1, e.y) ? -1.7 : 0, dy = open(e.x, e.y + e.h) ? 1.4 : open(e.x, e.y - 1) ? -1.4 : 0;
        text(e.id, (cx + dx) * cs, (cy + dy) * cs, Math.max(EXIT_PX * dpr, cs), e.locked ? '#ff8a84' : '#7dffb0');
      }
      sim.people.forEach((p, index) => {
        if (p.state === F.OUT || (extra && extra.heat)) return;   // the risk map hides people
        const down = p.state === F.DOWN || p.state === F.INJURED, track = visual.tracks[index];
        ctx.save();
        ctx.translate((track.x + 0.5) * cs, (track.y + 0.5) * cs);
        ctx.rotate(-track.heading);
        ctx.fillStyle = p.state === F.INJURED ? PERSON.fallen : down ? PERSON.down : p.queueOpening >= 0 ? '#e99f60' : sim.trapped(p) ? PERSON.trapped : '#77b5b0';
        ctx.beginPath(); ctx.ellipse(0, 0, cs * 0.32, cs * 0.23, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.knowsSecond ? '#c4a0ff' : '#f2c697';
        ctx.beginPath(); ctx.arc(0, cs * 0.09, cs * 0.17, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      phones(extra && extra.phones);
      flash(sim, t, marks);
      roomLabels(sim);
    }

    return { fit, cellAt, draw };
  }

  window.FireRender = { create };
})();
