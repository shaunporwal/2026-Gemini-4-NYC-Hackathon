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
