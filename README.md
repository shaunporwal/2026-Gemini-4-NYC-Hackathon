# Fire Evacuation Digital Twin

A live voxel digital twin of a building. Cameras feed real crowd density into the model
(interpreted by Gemini, from video and audio). **Tap anywhere to start a fire** and see how the
crowd would evacuate: fire and smoke spread, bottlenecks, trapped people, casualties. Then change
the layout and compare the outcomes, **before a real emergency happens**.

Built at the Gemini NYC Hackathon (2026-11-21).

## Status
- `web/`: the map architecture (JSON grid schema, loader, cameras) and a starter three.js voxel renderer.
  Run: `cd web && npm install && npm run dev`, then open http://localhost:5173 (`?map=/maps/cafe.json` for the small map).
- `prototype/`: a plain-JS 2D prototype with a working fire/smoke/evacuation sim and Gemini calls (open `prototype/index.html`).
- Start with [CLAUDE.md](CLAUDE.md), [docs/VISION.md](docs/VISION.md) and [docs/MAP_SCHEMA.md](docs/MAP_SCHEMA.md).

## Docs
| Doc | What's in it |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Problem, users, demo flow, scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data flow, tick loop, ownership of state |
| [docs/MAP_SCHEMA.md](docs/MAP_SCHEMA.md) | Map JSON format and coordinate system |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Shared TypeScript types: the contract between modules |
| [docs/PLAN.md](docs/PLAN.md) | Owners, 6-hour timeline, git workflow, open questions |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made so far |
| [CLAUDE.md](CLAUDE.md) | Rules for coding agents (and a good summary for humans) |

## Layout
```
docs/     project docs          schemas/  map JSON Schema
web/      browser app + sim     server/   Gemini live-feed backend
```
