# AGENTS.md

Hackathon project (Gemini 4 NYC, 2026-11-21). One day. Speed to a working stage demo is the goal.

## Rules

- No tests. No TDD. No unit tests, no test files, no test frameworks, no CI.
- No build step, no bundler, no packages. Plain HTML + JS files, opened from disk.
- Verify a change by opening `index.html` and running the demo path. That is the only check.
- DRY: one source for each fact (layout schema, cell types, row format, prompts).
- Orthogonal: one job per file. Do not mix jobs across files.
- Do not commit API keys. The key is typed into the page and stays in the tab.
- Do not add features that are not on the demo path.

## Files (one job each)

| File | Job | Must not contain |
|---|---|---|
| `layouts.js` | Preset layouts (data only). Malin Chelsea = the venue; locked exits + head counts there are assumptions | Logic |
| `sim.js` | Layout schema, fire, smoke, routing, people, scoring, layout actions | DOM, network |
| `render.js` | Draw a sim on the canvas | State changes, network |
| `gemini.js` | Prompts + Gemini REST call | Sim logic, DOM |
| `app.js` | Wire DOM events to the modules | Physics, prompts |
| `index.html`, `style.css` | Markup, look | Logic |

## Design rule

Physics and routing are code. The LLM reads (photo → layout), speaks (PA text) and proposes (fixes).
The LLM does not decide: `sim.js` scores each proposal with the same seed and the same fire.
