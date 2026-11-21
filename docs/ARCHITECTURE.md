# Architecture

Concept: [VISION.md](VISION.md). This doc describes **what exists today** (checked against `main`,
2026-11-21) and **the target architecture** for the live evacuation twin.

## Target

```
 phones / cameras ──► PERCEPTION (server/, Python)  ──Observations──►  LIVE WORLD (planned)
   frames, pose         Gemini: people + obstacles                      stabilised people + obstacles
                                                                         on one canonical grid
                                                                           │            │ snapshot
                                                                           ▼            ▼
   ORGANIZER VIEW (browser) ◄──── world updates, highlights, alerts ──  SIM SERVICE + AGENT (planned, Node)
   live map, camera panel,                                               engine: prototype/sim.js, headless
   chat with the agent,          ◄──────── chat ─────────────────────►  Gemini tool loop: run_scenario,
   scenario replay                                                       run_sweep, highlight, watch + alerts
```

| Component | Job | Runs | Status |
|---|---|---|---|
| **Perception** | Camera frames → Observations: people (individual or crowd mode, with estimates), obstacles, exit state | `server/` Python FastAPI; owns the Gemini key | **Built** for people (room and grid modes, continuous counts). Obstacles: **planned** (prototype photo flow only). Crowd mode with estimates: **on Jacob's `jacob/camera-feed` branch (not merged, not yet on GitHub)** |
| **Live world** | Merges Observations into one stable world: map + obstacles + exit state + people; produces snapshots | Planned: inside the server or the sim service (open) | **Planned** |
| **Simulation engine** | Deterministic events on a world: fire + smoke today; crowd surge, blocked exits and danger zones planned | `prototype/sim.js` (plain JS; browser and Node) | **Built** for fire, smoke, routing, queues and locked exits |
| **Sim service** | Runs scenarios and sweeps headless on snapshots, in parallel, in milliseconds | Planned: **Node**, next to the server | **Planned** (`sim.run()` already works headless in Node) |
| **Agent** | Gemini tool-use loop: answers questions by running scenarios and sweeps, highlights results, background watch and alerts | Planned: in the Node sim service (key server-side) | **Planned** ([AGENT.md](AGENT.md)) |
| **Organizer view** | Live map, camera panel, agent chat, highlights, alerts, scenario replay | Browser | Two frontends exist today (below). Chat, highlights and alerts: **planned** |

## What exists today

### Two frontends, two world formats
| | `prototype/` (team demo, decision #28 on `main`) | `web/` (grid twin) |
|---|---|---|
| Tech | Plain JS, no build, opened from disk or a static server | Vite + TypeScript + three.js |
| World format | **Room rectangles** (`rooms`, `doors`, `exits`, people per room; 1 m cells; ≤ 120×80) | **Grid v2** (one character per cell, 0.5 m default, any size; posed cameras) |
| Simulation | `sim.js` | The same `sim.js`, adapted to the grid (`web/src/crowd/voxelSimulation.ts`) |
| Views | 2D canvas + 3D voxel (`render3d.js`) | 3D voxel (`web/src/render/scene.ts`) |
| Live cameras | Room mode: a head count per room, applied with `applyObservation`; Freeze; a "live only" switch (only people and furniture phones have seen); side-by-side camera-informed vs plan-only twin | Not on `main`. On Jacob's `jacob/camera-feed` branch (not merged, not yet on GitHub): per-cell people and estimates, "Build from cameras", camera panel |
| Gemini in the browser | Yes (Setup key): floor plan → twin, room photo → update, PA text, Find fix | No (key only on the server) |

### Perception server (`server/`, on `main`)
- **Room mode (default)**: loads a prototype layout (`VENUE=malin`); each phone picks its room;
  Observations carry `room`, `peopleCount` and exit ids. **Grid mode**: `MAP=` a v2 map; posed cameras;
  `people` floor positions in cells.
- Decisions API every frame (people present, count range, crowding, fire/smoke, exit blocked) +
  Hydrogen re-counts in the background (~3 s, or when the count range changes); audio alarm detection.
- Phones send where they stand and face; a debug view; WebSocket `/ws` and `GET /observations`.
- On Jacob's `jacob/camera-feed` branch (not merged, not yet on GitHub) in addition: crowd mode (3×4 grid with hidden and beyond estimates → whole
  agents on the map), single-shot snapshot (`PERCEPTION=snapshot`), `/rescan`, `/frame/{id}/latest.jpg`,
  `Observation.gemini` (raw answer for the overlay), twin render and landmark calibration prototype.

## Data flow (target)
1. A phone posts frames → perception → an **Observation** per camera (people with kind seen / hidden /
   beyond, obstacles with cells + label + confidence, exit state, Gemini's raw answer, stream health).
2. The **live world** stabilises Observations (persistence, matching, consistent-sighting rule for
   obstacles; [LIVE_WORLD.md](LIVE_WORLD.md)) and pushes world updates to the organizer view.
3. On a question or a background tick, the **agent** takes a **snapshot** and calls the sim service:
   `run_scenario` / `run_sweep` ([SCENARIOS.md](SCENARIOS.md)). The results include casualties and replay ids.
4. The agent answers in the chat, calls `highlight_on_map`, and raises alerts. The view can **replay** any
   scenario from its snapshot.

## Conventions (unchanged)
- Grid: `x` = column, `y` = row, in cells; heights in metres; flat index `i = y * width + x`; yaw in compass
  degrees (0 = north = −y). Details: [MAP_SCHEMA.md](MAP_SCHEMA.md).
- Determinism: all randomness is seeded. Same snapshot + scenario + seed = same result.
- One agent per cell; never fractional people. Estimated people stay labelled.
- The Gemini key lives on the server. The prototype's browser key is an existing exception (see Open decisions).

## Open decisions (for the team)
| # | Question | Options |
|---|---|---|
| A | **Canonical world format** for the live world | Grid v2 (cell-level people, posed cameras, any size; needs the prototype UI ported or converted) · room rectangles (team demo today; only room-level counts, no positions) · grid as canonical with a rooms → grid converter |
| B | **Organizer frontend** | Extend `prototype/` (team demo) · extend `web/` · merge into one |
| C | **Where the live world lives** | Python server (next to perception) · Node sim service (next to the agent) |
| D | **Agent model** | Hydrogen (fast) · Neon or Carbon (stronger planning and explanation) |
| E | **Gemini calls from the browser** (prototype Setup key) | Keep for the prototype features · move all calls to the server |
| F | **Decision numbering** | Jacob's branch numbered its decisions #28–31, which clash with `main`'s #28–32; renumber if that branch is merged (the concept decisions use C1–C9 to avoid this) |
