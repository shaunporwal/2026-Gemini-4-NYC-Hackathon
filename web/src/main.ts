import { fetchMap } from "./map/loader";
import { VoxelScene } from "./render/scene";
import { CellType } from "./shared/types";
import { createVoxelSimulation, engine } from "./crowd/voxelSimulation";

const CODE_NAME = Object.fromEntries(Object.entries(CellType).map(([k, v]) => [v, k.toLowerCase()]));

async function boot() {
  const mapUrl = new URLSearchParams(location.search).get("map") ?? "/maps/demo-hall.json";
  const { model: map } = await fetchMap(mapUrl);
  const view = new VoxelScene(document.getElementById("app")!, map);
  const hud = document.getElementById("hud")!;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const start = button("start"), pause = button("pause"), reset = button("reset"), replay = button("replay");
  let sim = createVoxelSimulation(map);
  let origin: { x: number; y: number } | null = null;
  let running = false;
  let lastTime = performance.now(), elapsed = 0;
  let inspection = "";

  function sync() {
    const active = sim.people.filter(p => p.state === engine.ACTIVE);
    view.setPeople(active.map(p => ({ x: p.i % map.width + 0.5, y: Math.floor(p.i / map.width) + 0.5 })));
    view.setHazards(sim.fire, sim.smoke);
    const stats = sim.stats();
    const status = sim.done ? "Finished" : running ? "Running" : origin ? "Paused" : "Ready";
    hud.textContent = [
      map.name + " · " + status + " · " + (sim.tick * engine.DT).toFixed(1) + " s",
      "Inside " + stats.active + "  ·  Out " + stats.out + "  ·  No route " + stats.trapped + "  ·  Down (model) " + stats.down,
      inspection || (origin ? "Orange = fire · Grey = smoke" : "Click a floor cell to ignite. Drag to orbit."),
    ].join("\n");
    start.disabled = !!origin || !map.cells.includes(CellType.Floor);
    pause.disabled = !origin || sim.done;
    pause.textContent = origin && !running && !sim.done ? "Resume" : "Pause";
    reset.disabled = replay.disabled = !origin;
  }

  function ignite(x: number, y: number) {
    if (origin || !sim.ignite(x, y)) return false;
    origin = { x, y };
    running = true;
    lastTime = performance.now();
    elapsed = 0;
    return true;
  }

  start.onclick = () => {
    // Choose an ordinary floor cell near the centre for a repeatable demonstration.
    let best = -1, distance = Infinity;
    map.cells.forEach((code, i) => {
      if (code !== CellType.Floor || sim.people.some(p => p.i === i)) return;
      const d = Math.hypot(i % map.width - map.width / 2, Math.floor(i / map.width) - map.height / 2);
      if (d < distance) { best = i; distance = d; }
    });
    if (best < 0) best = map.cells.indexOf(CellType.Floor);
    if (best >= 0) ignite(best % map.width, Math.floor(best / map.width));
    inspection = "";
    sync();
  };
  pause.onclick = () => { running = !running; lastTime = performance.now(); sync(); };
  function restart(repeat: boolean) {
    const previous = origin;
    sim = createVoxelSimulation(map);
    origin = null;
    running = false;
    elapsed = 0;
    inspection = "";
    if (repeat && previous) ignite(previous.x, previous.y);
    sync();
  }
  replay.onclick = () => restart(true);
  reset.onclick = () => restart(false);

  let down = { x: 0, y: 0 };
  const el = view.renderer.domElement;
  el.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener("pointerup", e => {
    if (e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const c = view.pickCell(e.clientX, e.clientY);
    if (!c) return;
    const i = c.y * map.width + c.x;
    const zone = map.zones[map.zoneOf[i]]?.name ?? "outside zones";
    const seen = map.cameras.filter(cam => cam.visibleCells.includes(i)).map(cam => cam.id);
    inspection = "(" + c.x + ", " + c.y + ") " + CODE_NAME[map.cells[i]] + " · " + zone + " · Cameras: " + (seen.join(", ") || "none");
    if (map.cells[i] === CellType.Floor || map.cells[i] === CellType.Table || map.cells[i] === CellType.Chair) ignite(c.x, c.y);
    sync();
  });

  function frame(now: number) {
    if (running) {
      elapsed += Math.min(0.25, (now - lastTime) / 1000);
      if (elapsed >= engine.DT) {
        sim.step();
        elapsed -= engine.DT;
        if (sim.done) running = false;
        sync();
      }
    }
    lastTime = now;
    view.draw();
    requestAnimationFrame(frame);
  }
  sync();
  requestAnimationFrame(frame);
}

boot().catch((err) => { console.error(err); document.getElementById("hud")!.textContent = String(err.message ?? err); });
