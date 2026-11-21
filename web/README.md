# web/
The browser app. **The entire simulation runs here** (planned: Vite + TypeScript + three.js).

```
public/maps/   map JSON files (spec: docs/MAP_SCHEMA.md)
src/shared/    types.ts (from docs/CONTRACTS.md), seeded RNG, index helpers
src/map/       map loader + validation, object catalog, camera visible cells
src/render/    three.js voxel scene, overlays, picking, camera gizmos
src/fire/      fire + smoke spread system
src/crowd/     evacuation agents system
src/feed/      Gemini observation client (+ mock)
src/stats/     stats, bottlenecks, scenario compare
src/ui/        HUD + controls
```
Every simulation module exports a `SimSystem` (`init` / `step` / `reset`). See `docs/ARCHITECTURE.md`.
No app code exists yet. The first step is to set up Vite here and create `src/shared/types.ts` from `docs/CONTRACTS.md`.
