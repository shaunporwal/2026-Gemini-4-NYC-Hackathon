# The Gemini Agent

A Gemini agent the organizer can talk to. It answers risk questions by **running simulations itself**,
headless, on a snapshot of the live world, and it watches in the background and raises alerts.

> Status: **planned**. The closest existing pieces on `main`: `sim.run()` (headless, works in Node) and the
> prototype's "Find fix" (Gemini proposes changes and the simulator scores them, called from the browser).
> **Built (first version, DECISIONS C12):** the chat in the prototype's Assistant panel talks to `server/agent.py`, a Gemini
> function-calling loop (Hydrogen) over `get_world_summary`, `run_scenario`, `run_sweep`, `test_changes`, `highlight_opening`,
> `suggest` and `show_replay`. The tools run the prototype engine in Node (`server/sim_tools.js`) on the snapshot the page sends.
> The Advisor tab (C10) uses the same server for its proposals and guide. Not built yet: background watch and alerts.

## What it does

| Capability | Example | How |
|---|---|---|
| **Run one scenario** | "What happens if a fire starts at the bar?" | Picks the scenario, runs it once on a fresh snapshot, and explains casualties, where and why |
| **Worst-case sweep** | "What's the biggest risk to life right now?" | Runs a sweep (`docs/SCENARIOS.md`) across event types and locations, ranks by modelled casualties, and explains the top results |
| **Show it on the map** | (with any answer) | Highlights hotspots, the worst start point and affected exits on the live map, and offers a visual replay |
| **Background watch + alerts** | (unprompted) | Re-runs the worst-case sweep as the world changes, and alerts when risk crosses a threshold |

Not in the first version: proposing and testing mitigations ("open E3 saves 8 lives"). The prototype's
"Find fix" shows the pattern for later. First-responder access is a potential feature (`SCENARIOS.md`).

## Tools (function calls)
The agent is a Gemini tool-use loop. The tools are thin wrappers over the world and the engine:

| Tool | Returns |
|---|---|
| `get_world_summary()` | Counts per room or zone (seen, hidden, beyond), obstacles, blocked exits, camera coverage and age |
| `run_scenario(type, where, params)` | Casualties (seen vs estimated), where they happened, people with no route, evacuation time, worst openings, replay id |
| `run_sweep(types, locations, limit)` | Ranked list of the worst scenarios with the same fields, plus the sweep size and time |
| `highlight_on_map(cells, label, replay_id?)` | Puts a marker or area on the organizer's map, optionally with a replay button |

Rules for the agent:
- Never invent numbers: every figure in an answer comes from a tool result.
- Always say how much of the result rests on **estimated** people, and how fresh the camera coverage is.
- Name places the way the organizer does (zone names, exit names), not cell indices.
- Keep answers short: the headline number, the place, one sentence of why, and the map highlight.

## Background watch
- Re-run a bounded worst-case sweep when the world changes meaningfully (an exit blocked, a room filling up,
  a new obstacle), and at least every ~1 min.
- Alert when the worst-case modelled casualties cross a threshold, or jump by a set amount since the last
  check. Alerts include the cause ("Exit E2 blocked by a cart"), the number, the place, and a map highlight.
- Throttle: no repeated alert for the same cause until it changes. Alerts are visible in the viewer and can
  be dismissed.

## Speed budget
"Immediate" is the point. Target: a single scenario in **well under 1 s** of engine time, and a sweep of
hundreds of runs in **a few seconds**, with no rendering. The Gemini calls (understanding the question,
writing the answer) dominate the total time, so the agent should use a fast model for routine questions.

## Models
The hackathon rule is at least two Gemini 4 models, each with one clear job (`docs/DECISIONS.md` #19).
Proposed split, to confirm:
- **Perception** (existing): Hydrogen for people and obstacles from frames, plus the Decisions API for fast checks.
- **Agent**: a stronger model (Carbon or Neon) for planning sweeps and explaining results, or Hydrogen for speed
  if answers are fast enough. Open question.

## Where it runs
A **Node service** next to the perception server. It loads the same simulation engine (`prototype/sim.js`
already runs in Node) and the world snapshots, runs scenarios headless, and holds the Gemini API key
server-side. The viewer talks to it for the chat panel, highlights and alerts. Details in
`docs/ARCHITECTURE.md`.

## Open questions
- Which model for the agent (quality vs speed)?
- Alert threshold: an absolute number of lives, a change since the last check, or both?
- Sweep design: which locations count as candidates (every room, a coarse grid, hotspots by density)?
- Chat only, or voice too?
