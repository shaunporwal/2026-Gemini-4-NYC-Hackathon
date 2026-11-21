# CLAUDE.md — instructions for coding agents

You are working on **a fire evacuation digital twin** built at a 6-hour hackathon by a team of 4.
A voxel 3D map of a building is loaded from JSON; Gemini reads live camera feeds to report crowd
density; users tap the map to start a fire and watch fire spread, crowd evacuation, bottlenecks
and casualties. Goal: **disaster avoidance**.

**Read before doing anything non-trivial:**
1. `docs/VISION.md`: what we're building, scope in/out
2. `docs/ARCHITECTURE.md`: modules, data flow, tick loop, who writes what
3. `docs/MAP_SCHEMA.md`: map JSON + coordinate system
4. `docs/CONTRACTS.md`: **the contract between modules** (becomes `web/src/shared/types.ts`)
5. `docs/DECISIONS.md`: decisions already made; don't re-litigate them
6. `docs/PLAN.md`: owners, timeline, git workflow
7. The `README.md` in the folder you're working in

## Repo layout
```
docs/            Vision, architecture, map schema, contracts, plan, decisions
schemas/         map.schema.json (JSON Schema for map files)
prototype/       Current Fire Twin demo, plain JS with 2D/3D views and matched replay
web/             Vite + TypeScript grid-map and camera development app
  public/maps/   Map JSON files (demo-hall.json is the reference map)
  src/shared/    types.ts (copied from docs/CONTRACTS.md), constants, pure helpers
  src/map/       loader/validation, object catalog, camera visible cells
  src/render/    three.js voxel scene, overlays, picking, camera gizmos
  src/fire/      fire + smoke spread
  src/crowd/     agents, exit distance field, movement, damage
  src/feed/      WebSocket client for Gemini observations (+ mock)
  src/stats/     evac/casualty stats, bottlenecks, scenario compare
  src/ui/        HUD and controls
server/          Python/FastAPI: phone cameras → Gemini → Observations over WebSocket (see server/README.md)
```

## Commands
The current team demo is `prototype/index.html`. Follow the root README to serve it on port 5174, select the Gemini-derived Malin preset and switch to 3D. It includes doorway queues and exit-awareness comparisons. Its rules are in `prototype/AGENTS.md`.

`web/` is the TypeScript grid-map app. Its `crowd/voxelSimulation.ts` adapter uses `prototype/sim.js`. The following commands apply to that app.
```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build; run before pushing
```
Load another map with `?map=/maps/cafe.json`. `web/src/shared/types.ts` must stay identical to `docs/CONTRACTS.md`.

## Hard rules
- **Stay in your lane.** Each folder in `web/src/` has an owner (`docs/PLAN.md`). A system only
  **writes** the state it owns (see the table in ARCHITECTURE.md). Reading is fine.
- **`docs/CONTRACTS.md` / `shared/types.ts` is a contract.** Don't change existing types casually. If you must,
  update both files and the matching doc in the same commit and call it out in your summary so the human tells the team.
- **Coordinates:** `x` = column, `y` = row, in **cells**; heights in **metres**; flat index
  `i = y * width + x`; yaw is compass degrees (0 = north = −y, 90 = east = +x). three.js world:
  `X = x*cellSize`, `Z = y*cellSize`, `Y` up.
- **Per-cell data is typed arrays** of length `width*height`, not arrays of objects.
- **No `Math.random()` in sim code**. Use `state.rng()` so scenario compares are deterministic.
- **Map size is dynamic.** Never hardcode width/height; read them from `MapModel`.
- **No API keys in `web/`.** Gemini is only called from `server/` (key in `server/.env`, gitignored).
- **Entry rule: at least two Gemini 4 models, each with one clear job**, and media as the core input.
  Don't remove a model or blur its job without telling the team (`docs/DECISIONS.md` #19).
- **`main` must always run.** For changes to `web/`, run its build before committing. For the plain-JS demo, follow the browser verification procedure in `prototype/AGENTS.md`. Keep both entry points usable.
- **Hackathon speed.** Prefer simple, working, readable code over abstractions. No new
  dependencies without a good reason. No test frameworks unless asked.

## When adding a feature
1. Check `docs/DECISIONS.md` and the module's `README.md`.
2. Work against `web/public/maps/demo-hall.json` and mocks if other modules aren't ready.
3. If you make a product/architecture decision, append it to `docs/DECISIONS.md`.
