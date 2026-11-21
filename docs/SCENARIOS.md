# Scenarios (disasters and events)

Every scenario runs in the **same deterministic engine** on a **world snapshot** (`docs/LIVE_WORLD.md`),
headless for the agent or visually for a replay. A scenario is a small description:

```
{ type, where (cell or area), when (offset, default now), parameters, seed }
```

## Risk metric
**Modelled casualties** are the single number scenarios are ranked by. Every scenario type defines how a
person becomes a casualty (fire, smoke dose, crush density, danger-zone exposure). Results also report,
for explanation (not ranking): where the casualties happened, people with no route, time to evacuate,
and the worst doors and exits.

Estimated people (`hidden`, `beyond`) count like seen people, but results report them separately so the
agent can say "9 casualties, 3 of them among estimated people".

## Event types

| Type | What happens | Casualty rule | Status |
|---|---|---|---|
| **Fire + smoke** | Fire spreads from a start cell through fuel (floor, furniture). Smoke spreads faster, slows people and harms them. | Fire contact, or smoke dose over a limit ("down") | **Built** (`prototype/sim.js`) |
| **Blocked / closed exits** | One or more doors or exits become unusable (blocked, locked, closed by staff). Usually combined with another event. | From the combined event | **Partly built**: openings can be locked and unlocked (`applyAction`); the server reports `exit_blocked` from cameras |
| **Crowd crush / surge** | No hazard. Many people move at once: everyone heads for the exits, or a surge toward one point (a stage, a gate). | Local density above a dangerous level for long enough | Planned (doorway queue stats and waiting-time metrics are built) |
| **Generic danger zone** | An area becomes harmful or impassable and may spread: gas leak, flood, collapse, active threat. Parameters: start area, spread rate, lethality, passable or not. | Exposure inside the zone (dose, or immediate if lethal) | Planned |

### Parameters (first version)
- **Fire:** start cell, spread rate (existing slider value as the default).
- **Blocked exits:** which openings, and from when.
- **Crowd surge:** trigger (everyone evacuates now, or a surge toward a target), and a density threshold for crush.
- **Danger zone:** start cells, spread rate (0 = static), harm per second, blocks movement (yes/no), and a
  label ("gas", "flood", "collapse", "threat") that only affects wording.

## Already built that scenarios reuse (`main`)
- `sim.run(layout, ignitions, opts)`: a **headless** run returning stats. It works in Node, which is the basis
  for the agent's simulation service.
- Same seed + same fire = same result (verified). The exit-awareness comparison already runs two matched
  simulations side by side (same seed, placement, reaction delays, ignitions).
- "Find fix" in the prototype: Gemini proposes layout changes and the simulator scores each against the same fire.

## Sweeps
A **sweep** runs many scenarios on the same snapshot to find the worst case, for example:
- every event type × a grid of start locations (every room, every exit, the densest areas),
- each exit blocked in turn,
- combinations (fire + nearest exit blocked).

Results are ranked by modelled casualties. A sweep must finish in seconds, which is possible because
runs are headless and parallel. Same snapshot + same seed = same ranking.

## Potential feature: first-responder access
Measure **how hard it is for first responders to reach the scene**: the route length and time from the
entry points responders use to the event location, *against* the outflow of evacuating people and through
the hazard. It would add a second number to a result ("responders reach the bar in 2 min 40 s, delayed by
the crowd at the main entrance"). Not scheduled: documented so the engine and results format leave
room for it.

## Visual replay
Any scenario the agent ran can be replayed in the viewer on its snapshot, with fire, smoke, danger zones and
people animated. That's what the current "Run demo / click to ignite" view becomes.
