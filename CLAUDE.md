# CLAUDE.md: instructions for coding agents

You are working on the **Live Evacuation Twin**. Live cameras track **people and obstacles** on a grid
map of a venue. Any disaster or event (fire and smoke, crowd crush, blocked exits, a generic danger zone)
can be simulated at any moment on a snapshot of that live world. A **Gemini agent** runs the simulations
itself, headless, to tell an event organizer where the biggest risk to life is, highlights it on the map,
and raises alerts. Goal: **spot risk before anything happens.**

**Read before doing anything non-trivial:**
1. `docs/VISION.md`: the concept, principles, and **what is built vs planned**
2. `docs/ARCHITECTURE.md`: components, data flow, and the **open decisions** (don't silently decide them)
3. The doc for your area: `docs/LIVE_WORLD.md`, `docs/SCENARIOS.md` or `docs/AGENT.md`
4. `docs/MAP_SCHEMA.md` and `docs/CONTRACTS.md`: grid format, coordinates, shared types
5. `docs/DECISIONS.md`: decisions already made; don't re-litigate them
6. The `README.md` in the folder you're working in

**Many things in the docs are planned, not built.** Check the status tables before assuming a module,
endpoint or type exists. Planned types in `CONTRACTS.md` are marked PLANNED and aren't in `types.ts`.

## Repo layout
```
docs/        concept, live world, scenarios, agent, architecture, plan, schema, contracts, decisions
prototype/   team demo twin (plain JS): sim.js engine, room-rectangle layouts, 2D/3D, Gemini features
web/         grid twin (Vite + TS + three.js): v2 grid map, voxel view, sim.js on the grid
server/      perception (Python FastAPI): phones → Gemini → Observations; owns the Gemini key
schemas/     map.schema.json        specs/  TLA+ models (on main)
(planned)    Node sim service + Gemini agent: headless scenarios and sweeps on world snapshots
```

## Commands
```bash
cd web && npm install && npm run dev      # grid twin, http://localhost:5173 ; npm run build before pushing
python3 -m http.server 5174 --bind 127.0.0.1 --directory prototype   # team demo
cd server && .venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8000 --env-file .env
```

## Hard rules
- **Physics is code; the LLM sees, speaks and proposes.** Outcomes come from the deterministic engine, never
  from a model's guess. An agent answer may only quote numbers that came from a tool or simulation result.
- **Determinism.** All randomness is seeded (`state.rng()` / the engine's seeded RNGs, never `Math.random()`
  in sim code). Same snapshot + scenario + seed = same result.
- **Simulations run on a world snapshot**, never on the live, changing world.
- **Whole agents only.** At most one person per cell; never fractional people. Estimated people (`hidden`,
  `beyond`) stay labelled as estimates everywhere.
- **Prevention, not response.** A camera detection may warn; it never starts a simulated event on its own.
- **Coordinates:** `x` = column, `y` = row, in cells; heights in metres; flat index `i = y * width + x`; yaw in
  compass degrees (0 = north = −y, 90 = east = +x). three.js: `X = x*cellSize`, `Z = y*cellSize`, `Y` up.
- **Per-cell data is typed arrays** of length `width*height`. **Map size is dynamic**: never hardcode it.
- **API keys stay on the server** (`server/.env`, gitignored). The prototype's browser Setup key is an existing
  exception under discussion (ARCHITECTURE.md → Open decisions E). Don't add new browser-side Gemini calls.
- **Entry rule: at least two Gemini 4 models, each with one clear job**, with media as the core input
  (`docs/DECISIONS.md` #19). Don't remove a model or blur its job without telling the team.
- **Contracts:** `docs/CONTRACTS.md` ↔ `web/src/shared/types.ts`. Change both together and call it out.
- **`main` must always run.** Build before pushing. Keep the demo maps and the prototype demo working.
- **Hackathon speed.** Simple, readable code. No new dependencies without a reason. No test frameworks unless asked.

## When adding a feature
1. Find it in `docs/PLAN.md` and the area doc; check `docs/DECISIONS.md`.
2. If it touches an open decision (ARCHITECTURE.md), ask the human instead of choosing.
3. Update the area doc's status and add a decision for any product or architecture choice.
