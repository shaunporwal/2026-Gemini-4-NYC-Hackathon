# Decision Log

Append-only. One line per decision: what, why, date. Revisit only with team agreement.

| # | Decision | Why | Date |
|---|---|---|---|
| 1 | Space is a **2D grid of cells** (0.5 m default), single floor | Fire spread and crowd routing become simple per-cell updates; maps to voxels directly | 2026-11-21 |
| 2 | **Voxel art 3D render with three.js** (InstancedMesh) | Distinctive look; grid → voxels is a 1:1 mapping | 2026-11-21 |
| 3 | **Map size is dynamic**: inferred from the JSON rows | Any venue can be loaded without code changes | 2026-11-21 |
| 4 | Map defined in **JSON: ASCII `rows` + `objects` + `zones` + `cameras`** | Readable, diffable, quick to author; editor deferred | 2026-11-21 |
| 5 | v1 cell types: **wall, floor, door, exit, void** + furniture objects | Minimum needed for evacuation; furniture adds obstacles + fuel | 2026-11-21 |
| 6 | **No in-app editor in v1** (stretch goal) | Time; JSON is enough for the demo | 2026-11-21 |
| 7 | **Camera objects** have position + yaw/pitch/fov/range; runtime computes **visible cells with wall occlusion**; cameras **draggable/rotatable in 3D** | Lets the Gemini feed map "what it sees" onto specific cells | 2026-11-21 |
| 8 | **Simulation runs in the browser** (TypeScript); **thin backend** for Gemini only | 60 fps tap-to-ignite; API key stays server-side | 2026-11-21 |
| 9 | Crowd = **individual agents** following an exit distance field | Reads well visually; few-thousand agents is fine in browser | 2026-11-21 |
| 10 | Outputs in scope: **live evac/casualty stats, bottleneck detection, scenario compare** | Core "disaster avoidance" value | 2026-11-21 |
| 11 | Fire model and Gemini payload **deferred to their owners** | Owners decide; those contracts in `docs/CONTRACTS.md` are marked DRAFT | 2026-11-21 |
