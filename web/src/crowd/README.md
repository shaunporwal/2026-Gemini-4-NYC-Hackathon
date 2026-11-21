# crowd/ (owner: TBD)
Individual evacuation agents.

- **Implements:** `SimSystem`.
- **Writes:** `state.agents` (position, velocity, health, status).
- **Reads:** `map.walkable`, `map.exitCells`, hazard layers (`fire`, `smoke`, `heat`), `state.observations` (via feed).
- **Approach (agreed):** a distance field to the nearest *safe* exit (BFS/Dijkstra over walkable cells, with costs for fire and smoke, recomputed when hazards change). Agents follow its gradient, slow down in dense crowds and smoke, and lose health from heat/smoke exposure. An agent becomes `evacuated` on reaching an exit cell and a `casualty` at health 0.
- **Adaptive routes (DECISIONS #21):** recompute the field when fire/smoke change and when an `Observation.exits[]` entry is `blocked`: treat those exit cells as closed until a later observation clears them.
- Spawning: before a fire starts, agents are placed according to live camera counts in each camera's `visibleCells`. Zones without a camera use a default density.
