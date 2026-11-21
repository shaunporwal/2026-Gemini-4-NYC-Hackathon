# Vision: Live Evacuation Twin

## One-liner
A **constantly updating digital twin** of a venue (people and obstacles tracked on a grid from live
cameras) where you can **simulate any disaster or event at any moment**, and a **Gemini agent** you
can ask "what is the biggest risk to life right now?". The agent answers in seconds because it runs
the simulations itself, headless, with no visuals.

## The problem
Evacuation plans are static drawings made for an empty building. Real risk depends on **who is where
right now** and **what is in the way right now**: a crowd packed near the stage, a cart parked in front
of a fire exit, a side door someone locked. Event organizers can see the room, but they can't see
how it would fail. They have no fast way to ask "if something happened *now*, where would people die?"

## The concept

```
 cameras ──► Gemini perception ──► LIVE WORLD (grid): people + obstacles, always current
                                        │                         │
                                        ▼                         ▼
                             live map for the organizer    snapshot ──► headless simulations
                             (see people, obstacles,                    (any disaster, any place,
                              agent highlights)                          many at once, milliseconds)
                                        ▲                         │
                                        └──── Gemini agent ◄──────┘
                                   answers questions, finds the worst case,
                                   shows it on the map, raises alerts on its own
```

1. **Live world.** Phones or cameras watch the venue. Gemini turns each feed into **people** (where
   they are, including estimates of people hidden or out of frame) and **obstacles** (whatever the model
   judges is in the way: furniture, carts, barriers, a blocked door). The grid is continuously updated
   and **stabilised**, so people persist and obstacles change only when seen consistently.
2. **Any event, any time.** From the current world you can simulate **fire and smoke, crowd crush or surge,
   blocked or closed exits, or a generic danger zone** (gas, flood, collapse, active threat). One shared
   deterministic engine handles all of them.
3. **A Gemini agent you talk to.** Ask in plain language: "what happens if a fire starts at the bar?",
   "where is the biggest risk to life right now?". The agent runs the scenarios headless on a snapshot of
   the live world (one run, or a **sweep** across many events and locations), ranks them by **modelled
   casualties**, explains the result, and **highlights it on the map**. Any scenario can be replayed visually.
4. **Background watch.** The agent also re-runs the worst-case sweep on its own as the world changes, and
   **alerts the organizer** when risk crosses a threshold ("Hall B filled up: a fire by its east door would
   now cost an estimated 12 lives").
5. **Intuition at a glance.** The organizer always sees the live map: people, obstacles, density, and the
   agent's hotspots. The intuition comes before any question is asked.

## Who it's for
- **Event organizers and venue operations staff** (primary): during an event, know where an evacuation
  would go wrong *now*, and act early (clear an exit, open a door, cap a room, move staff).
- **Safety officers and fire marshals**: test many scenarios quickly and back decisions with numbers.
- **Venue planners**: before an event, check a layout and expected crowd against every event type.

## What success looks like (demo)
"A live camera sees people arrive → they appear on the twin → someone parks a cart in front of an exit →
the twin shows the obstacle → the agent alerts: *'Exit E2 is now blocked; a fire in the lounge would cost
an estimated 9 lives'* → we ask *'what's the biggest risk right now?'* → in seconds it names the worst
scenario, highlights it on the map and replays it → we clear the exit → the agent re-checks: 9 → 1."

## Principles
- **Physics is code; the LLM sees, speaks and proposes.** Gemini perceives the world and runs and explains
  simulations. The deterministic engine decides outcomes. The same seed and world give the same result.
- **The world is the source of truth.** Every simulation starts from a snapshot of the live world, never
  from a stale plan.
- **Instant answers.** The agent's simulations run headless (no rendering), so a sweep of hundreds of
  scenarios takes seconds, not minutes.
- **Honest estimates.** People Gemini *estimates* (hidden, beyond the frame) are labelled as estimates
  on the map, in results and in alerts.
- **Prevention, not response.** The tool is for spotting risk before anything happens. Simulated events
  are started by a person or the agent, never by a camera detection.

## Where we are (checked against `main`, 2026-11-21)

| Piece | Status |
|---|---|
| Simulation engine (`prototype/sim.js`): fire + smoke, Dijkstra routing, people with smoke dose (casualties), furniture as obstacles, lockable doors and exits, doorway queue stats, exit-awareness matched replay, **headless `run()`** (works in Node) | **Built** |
| Prototype twin (`prototype/`, the team demo, decision #28): room-rectangle layouts, 2D/3D, click-to-ignite, Gemini floor plan → twin, room photo → furniture and blocked doors, "Find fix" (Gemini proposes, sim scores), phones feed per-room head counts, Freeze, a "live only" switch (only the people and furniture phones have seen), camera-informed vs plan-only twin side by side | **Built** |
| Grid twin (`web/`): v2 grid map, voxel 3D view, `sim.js` on the grid, Run / Pause / Reset / Replay | **Built** |
| Perception server (`server/`): continuous per-camera counts (Decisions every frame + Hydrogen re-count ~3 s), **room mode** (default) and **grid mode**, phone position and facing, audio alarm detection | **Built** |
| Crowd mode: hidden / beyond-the-frame estimates as whole agents; camera panel with Gemini's analysis drawn over the frame | **Planned** |
| Live world: **stabilised** people + **obstacles tracked continuously** from cameras, world snapshots | **Planned** (obstacles exist only in the prototype's on-demand photo flow) |
| Events beyond fire: crowd crush / surge, generic danger zone | **Planned** (blocked exits partly exist: lock / unlock, camera `exit_blocked`) |
| Headless simulation service (Node) + Gemini agent (single scenario, sweep, map highlights, background alerts) | **Planned** |
| First-responder access, agent-proposed mitigations | **Later** (the prototype's "Find fix" is the precedent for mitigations) |

**Biggest open decision:** the project has **two world formats and two frontends**: the prototype's room
rectangles (the team demo, room-level head counts) and `web/`'s grid (cell-level people, posed cameras).
The live world needs **one** canonical world. See `docs/ARCHITECTURE.md` → Open decisions.

Details: [LIVE_WORLD.md](LIVE_WORLD.md), [SCENARIOS.md](SCENARIOS.md), [AGENT.md](AGENT.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [PLAN.md](PLAN.md).
