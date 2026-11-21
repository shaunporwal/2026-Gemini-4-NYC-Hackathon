# Plan: Live Evacuation Twin

Concept: [VISION.md](VISION.md) · Architecture and open decisions: [ARCHITECTURE.md](ARCHITECTURE.md).
Status is checked against `main` (2026-11-21). This plan is a proposal: owners and order are for the team to confirm.

## Phase 0: settle the open decisions
The team agrees on ARCHITECTURE.md → Open decisions **A–F**, above all **A (canonical world format)** and
**B (frontend)**. Everything below depends on them.

## Phase 1: one live world
- [ ] Bring in crowd mode with estimates and the camera panel from Jacob's `jacob/camera-feed` branch (not merged, not yet on GitHub) (resolve the server conflicts with room mode)
- [ ] One world format for both perception modes (decision A); converter if needed
- [ ] Stabilise people: persistence (~10 s), matching, gradual counts, one per cell, labels kept ([LIVE_WORLD.md](LIVE_WORLD.md))
- [ ] Obstacles in perception: Gemini reports whatever blocks movement (cells, label, confidence); consistent-sighting rule; blocked openings
- [ ] World snapshot: a frozen, self-contained copy for simulations and replays
- [ ] Organizer view shows people (estimates tinted), obstacles and blocked exits live

## Phase 2: scenarios on the snapshot
- [ ] Scenario description `{type, where, when, params, seed}` and a common result format (casualties, seen vs estimated, where, no-route, evacuation time, worst openings)
- [ ] Blocked / closed exits as a scenario (reuse lock/unlock)
- [ ] Crowd crush / surge (density-based casualties)
- [ ] Generic danger zone (spread, harm, passable or not)
- [ ] Visual replay of any scenario from its snapshot

## Phase 3: headless sim service + agent
- [ ] Node service: load `sim.js`, run scenarios and sweeps headless and in parallel on snapshots (target: one run ≪ 1 s, a sweep in a few seconds)
- [ ] Gemini agent tool loop: `get_world_summary`, `run_scenario`, `run_sweep`, `highlight_on_map` ([AGENT.md](AGENT.md))
- [ ] Chat panel in the organizer view; map highlights with a replay button
- [ ] Background watch: re-run the worst-case sweep on world changes and at least every ~1 min; threshold alerts, throttled

## Later
- [ ] First-responder access: route and time for responders against the evacuating crowd and the hazard ([SCENARIOS.md](SCENARIOS.md))
- [ ] Agent-proposed mitigations, re-simulated (builds on the prototype's "Find fix")
- [ ] Multi-camera de-duplication; landmark calibration wired in (prototype exists on Jacob's `jacob/camera-feed` branch (not merged, not yet on GitHub))

## Ownership (to confirm)
| Area | Who |
|---|---|
| Perception + live world (server) | _TBD_ (Elijah and Jacob have worked here) |
| Simulation engine + scenarios | _TBD_ (Ruhan and Shaun have worked here) |
| Sim service + agent | _TBD_ |
| Organizer view | _TBD_ (depends on decision B) |

## Git workflow
- `main` must always run. Short-lived branches `<name>/<feature>`; merge through PRs.
- Docs change with the code: if you change behaviour, update the matching doc and add a decision.
- Commit messages: `area: what changed`.
