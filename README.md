# Live Evacuation Twin

A **constantly updating digital twin** of a venue: live cameras track **people and obstacles** on a grid,
and at any moment you can **simulate any disaster or event**: fire and smoke, crowd crush, blocked exits,
or a generic danger zone. A **Gemini agent** you can talk to runs those simulations itself, headless and
instant, to tell an event organizer **where the biggest risk to life is right now**, show it on the map,
and raise alerts on its own when the risk rises.

Built at the Gemini 4 NYC Hackathon (2026-11-21).

## Status (checked against `main`)
| | |
|---|---|
| **Built** | Simulation engine (fire, smoke, routing, casualties, doorway queues, lockable exits, exit-awareness matched replay, headless `run()`); prototype twin (team demo) with live per-room camera counts, Freeze and a "live only" switch (only the people and furniture phones have seen); grid twin (`web/`) with the same engine; perception server (continuous counts, room and grid modes) |
| **Planned** | Crowd mode with hidden and beyond-the-frame estimates; camera panel showing Gemini's analysis; stabilised live world with obstacles; crowd crush and danger-zone scenarios; headless Node sim service; the Gemini agent (scenarios, worst-case sweeps, map highlights, background alerts) |

## Run what exists
```bash
# Team demo (prototype twin): select "The Malin Chelsea (Gemini, from the floor plan PDF)", then 3D.
# Gemini actions need a key in Setup. Restart the server after pulling or switching worktrees.
python3 -m http.server 5174 --bind 127.0.0.1 --directory prototype   # http://127.0.0.1:5174/

# Grid twin
cd web && npm install && npm run dev                                  # http://localhost:5173

# Perception server (phones over an HTTPS tunnel, e.g. cloudflared)
cd server && .venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8000 --env-file .env
```
Details: `prototype/README.md`, `web/README.md`, `server/README.md`.

## Docs
| Doc | What's in it |
|---|---|
| [docs/VISION.md](docs/VISION.md) | The concept, users, demo story, principles, and what's built vs planned |
| [docs/LIVE_WORLD.md](docs/LIVE_WORLD.md) | The live world: people and obstacle layers, stabilisation, snapshots |
| [docs/SCENARIOS.md](docs/SCENARIOS.md) | Disasters and events, the casualty metric, sweeps, first-responder access (potential) |
| [docs/AGENT.md](docs/AGENT.md) | The Gemini agent: tools, sweeps, map highlights, background watch and alerts |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components today and target, data flow, **open decisions** |
| [docs/PLAN.md](docs/PLAN.md) | Phased roadmap and ownership (to confirm) |
| [docs/MAP_SCHEMA.md](docs/MAP_SCHEMA.md) | Grid map JSON format and coordinates |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Shared types today + planned types for the live world, scenarios and agent |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (concept decisions C1–C9 at the end) |
| [docs/EVAL.md](docs/EVAL.md), [docs/HANDOFF.md](docs/HANDOFF.md), [docs/pr-docs/](docs/pr-docs/README.md) | Evaluation log, earlier handoff notes, PR planning docs (historical) |
| [CLAUDE.md](CLAUDE.md) | Rules for coding agents |

## Layout
```
docs/       project docs              schemas/   map JSON Schema
prototype/  team demo twin + sim.js   web/       grid twin (Vite + TS + three.js)
server/     perception (Python)       specs/     TLA+ models of the phone → twin flow (on main)
```
