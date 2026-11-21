# AGENTS.md

The current team demo includes the Gemini-derived Malin preset, 2D/3D views, continuous crowd movement, doorway queues and matched exit-awareness replay. Launch instructions and the browser verification path are in [README.md](README.md).


Hackathon project (Gemini 4 NYC, 2026-11-21). One day. Speed to a working stage demo is the goal.

## Rules

- No tests. No TDD. No unit tests, no test files, no test frameworks, no CI.
- No build step, no bundler, no packages (one exception: the vendored three.js bundle for the 3D view). Plain HTML + JS files, opened from disk.
- Verify a change by opening `index.html` and running the demo path. That is the only check.
- DRY: one source for each fact (layout schema, cell types, row format, prompts).
- Orthogonal: one job per file. Do not mix jobs across files.
- Do not commit API keys. The key is typed into the page and stays in the tab.
- Do not add features that are not on the demo path.

## Files (one job each)

| File | Job | Must not contain |
|---|---|---|
| `layouts.js` | Preset layouts (data only). Malin Chelsea = the venue; locked exits + head counts there are assumptions | Logic |
| `sim.js` | Layout schema, fixed simulation clock, fire, smoke, routing, exposure, scoring, layout actions and legacy tile baseline | DOM, network |
| `continuous.js` | Continuous crowd steering, body/wall collisions, doorway crossing and physical queue measurements | DOM, network, renderer state |
| `analysis.js` | Many scenarios on one layout, what goes wrong (summary, risk map), changes tested on the same scenarios. Runs in Node too | DOM, network |
| `render.js` | Draw a sim on the canvas (2D) | State changes, network |
| `renderlive.js` | Live view: phone frames with the sim's smoke and fire over them, saved frames, QR to join. Same interface as `render.js` | State changes |
| `feed.js` | Talk to the feed server (`server/`): observations, frames, layout, phone link | Sim logic, DOM |
| `render3d.js` | Draw the same sim as 3D voxels (three.js). Same interface as `render.js` | State changes, network |
| `vendor/three.bundle.js` | three.js 0.170 + OrbitControls as one classic script (built with esbuild from `web/node_modules`). The only package; do not edit | Our code |
| `gemini.js` | Prompts + Gemini REST call | Sim logic, DOM |
| `crowdvisual.js` | Renderer-only pose interpolation and presentation of engine crowding | Simulation mutations, network |
| `hazardvisual.js` | Instanced procedural flames, embers, glow and smoke | Simulation mutations, network |
| `presetpicker.js` | Accessible themed layout menu | Layout logic, network |
| `assistant.js` | Agent sidebar presentation and injectable service adapter | Model requests, physics |
| `app.js` | Wire DOM events to the modules | Physics, prompts |
| `advisor.js` | Wire the Advisor tab to `analysis.js` and `gemini.js` (the agent loop) | Physics, prompts |
| `index.html`, `style.css` | Markup, look | Logic |

## Design rule

Physics and routing are code. The LLM reads (floor plan, photo or video → layout), proposes (fixes).
The LLM does not decide: `sim.js` scores each proposal with the same seed and the same fire.

Continuous crowd movement is the default. The hazard grid remains in place: crowd steps are 1/30 s and fire/smoke updates are 0.5 s. Positions use fractional cells; convert physical body radius and speed through `cellSize`. Do not impose one simulated person per cell or use the oversized cartoon heads as collision bodies. Retain the optional tile baseline and seeded, precise-time replay. Density and contact are illustrative congestion signals, not validated crush injury.
