// Use the same deterministic engine as the standalone demo. The side-effect
// import installs its browser API and is bundled by Vite in production.
import "../../../prototype/continuous.js";
import "../../../prototype/sim.js";
import { CellType, type MapModel } from "../shared/types";

interface Person {
  i: number; state: number;
  x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number; radius: number; density: number;
}
interface Engine {
  people: Person[];
  fire: Uint16Array;
  smoke: Float32Array;
  tick: number;
  seconds: number;
  substep: number;
  crowdMode: "continuous" | "tiles";
  done: boolean;
  step(): void;
  advance(): void;
  ignite(x: number, y: number): boolean;
  stats(): { active: number; out: number; down: number; trapped: number };
}
interface Opening { id: string; x: number; y: number; w: number; h: number }
interface PrototypeApi {
  Sim: new (
    layout: { width: number; height: number; rooms: never[]; doors: Opening[]; exits: Opening[] },
    options: { seed: number; crowdMode: "continuous" | "tiles"; grid: { terrain: Uint8Array; walkable: Uint8Array; cellSize: number; spawnCells: number[] } }
  ) => Engine;
  DT: number; CROWD_DT: number; ACTIVE: number; WALL: number; FLOOR: number; EXIT: number; DOOR: number;
}
export const engine = (globalThis as unknown as { FireSim: PrototypeApi }).FireSim;

/** Keep adjacent cells of one straight aperture under a single crossing plane/queue. */
function exitOpenings(map: MapModel): Opening[] {
  const remaining = new Set(map.exitCells), openings: Opening[] = [];
  for (const first of map.exitCells) {
    if (!remaining.delete(first)) continue;
    const component = [first];
    for (let cursor = 0; cursor < component.length; cursor++) {
      const i = component[cursor], x = i % map.width, y = Math.floor(i / map.width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const neighbor = ny * map.width + nx;
        if (remaining.delete(neighbor)) component.push(neighbor);
      }
    }
    const xs = component.map(i => i % map.width), ys = component.map(i => Math.floor(i / map.width));
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x + 1, h = Math.max(...ys) - y + 1;
    if (w === 1 || h === 1) {
      openings.push({ id: String(Math.min(...component)), x, y, w, h });
    } else {
      // A bent/branched marking is ambiguous. Never fill its bounding box with invented exit cells.
      for (const i of component) openings.push({ id: String(i), x: i % map.width, y: Math.floor(i / map.width), w: 1, h: 1 });
    }
  }
  return openings;
}

export function createVoxelSimulation(map: MapModel, crowdMode: "continuous" | "tiles" = "continuous") {
  const terrain = map.cells.map(code => {
    if (code === CellType.Void || code === CellType.Wall) return engine.WALL;
    if (code === CellType.Door) return engine.DOOR;
    if (code === CellType.Exit) return engine.EXIT;
    return engine.FLOOR;
  });
  const exits = exitOpenings(map);
  const spawnCells = map.people.map(p => Math.floor(p.y) * map.width + Math.floor(p.x));
  return new engine.Sim(
    { width: map.width, height: map.height, rooms: [], doors: [], exits },
    { seed: 7, crowdMode, grid: { terrain, walkable: map.walkable, cellSize: map.cellSize, spawnCells } }
  );
}
