/**
 * SHARED CONTRACT. Mirrors docs/CONTRACTS.md; keep both in sync and announce changes.
 *
 * Coordinates: x = column, y = row (cells), origin top-left. Flat index i = y * width + x.
 * Yaw: compass degrees, 0 = north (-y), 90 = east (+x). Heights in metres.
 */

// ───────────────────────── Map JSON (on disk) ─────────────────────────

/** Every kind of thing a grid character can stand for. Registry: web/src/map/cellTypes.ts */
export type CellTypeName = "void" | "floor" | "wall" | "door" | "exit" | "table" | "chair" | "person";

export interface CameraDef {
  id: string;
  name: string;
  /** x, y in cells (float) on the plan; z = mounting height in metres. */
  position: { x: number; y: number; z: number };
  /** yaw: compass degrees (0 = north = -y, 90 = east). pitch: degrees, negative = down. */
  orientation: { yaw: number; pitch: number };
  /** fov: horizontal degrees. range: max view distance in cells. */
  lens: { fov: number; range: number };
}

export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapDimensions {
  width: number; // cells (columns); every row must have exactly this many characters
  height: number; // cells (rows); rows.length must equal this
  cellSize?: number; // metres per cell, default 0.5
  wallHeight?: number; // metres, default 3
}

export interface MapFile {
  version: 2;
  name: string;
  dimensions: MapDimensions;
  /** Extra/overriding characters, e.g. { "B": "table" }. Merged over the default legend. */
  legend?: Record<string, CellTypeName>;
  /** The grid. One character per cell; must match dimensions exactly. */
  rows: string[];
  zones?: ZoneDef[];
  cameras?: CameraDef[];
}

// ───────────────────────── Runtime map (static) ─────────────────────────

/**
 * Numeric code stored per cell in MapModel.cells. "person" is NOT a cell code: a person
 * character becomes a Floor cell plus an entry in MapModel.people.
 */
export const CellType = {
  Void: 0,
  Floor: 1,
  Wall: 2,
  Door: 3,
  Exit: 4,
  Table: 5,
  Chair: 6,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export interface CameraState extends CameraDef {
  /** Flat indices of walkable cells inside the view cone with line of sight. */
  visibleCells: Uint32Array;
}

export interface PersonSpawn {
  id: number;
  x: number; // cell centre, cells (float)
  y: number;
}

export interface MapModel {
  name: string;
  width: number;
  height: number;
  cellSize: number;
  wallHeight: number;
  /** CellType per cell. */
  cells: Uint8Array;
  /** 1 if agents can stand/move here. */
  walkable: Uint8Array;
  /** 1 if the cell blocks camera line of sight. */
  opaque: Uint8Array;
  /** Base fuel per cell 0..1. Fire module may reinterpret. */
  baseFuel: Float32Array;
  /** Zone index per cell, -1 if none. */
  zoneOf: Int16Array;
  zones: ZoneDef[];
  cameras: CameraState[];
  exitCells: Uint32Array;
  /** Initial people placed in the grid with the person character. */
  people: PersonSpawn[];
}

// ───────────────────────── Simulation state (dynamic) ─────────────────────────

export type AgentStatus = "active" | "evacuated" | "casualty";

export interface Agent {
  id: number;
  x: number; // cells (float)
  y: number;
  vx: number;
  vy: number;
  health: number; // 0..1
  status: AgentStatus;
  /** Camera that spawned this agent, if any (for reconciling live counts). */
  sourceCameraId?: string;
}

/** Message from the Gemini feed (server → browser). DRAFT, owned by the feed teammate. */
export interface Observation {
  cameraId: string;
  timestamp: number; // ms epoch
  peopleCount: number;
  density?: "empty" | "sparse" | "moderate" | "crowded" | "packed";
  events?: string[]; // e.g. "smoke", "alarm", "screaming"
  summary?: string; // free-text scene description
}

export type SimEvent = { type: "ignite"; x: number; y: number } | { type: "reset" };

export interface SimState {
  time: number; // seconds since sim start
  running: boolean;
  rng: () => number; // seeded; never use Math.random() in sim code
  fire: Float32Array; // 0..1 intensity
  smoke: Float32Array; // 0..1 density
  heat: Float32Array; // arbitrary units, owner-defined
  fuel: Float32Array; // remaining fuel 0..1
  agents: Agent[];
  observations: Map<string, Observation>; // latest per cameraId
  events: SimEvent[]; // queued this step, consumed by systems
}

export interface SimSystem {
  init(map: MapModel, state: SimState): void;
  step(map: MapModel, state: SimState, dt: number): void;
  reset?(map: MapModel, state: SimState): void;
}

// ───────────────────────── Stats ─────────────────────────

export interface StatsSnapshot {
  time: number;
  total: number;
  active: number;
  evacuated: number;
  casualties: number;
  trapped: number; // active agents with no reachable exit
  timeToClear: number | null; // seconds, null until all non-casualties evacuated
  bottlenecks: { cell: number; score: number }[]; // cell index → congestion score
}
