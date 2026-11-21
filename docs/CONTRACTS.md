# Contracts: shared types between modules

This is **the contract between teammates**. When the web app is set up, this block is copied
as-is into `web/src/shared/types.ts`, and every module imports its cross-module types from there.

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

export type CellTypeName = "wall" | "floor" | "door" | "exit" | "void";

export type ObjectType =
  | "table"
  | "chair"
  | "bar"
  | "stage"
  | "seating"
  | "shelf"
  | "obstacle";

export interface MapObjectDef {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  height?: number; // metres, overrides catalog default
  blocksMovement?: boolean; // overrides catalog default
  fuel?: number; // 0..1, overrides catalog default (fire model)
}

export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraDef {
  id: string;
  name: string;
  x: number; // cells (float)
  y: number; // cells (float)
  height: number; // metres
  yaw: number; // compass degrees
  pitch: number; // degrees, negative = down
  fov: number; // horizontal degrees
  range: number; // cells
}

export interface MapFile {
  version: 1;
  name: string;
  cellSize?: number; // metres per cell, default 0.5
  wallHeight?: number; // metres, default 3
  legend?: Record<string, CellTypeName>;
  rows: string[];
  objects?: MapObjectDef[];
  zones?: ZoneDef[];
  cameras?: CameraDef[];
}

// ───────────────────────── Runtime map (static) ─────────────────────────

/** Numeric cell codes stored in MapModel.cells. (Plain object, not const enum — Vite/esbuild-safe.) */
export const CellType = {
  Void: 0,
  Floor: 1,
  Wall: 2,
  Door: 3,
  Exit: 4,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export interface CameraState extends CameraDef {
  /** Flat indices of walkable cells inside the view cone with line of sight. */
  visibleCells: Uint32Array;
}

export interface MapModel {
  name: string;
  width: number;
  height: number;
  cellSize: number;
  wallHeight: number;
  /** CellType per cell (structure only, from `rows`). */
  cells: Uint8Array;
  /** 1 if agents can stand here (structure + objects applied). */
  walkable: Uint8Array;
  /** Base fuel per cell 0..1 (floor default + objects). Fire module may reinterpret. */
  baseFuel: Float32Array;
  /** Zone index per cell, -1 if none. */
  zoneOf: Int16Array;
  objects: MapObjectDef[];
  zones: ZoneDef[];
  cameras: CameraState[];
  exitCells: Uint32Array;
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

/** Message from the Gemini feed (server → browser). DRAFT — owned by the feed teammate. */
export interface Observation {
  cameraId: string;
  timestamp: number; // ms epoch
  peopleCount: number;
  density?: "empty" | "sparse" | "moderate" | "crowded" | "packed";
  events?: string[]; // e.g. "smoke", "alarm", "screaming"
  summary?: string; // free-text scene description
}

export type SimEvent =
  | { type: "ignite"; x: number; y: number }
  | { type: "reset" };

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
  events: SimEvent[]; // queued this frame, consumed by systems
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
  /** Cell index → congestion score, for doors/corridors. */
  bottlenecks: { cell: number; score: number }[];
}
```

## Who owns which type
| Type | Owner |
|---|---|
| `MapFile`, `MapObjectDef`, `ZoneDef`, `CameraDef`, `MapModel`, `CameraState`, `CellType` | map |
| `SimState` layers `fire`, `smoke`, `heat`, `fuel` | fire |
| `Agent`, `SimState.agents` | crowd |
| `Observation` (**DRAFT**) | feed / server |
| `StatsSnapshot` | stats |
| `SimSystem`, `SimEvent`, the rest of `SimState` | everyone (announce changes) |
