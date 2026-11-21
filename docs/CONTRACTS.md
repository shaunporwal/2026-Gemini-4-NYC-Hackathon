# Contracts: shared types between modules

These contracts govern the TypeScript grid-map and backend integration. See [the current Fire Twin demo guide](../prototype/README.md) for launching the Malin scene and matched awareness replay.


This is **the contract between teammates**. It mirrors `web/src/shared/types.ts`, the file every
module imports its cross-module types from. Keep the two identical.

**Changing a contract:** update this doc, the TypeScript file, and any related doc
(`MAP_SCHEMA.md`, `ARCHITECTURE.md`) in the same commit, then tell the team.
Types marked **DRAFT** belong to the module owner, who finalises them.

## Conventions
- `x` = column, `y` = row, in **cells**, with the origin at the top-left. Flat index `i = y * width + x`.
- Heights are in **metres**. Yaw is in compass degrees: 0 = north (−y), 90 = east (+x).
- Per-cell data is stored in **typed arrays** of length `width * height`.
- All randomness in the simulation goes through `state.rng()` (seeded).

## Type definitions

```ts
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

/**
 * Message from the Gemini feed (server → browser), one per camera per processed frame.
 * Owned by the feed/server teammate. Wire format and producer: server/README.md.
 */
export interface Observation {
  cameraId: string; // a CameraDef.id from the map, or a room id (slug of the room name) in room mode
  room?: string; // room mode: the room name in the prototype layout this phone is in
  timestamp: number; // ms epoch, when the frame arrived
  peopleCount: number; // Decisions' fast estimate within ~1 s of a change, then Hydrogen's exact count
  density?: "empty" | "sparse" | "moderate" | "crowded" | "packed"; // Decisions, every frame
  events?: string[]; // any of "fire", "smoke", "exit_blocked", "alarm", "screaming"
  summary?: string; // one-line scene description (Hydrogen); never identifies people
  /**
   * Estimated floor positions (cells, float), projected from foot points with the camera pose.
   * Approximate: they can land on a wall or table cell, so snap to the nearest walkable cell.
   * Empty for a camera that isn't in the map.
   */
  people?: { x: number; y: number }[];
  /** Fire or smoke seen on this camera (debounced over consecutive frames). */
  hazards?: { type: "fire" | "smoke"; confidence: number }[];
  /** Each exit this camera sees: its cells (flat indices) and whether it looks blocked. Room mode adds the exit id. */
  exits?: { id?: string; cells: number[]; blocked: boolean; p: number }[];
  /** Health of the camera stream, for the UI. */
  stream?: {
    ok: boolean;
    latencyMs: number | null;
    lastFrame: number | null; // s epoch
    frames: number;
    decisionCalls: number;
    hydrogenCalls: number;
    audioCalls: number;
    error: string | null;
  };
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
```

## Who owns which type
| Type | Owner |
|---|---|
| `MapFile`, `MapDimensions`, `CellTypeName`, `ZoneDef`, `CameraDef`, `MapModel`, `CameraState`, `PersonSpawn`, `CellType` | map |
| `SimState` layers `fire`, `smoke`, `heat`, `fuel` | fire |
| `Agent`, `SimState.agents` | crowd |
| `Observation` | feed / server |
| `StatsSnapshot` | stats |
| `SimSystem`, `SimEvent`, the rest of `SimState` | everyone (announce changes) |
