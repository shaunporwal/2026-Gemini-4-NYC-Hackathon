# Architecture

## Current Fire Twin runtime

The demo entry point is `prototype/index.html`. [Launch instructions](../README.md#open-the-current-fire-twin) select the Malin preset and 3D view.

`layouts.js` supplies rectangle layouts. `app.js` owns UI state and steps `sim.js` every 0.5 simulated seconds. `render.js` and `render3d.js` read that same simulation. `gemini.js` handles media interpretation, PA text and proposed fixes.

Matched awareness replay creates two simulations with identical layout, seed and ignitions. Separate seeded randomness governs cue reception. Routing fields are shared by knowledge group, with one field for the familiar exit and another for both selected exits. Each person uses the field matching their knowledge. Queue attribution follows that person's routing field. Both runs have a 120-second observation horizon.

The TypeScript app currently uses `crowd/voxelSimulation.ts` to adapt this engine to grid maps. The modular systems and live-observation pipeline below describe the TypeScript integration design.


## Big picture

```
 Live camera feeds ──► server/ (Gemini, video+audio) ──WebSocket──► web/src/feed
                                                                      │ Observation[]
 maps/*.json ──► map/loader ──► MapModel (static) ─────────┐          ▼
                                                           ├──► SimState (per tick) ◄── user tap → ignite
                                                           │     ├─ fire/   writes fire, smoke, heat layers
                                                           │     ├─ crowd/  moves agents, reads hazards
                                                           │     └─ stats/  evac / casualties / bottlenecks
                                                           ▼
                                                     render/ (three.js voxels) + ui/
```

- **The simulation runs in the browser** (TypeScript) so it can tick at 60 fps and react
  instantly to taps.
- **The server is thin**: it owns the Gemini API key, watches the camera feeds, and pushes
  `Observation` messages to the browser over WebSocket. It never runs the simulation.
  Phones post frames and audio to it; the browser sends it camera poses when a camera is moved (`server/README.md`).
- **All cross-module types are defined in [`CONTRACTS.md`](CONTRACTS.md)** and implemented in
  `web/src/shared/types.ts`. That's the contract between teammates.

## Modules (`web/src/`)

| Folder | Responsibility | Reads | Writes |
|---|---|---|---|
| `shared/` | Types, constants, small pure helpers (index math, yaw→vector) | — | — |
| `map/` | Load + validate map JSON → `MapModel`; object catalog; camera visible-cell computation; export edited map back to JSON | map JSON | `MapModel`, `CameraState.visibleCells` |
| `render/` | three.js scene: voxel cells from the cell-type registry (InstancedMesh), people, fire/smoke overlays, agents, camera gizmos, raycast picking | `MapModel`, `SimState` | nothing in sim (emits UI events) |
| `fire/` | Fire + smoke spread model (TBD by owner) | `MapModel`, layers | `fire`, `smoke`, `heat`, `fuel` layers |
| `crowd/` | Agents, exit distance field, movement, casualties | `MapModel`, layers, observations | `agents` |
| `feed/` | WebSocket client; turns `Observation`s into agent spawn/adjust requests | server | `observations` |
| `stats/` | Evac/trapped/casualty counts, time-to-clear, bottleneck scoring, scenario compare | `SimState` | `StatsSnapshot` |
| `ui/` | HUD, buttons (start/reset/compare), map picker | everything | user intents |

**Rule:** a module only writes the state it owns (column "Writes"). Reading anything is fine.

## Static vs. dynamic state

- **`MapModel` (static, built once per map load):** `width`, `height`, `cellSize`,
  `cells: Uint8Array` (CellType code), `walkable`, `opaque`, `baseFuel`, `zoneOf: Int16Array`
  (cell → zone index or −1), `exitCells`, `people` (spawn points from `P`), `zones`, `cameras`.
- **`SimState` (mutates every tick):** typed-array layers of length `width*height`
  (`fire`, `smoke`, `heat`, `fuel`), `agents[]`, `time`, `observations`, `events`.

Typed arrays + flat index `i = y*width + x` everywhere: fast, trivially copyable for
scenario comparison (`structuredClone`), and easy to upload to the GPU for overlays.

## Tick loop (planned `web/src/main.ts`)

```
each animation frame:
  dt = fixed 1/20 s sim step (accumulate real time; run 0..N steps)
  for step:
    feed.step(map, state, dt)   // latest observations → agent adjustments (before fire starts)
    fire.step(map, state, dt)   // spread fire/smoke/heat
    crowd.step(map, state, dt)  // reroute + move agents, apply damage
    stats.step(map, state, dt)
  render.draw(state)         // interpolate, draw
```

Each system exports the same shape:

```ts
export interface SimSystem {
  init(map: MapModel, state: SimState): void;
  step(map: MapModel, state: SimState, dt: number): void;
  reset?(map: MapModel, state: SimState): void;
}
```

## Interaction
- **Tap / click** on the 3D scene → `render/` raycasts to the floor plane → cell `(x, y)` →
  emits `{ type: "ignite", x, y }` → `fire/` handles it.
- **Camera gizmos:** drag to move, rotate handle (or `Q`/`E`) to change yaw → `map/`
  recomputes `visibleCells` → render updates the cone.
- **Scenario compare:** clone `SimState` + a modified `MapModel` (e.g. extra exit), run both
  headless with the same seed, compare `StatsSnapshot`s.

## Determinism
All randomness goes through a seeded RNG passed in `SimState` (`state.rng()`), so scenario
comparisons are apples-to-apples. Never call `Math.random()` inside a sim system.
