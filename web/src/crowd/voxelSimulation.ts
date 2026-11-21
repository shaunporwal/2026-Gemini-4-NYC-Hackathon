// Use the same deterministic engine as the standalone demo. The side-effect
// import installs its browser API and is bundled by Vite in production.
import "../../../prototype/sim.js";
import { CellType, type MapModel } from "../shared/types";

interface Person { i: number; state: number }
interface Engine {
  people: Person[];
  fire: Uint16Array;
  smoke: Float32Array;
  tick: number;
  done: boolean;
  step(): void;
  ignite(x: number, y: number): boolean;
  stats(): { active: number; out: number; down: number; trapped: number };
}
interface Opening { id: string; x: number; y: number; w: number; h: number }
interface PrototypeApi {
  Sim: new (
    layout: { width: number; height: number; rooms: never[]; doors: Opening[]; exits: Opening[] },
    options: { seed: number; grid: { terrain: Uint8Array; walkable: Uint8Array; cellSize: number; spawnCells: number[] } }
  ) => Engine;
  DT: number; ACTIVE: number; WALL: number; FLOOR: number; EXIT: number; DOOR: number;
}
export const engine = (globalThis as unknown as { FireSim: PrototypeApi }).FireSim;

export function createVoxelSimulation(map: MapModel) {
  const terrain = map.cells.map(code => {
    if (code === CellType.Void || code === CellType.Wall) return engine.WALL;
    if (code === CellType.Door) return engine.DOOR;
    if (code === CellType.Exit) return engine.EXIT;
    return engine.FLOOR;
  });
  const exits = Array.from(map.exitCells, i => ({
    id: String(i), x: i % map.width, y: Math.floor(i / map.width), w: 1, h: 1,
  }));
  const spawnCells = map.people.map(p => Math.floor(p.y) * map.width + Math.floor(p.x));
  return new engine.Sim(
    { width: map.width, height: map.height, rooms: [], doors: [], exits },
    { seed: 7, grid: { terrain, walkable: map.walkable, cellSize: map.cellSize, spawnCells } }
  );
}
