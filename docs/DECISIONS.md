# Decision Log

Append-only. One line per decision: what, why, date. Revisit only with team agreement.

| # | Decision | Why | Date |
|---|---|---|---|
| 1 | Space is a **2D grid of cells** (0.5 m default), single floor | Fire spread and crowd routing become simple per-cell updates; maps to voxels directly | 2026-11-21 |
| 2 | **Voxel art 3D render with three.js** (InstancedMesh) | Distinctive look; grid → voxels is a 1:1 mapping | 2026-11-21 |
| 3 | **Map size is dynamic**: inferred from the JSON rows | Any venue can be loaded without code changes | 2026-11-21 |
| 4 | ~~Map defined in JSON: ASCII `rows` + `objects` + `zones` + `cameras`~~ (replaced by #12) | Readable, diffable, quick to author; editor deferred | 2026-11-21 |
| 5 | ~~v1 cell types: wall, floor, door, exit, void + furniture objects~~ (replaced by #12) | Minimum needed for evacuation; furniture adds obstacles + fuel | 2026-11-21 |
| 6 | **No in-app editor in v1** (stretch goal) | Time; JSON is enough for the demo | 2026-11-21 |
| 7 | **Camera objects** have position + yaw/pitch/fov/range; runtime computes **visible cells with wall occlusion**; cameras **draggable/rotatable in 3D** | Lets the Gemini feed map "what it sees" onto specific cells | 2026-11-21 |
| 8 | **Simulation runs in the browser** (TypeScript); **thin backend** for Gemini only | 60 fps tap-to-ignite; API key stays server-side | 2026-11-21 |
| 9 | Crowd = **individual agents** following an exit distance field | Reads well visually; few-thousand agents is fine in browser | 2026-11-21 |
| 10 | Outputs in scope: **live evac/casualty stats, bottleneck detection, scenario compare** | Core "disaster avoidance" value | 2026-11-21 |
| 11 | Fire model and Gemini payload **deferred to their owners** | Owners decide; those contracts in `docs/CONTRACTS.md` are marked DRAFT | 2026-11-21 |
| 12 | **Everything physical goes in the grid**: `#` wall, `.` floor, `E` exit, `T` table, `C` chair, `P` person (+ `D` door, ` ` void). No `objects` list. Only cameras and zones are lists. **Replaces #4 and #5.** | The simplest format to write and read; size comes from the rows | 2026-11-21 |
| 13 | **One cell-type registry** (`web/src/map/cellTypes.ts`) drives loading, validation and rendering | A new type is one table entry, with no code changes elsewhere | 2026-11-21 |
| 14 | A **person** in the map is a floor cell plus a spawn point (`MapModel.people`); the crowd module turns spawns into agents | Keeps cell codes physical; agents stay owned by crowd | 2026-11-21 |
| 15 | Walls are **opaque** for camera line of sight; furniture is not | Cameras are mounted high and see over tables and chairs | 2026-11-21 |
| 16 | Schema **v2**: a required **`dimensions`** block (`width`, `height` in cells, plus `cellSize`, `wallHeight`); `rows` must match it exactly | Size is stated up front (useful for Gemini and other tools), and mismatched rows are caught | 2026-11-21 |
| 17 | Cameras are grouped into **`position {x,y,z}`, `orientation {yaw,pitch}`, `lens {fov,range}`** in a separate `cameras` field of the same JSON file | Makes where it is, where it points and what it sees explicit | 2026-11-21 |
| 18 | **No orientation on grid objects** for now. Exit/door facing and chair facing can be derived from neighbours; people get their heading from the sim. If needed later, use a sparse `overrides` list | One character can't hold a direction; keeps the grid format simple | 2026-11-21 |
| 19 | **Hackathon rule: media is the core input, and the entry uses at least two Gemini 4 models, each with one clear job.** Here: Hydrogen = people count, positions and scene summary from camera frames; Carbon (planned) = floor plan photo → map JSON. The Decisions API (`gemini-decision-1`) does the cheap per-frame checks | It is an entry requirement; every module should be able to name its model's job | 2026-11-21 |
| 20 | **Floor plan from a photo is in scope**: Gemini turns a photo of the evacuation map into a schema-v2 map JSON (the prototype's `layoutFromPhoto` is the starting point) | The venue twin must come from the real building; hand-writing maps is too slow on the day | 2026-11-21 |
| 21 | **Adaptive evacuation routes are in scope**: the exit distance field is recomputed when fire/smoke spread and when a camera reports an exit blocked (`Observation.exits[].blocked`) | Routes must follow what is happening, not the static plan | 2026-11-21 |
| 22 | The product is a **planning / preparation tool**: tap to start a simulated fire. Camera fire/smoke detection only raises a warning; it never starts the sim | Matches the demo; no real fire indoors | 2026-11-21 |
| 23 | `server/` is **Python (FastAPI)**. Phones open `/camera?id=<cameraId>` and post a JPEG about every second plus 2 s WAV mic clips; camera ids and poses come from the map JSON (`MAP` env) | Code already existed in Python; phones need only a web page (over an HTTPS tunnel) | 2026-11-21 |
| 24 | **Gated perception**: Decisions API on every frame (people present, density, fire/smoke, exit blocked); Hydrogen only when the density level changes or every 10 s. `BASELINE=1` turns gating off for the comparison | Lets more cameras run at once; the gated vs baseline numbers are part of the pitch | 2026-11-21 |
| 25 | `Observation` is final (no longer DRAFT): adds `people` (floor positions in cells, projected server-side from the camera pose), `hazards`, `exits` (exit cells + blocked) and `stream` health. Sent over WebSocket `/ws` as `{"type":"observation","observation":…}`; `GET /observations` gives a snapshot. The browser sends `{"type":"cameras","cameras":[…]}` when a camera is moved | One payload covers crowd placement, blocked exits and the UI; poll fallback is one GET | 2026-11-21 |
| 26 | **Exits have no ids**: an exit is a group of touching `E` cells, reported by its flat cell indices | No schema change needed; crowd can close those cells directly | 2026-11-21 |
| 27 | The 3D demo adapts the prototype simulation to the loaded grid and map spawns. Advance the engine every 0.5 simulated seconds. | Shares seeded fire, smoke and routing behavior with the playable prototype. Movement cooldown scales with map cell size. Hazard coefficients are demo values per cell. | 2026-11-21 |
| 28 | The team demo entry point is `prototype/index.html`, with the Gemini-derived Malin preset and 3D view selected. | Gives all teammates the same launch target and UI. | 2026-11-21 |
| 29 | Exit-awareness comparison uses matched seed, placement, reaction delays, layout and ignitions, with separate cue randomness and a 120-second observation horizon. | Measures the effect of a selected exit-information assumption. | 2026-11-21 |
| 30 | Hydrogen runs **in the background, one call per camera at a time**; it re-counts when someone appears, when crowding moves ≥ 0.5, or every 3 s. Both models are warmed up at server start. Changes the trigger in #24 | The first phone test showed 5 s stalls on every Hydrogen call and counts up to 10 s stale (`server/FAILURE_LOG.md`) | 2026-11-21 |
| 31 | Decisions also answers a **count range** (0, 1, 2, 3, 4–5, 6–9, 10+) every frame. It replaces the crowding score as the Hydrogen trigger and corrects a stale Hydrogen count when it is ≥ 0.7 sure. Both prompts say not to count people on screens, in photos or in reflections | The crowding score didn't move between 1 and 10 people, so swaps took 10–13 s to show; now about 1 s (`server/FAILURE_LOG.md` #2) | 2026-11-21 |
| 32 | The perception server's **default is room mode**: it loads a prototype layout (`VENUE=malin`, read from `prototype/layouts.js`) and each phone picks the **room** it is in. Observations carry `room` and exit ids, ready for `FireSim.applyObservation`. Grid mode (`MAP=`, posed cameras, floor positions) stays for `web/`. Object/furniture scanning stays in the prototype's photo/video flow | Phones don't need to match a camera pose, and no room guessing (the prototype's photo room match was wrong in every test); several phones cover several rooms at once | 2026-11-21 |

## Concept: Live Evacuation Twin (2026-11-21)
Numbered C1–C9 so they don't collide with `main`'s numbered decisions. Where they conflict with an earlier
numbered decision, these win.

| # | Decision | Why | Date |
|---|---|---|---|
| C1 | **The project is a general live evacuation twin**: a constantly updated grid world (people + obstacles from cameras), any disaster or event simulated on demand, and a Gemini agent that runs simulations itself. Fire is one scenario, not the product | Organizers need "where is the risk right now", not one fire demo | 2026-11-21 |
| C2 | **First event types: fire + smoke, crowd crush / surge, blocked / closed exits, generic danger zone** (gas, flood, collapse, threat as one parametric model). **First-responder access** is documented as a potential feature | Covers the main ways people die in venues with one engine | 2026-11-21 |
| C3 | **The live world updates continuously and is stabilised** (persistence ~10 s, matching, gradual counts, labels kept, one agent per cell). | A live map that doesn't jump; still honest about estimates | 2026-11-21 |
| C4 | **Obstacles are whatever the model judges blocks movement** (no fixed list), each with cells, label and confidence; they enter or leave only after consistent sightings; one in a door or exit marks it blocked | Real venues have unpredictable obstacles; ghosts must not flip exits | 2026-11-21 |
| C5 | **Risk to life = modelled casualties.** Scenarios and sweeps are ranked by it; results also report seen vs estimated, where, no-route, evacuation time and worst openings for explanation | One clear number for "largest risk to life" | 2026-11-21 |
| C6 | **The agent and headless simulations run in a Node service** on the server, loading `prototype/sim.js`; the Gemini key stays server-side | `sim.js` already runs headless in Node; no engine rewrite; no key in the browser | 2026-11-21 |
| C7 | **Agent capabilities (v1): run one scenario, worst-case sweep, show it on the map** (highlights + replay). Mitigation proposals come later | "Immediate" answers to the questions organizers actually ask | 2026-11-21 |
| C8 | **Background watch with alerts**: the agent re-runs the worst-case sweep when the world changes (and at least every ~1 min) and alerts above a threshold, throttled per cause | Risk changes during an event; nobody asks at the right moment | 2026-11-21 |
| C9 | **Every simulation runs on a world snapshot**; estimated people stay labelled in results; camera detections never start a simulated event (prevention, not response) | Comparable, replayable results; honest numbers; matches decision #22 | 2026-11-21 |
| F1 | Frontend revamp stays in `prototype/`: one page, default Gemini Malin 3D, 2D/camera switches, articulated people, queue overlay and agent sidebar adapter | Ruhan owns presentation; agent owner supplies service connection. Rendering does not change simulation outcomes; camera hazard events only warn, aligning C9 | 2026-11-21 |
| F2 | Remove prototype speech playback, generated PA messages and speech settings | Organizer requested a silent demo. Exit-awareness cues remain simulated information changes, with no audio | 2026-11-21 |
