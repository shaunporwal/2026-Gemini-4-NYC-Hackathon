# Live World

The live world is the **current state of the venue on the grid**: the static map, plus the people and
obstacles the cameras see right now. It's what the organizer looks at, and every simulation starts
from a snapshot of it.

> Status (checked against `main`): **built**: static maps (grid and prototype rooms), continuous per-camera
> people counts (room mode: a head count per room; grid mode: floor positions), phone position and facing,
> a Freeze button and a "live only" switch (only the people and furniture phones have seen). **Partial**: obstacles exist only in the prototype's on-demand room photo flow (Gemini reads furniture
> and blocked doors from a photo, in the browser). **Planned**: crowd mode with hidden and beyond-the-frame people as whole agents, stabilisation, continuous obstacle tracking,
> world snapshots.

## Layers

| Layer | Source | Changes | Notes |
|---|---|---|---|
| **Static map** | Map JSON (`docs/MAP_SCHEMA.md`) | Rarely (load or edit) | Walls, exits, doors, built-in furniture, camera poses. The baseline. |
| **People** | Gemini perception per camera | Continuously | One agent per cell, each tagged `seen`, `hidden` (occluded, estimated) or `beyond` (past the frame edge, estimated) |
| **Obstacles** | Gemini perception per camera | When seen consistently | Anything the model judges is in the way of movement. See below. |
| **Exit / door state** | Perception + manual override | On change | Open, blocked (obstacle), closed or locked (manual) |
| **Coverage** | Camera poses + view cones | When a camera moves | Which cells are observed now, and how long ago each unobserved cell was seen |

The simulation sees one merged grid: static map + obstacles (not walkable) + exit state + people. The planned one-person-per-cell live-estimation representation below is separate from continuous simulation: scenario occupants have fractional positions and physical body collisions, so multiple simulated people can share a cell when they fit. Placement reports any occupants it cannot fit. This frontend change does not implement the planned stabilised live-world service.

## People: continuous and stabilised
Each camera re-estimates every few seconds. The world doesn't copy each estimate. It **stabilises** them:
- **Persistence.** A person who is missed stays in place for a short time (~10 s) before fading out. Gemini
  misses people between frames, and the map must not blink.
- **Matching.** A new detection near an existing person updates that person (smoothed position) rather
  than creating a new one.
- **Gradual counts.** In crowd mode, cell counts move toward each new estimate. They don't jump.
- **Labels kept.** `hidden` and `beyond` people stay labelled as estimates for their whole life.
- **One agent per cell.** Never fractional people. Collisions move to the nearest free cell.
- **Overlapping cameras.** Two cameras seeing the same area must not double-count (de-duplication by cell
  proximity is planned).

A one-off multi-frame snapshot remains useful for tests and as a fallback. Note: `main`'s server already re-counts
continuously (decisions #30–31 on `main`) but doesn't stabilise. Counts can jump between frames.

## Obstacles: whatever the model decides
We don't fix a list of obstacle types. Gemini reports anything it judges blocks or narrows movement:
furniture that moved or appeared, carts, boxes, barriers, a queue standing in a doorway, a closed shutter.
Each obstacle is placed on the grid (cells it covers) with a short label and a confidence. Rules:
- An obstacle enters the world only after it's **seen in several consecutive estimates** (no single-frame
  ghosts), and leaves only after the area is **seen clear** several times.
- Obstacles in doors or exits mark that opening **blocked**, which is the most safety-critical change.
- Built-in furniture from the map is the baseline. Perception can confirm, move or remove it.
- People are never obstacles. They are their own layer.

## Snapshot
A **world snapshot** is a frozen, self-contained copy of the merged grid at one instant (map, obstacles,
exit state, people with labels, timestamp, coverage). Every simulation runs on a snapshot, so:
- the agent's sweep compares scenarios on exactly the same world,
- results can be replayed later even though the live world has moved on,
- the same snapshot and seed always give the same result.

## What the organizer sees (viewer)
- The live map: people (estimated ones tinted), obstacles (labelled), blocked exits highlighted, and
  camera cones with coverage age.
- Per camera: the live frame with Gemini's analysis drawn over it (mode, what it's doing, and whether it
  is estimating beyond its view). Built.
- The agent's hotspots and alerts on top (`docs/AGENT.md`).
