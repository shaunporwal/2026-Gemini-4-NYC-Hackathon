# AGENTS.md

The current team demo includes the Gemini-derived Malin preset, 2D/3D views, doorway queues and matched exit-awareness replay. Launch instructions and the browser verification path are in [README.md](README.md).


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
| `sim.js` | Layout schema, fire, smoke, routing, people, crowd crush and falls, timed events, scoring, layout actions | DOM, network |
| `analysis.js` | Many scenarios on one layout, what goes wrong (summary, risk map), changes tested on the same scenarios. Runs in Node too | DOM, network |
| `render.js` | Draw a sim on the canvas (2D) | State changes, network |
| `renderlive.js` | Live view: phone frames with the sim's smoke and fire over them, saved frames, QR to join. Same interface as `render.js` | State changes |
| `feed.js` | Talk to the feed server (`server/`): observations, frames, layout, phone link, the agent (streamed) | Sim logic, DOM |
| `render3d.js` | Draw the same sim as 3D voxels (three.js). Same interface as `render.js` | State changes, network |
| `vendor/three.bundle.js` | three.js 0.170 + OrbitControls as one classic script (built with esbuild from `web/node_modules`). The only package; do not edit | Our code |
| `gemini.js` | Prompts + Gemini REST call | Sim logic, DOM |
| `crowdvisual.js` | Renderer-only movement interpolation and local crowding | Simulation mutations, network |
| `assistant.js` | Agent sidebar presentation and injectable service adapter | Model requests, physics |
| `app.js` | Wire DOM events to the modules | Physics, prompts |
| `advisor.js` | Wire the Advisor tab and the assistant chat to `analysis.js` and the server agent (via `feed.js`) | Physics, prompts, API keys |
| `index.html`, `style.css` | Markup, look | Logic |

## Design rule

Physics and routing are code. The LLM reads (floor plan, photo or video → layout), proposes (fixes).
The LLM does not decide: `sim.js` scores each proposal with the same seed and the same fire.
