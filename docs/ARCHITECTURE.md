# Architecture

Concept: [VISION.md](VISION.md). This doc describes **what exists in this checkout** (2026-11-21) and **the target architecture** for the live evacuation twin. Continuous pedestrian movement is part of the `ruhan/frontend` revamp; it does not change the planned live-world perception schema.

## Target

```
 phones / cameras ──► PERCEPTION (server/, Python)  ──Observations──►  LIVE WORLD (planned)
   frames, pose         Gemini: people + obstacles                      stabilised people + obstacles
                                                                         on one canonical grid
                                                                           │            │ snapshot
                                                                           ▼            ▼
   ORGANIZER VIEW (browser) ◄──── world updates, highlights, alerts ──  SIM SERVICE + AGENT (planned, Node)
   live map, camera panel,                                               engine: sim.js + continuous.js, headless
   chat with the agent,          ◄──────── chat ─────────────────────►  Gemini tool loop: run_scenario,
   scenario replay                                                       run_sweep, highlight, watch + alerts
```

| Component | Job | Runs | Status |
|---|---|---|---|
| **Perception** | Camera frames → Observations: people (individual or crowd mode, with estimates), obstacles, exit state | `server/` Python FastAPI; owns the Gemini key | **Built** for people (room and grid modes, continuous counts). Obstacles: **planned** (prototype photo flow only). Crowd mode with estimates: **planned** |
| **Live world** | Merges Observations into one stable world: map + obstacles + exit state + people; produces snapshots | Planned: inside the server or the sim service (open) | **Planned** |
| **Simulation engine** | Deterministic fire/smoke and continuous pedestrians; dedicated crowd-surge and danger-zone scenarios remain planned | `prototype/sim.js` + `continuous.js` (plain JS; browser and Node) | **Built** for continuous steering, contacts, fire, smoke, routing, queues and locked exits; contacts are not a validated crush model |
| **Sim service** | Runs scenarios and sweeps headless on snapshots, in parallel, in milliseconds | Planned: **Node**, next to the server | **Planned** (`sim.run()` already works headless in Node) |
| **Agent** | Gemini tool-use loop: answers questions by running scenarios and sweeps, highlights results, background watch and alerts | Planned: in the Node sim service (key server-side) | **Planned** ([AGENT.md](AGENT.md)) |
| **Organizer view** | Live map, camera panel, agent chat, highlights, alerts, scenario replay | Browser | Two frontends exist today (below). Chat, highlights and alerts: **planned** |

## What exists today

### Two frontends, two world formats
| | `prototype/` (team demo, decision #28 on `main`) | `web/` (grid twin) |
|---|---|---|
| Tech | Plain JS, no build, opened from disk or a static server | Vite + TypeScript + three.js |
| World format | **Room rectangles** (`rooms`, `doors`, `exits`, people per room; 1 m cells; ≤ 120×80) | **Grid v2** (one character per cell, 0.5 m default, any size; posed cameras) |
| Simulation | `sim.js` + `continuous.js`; optional legacy tile baseline | The same engine, adapted to the grid (`web/src/crowd/voxelSimulation.ts`) |
| Views | 2D canvas + 3D voxel (`render3d.js`) | 3D voxel (`web/src/render/scene.ts`) |
| Live cameras | Room mode: a head count per room, applied with `applyObservation`; Freeze; a "live only" switch (only people and furniture phones have seen); side-by-side camera-informed vs plan-only twin | Grid mode feeds per-cell positions from the server; no live-feed UI in `web/` yet (planned) |
| Gemini in the browser | Yes (Setup key): floor plan → twin, room photo → update, PA text, Find fix | No (key only on the server) |

### Perception server (`server/`, on `main`)
- **Room mode (default)**: loads a prototype layout (`VENUE=malin`); each phone picks its room;
  Observations carry `room`, `peopleCount` and exit ids. **Grid mode**: `MAP=` a v2 map; posed cameras;
  `people` floor positions in cells.
- Decisions API every frame (people present, count range, crowding, fire/smoke, exit blocked) +
  Hydrogen re-counts in the background (~3 s, or when the count range changes); audio alarm detection.
- Phones send where they stand and face; a debug view; WebSocket `/ws` and `GET /observations`.

## Data flow (target)
1. A phone posts frames → perception → an **Observation** per camera (people with kind seen / hidden /
   beyond, obstacles with cells + label + confidence, exit state, Gemini's raw answer, stream health).
2. The **live world** stabilises Observations (persistence, matching, consistent-sighting rule for
   obstacles; [LIVE_WORLD.md](LIVE_WORLD.md)) and pushes world updates to the organizer view.
3. On a question or a background tick, the **agent** takes a **snapshot** and calls the sim service:
   `run_scenario` / `run_sweep` ([SCENARIOS.md](SCENARIOS.md)). The results include casualties and replay ids.
4. The agent answers in the chat, calls `highlight_on_map`, and raises alerts. The view can **replay** any
   scenario from its snapshot.

## Conventions
- Grid: `x` = column, `y` = row, in cells; heights in metres; flat index `i = y * width + x`; yaw in compass
  degrees (0 = north = −y). Details: [MAP_SCHEMA.md](MAP_SCHEMA.md).
- Determinism: all randomness is seeded. Same snapshot + movement model + parameters + precise event schedule + seed = same result. Playback speed does not change fixed-step results.
- Whole people, fractional cell positions. Continuous simulated bodies can share a cell when they fit; default physical radius is 0.22 m. A placement shortfall is reported. The proposed live-estimation format still uses one tracked person per cell; that representation is not a simulation collision rule. Estimated people stay labelled.
- Continuous crowd: 30 Hz; fire/smoke: 0.5 s updates, unchanged per-cell coefficients. Both frontends convert body size and speed using `cellSize`. Ordinary continuous runs use a 120-second horizon, with elapsed time separate from last exit time. Contact/density are illustrative, not calibrated crush risk.
- The Gemini key lives on the server. The prototype's browser key is an existing exception (see Open decisions).

## Open decisions (for the team)
| # | Question | Options |
|---|---|---|
| A | **Canonical world format** for the live world | Grid v2 (cell-level people, posed cameras, any size; needs the prototype UI ported or converted) · room rectangles (team demo today; only room-level counts, no positions) · grid as canonical with a rooms → grid converter |
| B | **Organizer frontend** | Extend `prototype/` (team demo) · extend `web/` · merge into one |
| C | **Where the live world lives** | Python server (next to perception) · Node sim service (next to the agent) |
| D | **Agent model** | Hydrogen (fast) · Neon or Carbon (stronger planning and explanation) |
| E | **Gemini calls from the browser** (prototype Setup key) | Keep for the prototype features · move all calls to the server |
