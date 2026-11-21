# Fire Twin handoff

Updated 2026-11-21 after the exit-awareness replay implementation.

## Open the team demo

Follow [the root quick start](../README.md#open-the-current-fire-twin). Serve `prototype/` from the checkout you intend to demonstrate, open port 5174, select **The Malin Chelsea (Gemini, from the floor plan PDF)** and click **3D**.

Identify the current UI by **Learn a second exit**, **Compare same crowd**, and **Doorway queues**. A fresh page begins with the approximate Malin layout in 2D. The TypeScript app in `web/` has its own grid-map interface and launch command.

## Implemented

- Gemini floor-plan/media input and room-photo/video updates.
- Shared deterministic fire, smoke and crowd engine in `prototype/sim.js`.
- 2D and 3D rendering, furniture collision, door locking and exit routing.
- Doorway queue counts, individual and aggregate waiting, queued smoke exposure.
- Familiar-exit knowledge, timed second-exit cue, configurable reception probability.
- Two matched simulations with a 120-second observation window and selectable view.
- Per-person cue events, purple head markers and actual exit-use counts.
- Gemini PA text with template fallback, and layout-fix proposals scored by the engine.

[The demo guide](../prototype/README.md) defines controls and metrics. [The evaluation log](EVAL.md) records observed successes and failures.

## Implementation locations

| Work | Files |
|---|---|
| Simulation and queue accounting | `prototype/sim.js` |
| Comparison controls and results | `prototype/app.js`, `index.html`, `style.css` |
| 3D view | `prototype/render3d.js` |
| Preset room model | `prototype/layouts.js`, key `malinGemini` |
| Gemini requests | `prototype/gemini.js` |
| Grid-map simulation adapter | `web/src/crowd/voxelSimulation.ts` |
| Camera perception backend | `server/` |

## Model limits and remaining work

Fire spread, smoke diffusion and the down threshold are demo heuristics. Queue measurements describe modeled congestion. Physical crowd crushing, calibrated toxicity, multi-floor travel, acoustic reception and sign visibility need further modeling.

The prototype's media updates use a key entered in Setup. The Python perception service has its own API and integration path. Continuous phone observations are future integration work for this demo UI.

The evaluation log records a room-identification error. Reference-room photos and human confirmation are candidates for improving that step. Additional simulation work includes repeated crowd seeds and measured doorway-flow comparisons.

## Rehearsal

1. Load the named Malin preset and select 3D.
2. Start a simulated fire with a floor click.
3. Choose E1 as familiar and E2 as second exit, with a five-second cue.
4. Compare at 0% reception and confirm the two result columns agree.
5. Compare at 100%, inspect exit use, waiting and exposure, and switch displayed runs.
6. Explain the selected reception assumption and the model limits alongside the measured difference.

Use a rehearsed ignition location and record it for reproducibility. The result varies with fire location and settings.
