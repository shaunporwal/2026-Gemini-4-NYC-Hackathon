import { fetchMap } from "./map/loader";
import { VoxelScene } from "./render/scene";
import { CellType } from "./shared/types";

const CODE_NAME = Object.fromEntries(Object.entries(CellType).map(([k, v]) => [v, k.toLowerCase()]));

async function boot() {
  const mapUrl = new URLSearchParams(location.search).get("map") ?? "/maps/demo-hall.json";
  const { model: map } = await fetchMap(mapUrl);
  const view = new VoxelScene(document.getElementById("app")!, map);
  const hud = document.getElementById("hud")!;
  const summary =
    `${map.name}  ·  ${map.width}×${map.height} cells (${map.width * map.cellSize}×${map.height * map.cellSize} m)\n` +
    `${map.people.length} people  ·  ${map.exitCells.length} exit cells  ·  ${map.cameras.length} cameras`;
  hud.textContent = summary + "\nclick a cell to inspect";

  // Click (not drag) → inspect cell. Fire ignition hooks in here later.
  let down = { x: 0, y: 0 };
  const el = view.renderer.domElement;
  el.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  el.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const c = view.pickCell(e.clientX, e.clientY);
    if (!c) return;
    const i = c.y * map.width + c.x;
    const zone = map.zoneOf[i] >= 0 ? map.zones[map.zoneOf[i]].name : "none";
    const seenBy = map.cameras.filter((cam) => cam.visibleCells.includes(i)).map((cam) => cam.id);
    hud.textContent =
      summary +
      `\ncell (${c.x}, ${c.y}): ${CODE_NAME[map.cells[i]]}, walkable=${!!map.walkable[i]}, zone=${zone}` +
      `\nseen by: ${seenBy.join(", ") || "no camera"}`;
  });

  const frame = () => {
    view.draw();
    requestAnimationFrame(frame);
  };
  frame();
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("hud")!.textContent = String(err.message ?? err);
});
