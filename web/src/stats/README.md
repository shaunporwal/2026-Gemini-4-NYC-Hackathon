# stats/ (owner: TBD, likely the crowd owner)

The responsibilities below describe the modular integration target. The current grid app wires simulation and controls through `web/src/main.ts` and `web/src/crowd/voxelSimulation.ts`.


This document covers the TypeScript grid-map app. The current Malin Fire Twin controls and replay are documented in [the demo guide](../../../prototype/README.md).

- Produces a `StatsSnapshot` each step: total / active / evacuated / casualties / trapped, and time-to-clear.
- **Bottlenecks:** a congestion score on door and corridor cells (agents waiting or slow over time), which `render/` highlights.
- **Scenario compare:** run two cloned states headless with the same seed (for example, the base map versus the map with an extra exit) and diff the snapshots.
