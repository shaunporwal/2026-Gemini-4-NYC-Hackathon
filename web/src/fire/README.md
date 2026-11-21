# fire/ (owner: TBD)

The responsibilities below describe the modular integration target. The current grid app wires simulation and controls through `web/src/main.ts` and `web/src/crowd/voxelSimulation.ts`.


This document covers the TypeScript grid-map app. The current Malin Fire Twin controls and replay are documented in [the demo guide](../../../prototype/README.md).

Fire and smoke spread on the grid. **The model design is up to the owner** (see open questions in `docs/PLAN.md`).

- **Implements:** `SimSystem` (`init`, `step`, `reset`).
- **Consumes events:** `{type:"ignite", x, y}`.
- **Writes:** `state.fire` (0..1), `state.smoke` (0..1), `state.heat`, `state.fuel`.
- **Reads:** `map.cells` (walls block spread), `map.baseFuel`, `map.walkable`.
- **Must:** use `state.rng()` only; read size from `map.width/height`.
- **Hand-off to crowd:** the crowd module reads `fire` / `smoke` / `heat` to slow, reroute and damage agents. Agree the casualty thresholds with the crowd owner.
