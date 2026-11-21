# Fire Evacuation Digital Twin

A live voxel digital twin of a building. Cameras feed real crowd density into the model
(interpreted by Gemini, from video and audio). **Tap anywhere to start a fire** and see how the
crowd would evacuate: fire and smoke spread, bottlenecks, trapped people, casualties. Then change
the layout and compare the outcomes, **before a real emergency happens**.

Built at the Gemini NYC Hackathon (2026-11-21).

## Status
Planning stage: docs and directory structure are in place, and no app code exists yet.
Start with [CLAUDE.md](CLAUDE.md) and [docs/VISION.md](docs/VISION.md).
Planned stack: Vite + TypeScript + three.js (`web/`) and a thin Gemini backend (`server/`).

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
