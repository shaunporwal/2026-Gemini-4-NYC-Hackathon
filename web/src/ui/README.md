# ui/ (shared)

The responsibilities below describe the modular integration target. The current grid app wires simulation and controls through `web/src/main.ts` and `web/src/crowd/voxelSimulation.ts`.


This document covers the TypeScript grid-map app. The current Malin Fire Twin controls and replay are documented in [the demo guide](../../../prototype/README.md).

HUD and controls: live stats panel, start/pause/reset, a map picker (`?map=/maps/<file>.json`), compare-scenario button, and a camera list with a live Gemini summary per camera.
UI code only emits intents/events and reads state. Simulation logic doesn't belong here.
