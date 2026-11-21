# HANDOFF: Fire Twin

Context for a new session. Written 2026-11-21 11:35 EST. Read `AGENTS.md` first (rules), then this file.

Note (added on import): the prototype files named below (`AGENTS.md`, `index.html`, `*.js`, `style.css`) are in `prototype/`. Section 4's UI description is older than the one-screen rework: see `docs/pr-docs/`.

## 1. Situation

- Event: Gemini 4 NYC Hackathon (Cerebral Valley + Google DeepMind). Sat 2026-11-21, 09:00–22:00 EST. In person.
- Venue: The Malin Chelsea, 270 7th Ave, New York. Floor plan: `docs/The_Malin_Chelsea_Floor_Plan.pdf`.
- Repo: https://github.com/shaunporwal/2026-Gemini-4-NYC-Hackathon (empty at 11:27). Nothing is pushed yet.
- Goal: fun + a wow moment on stage. Not a product.
- Prizes: 1st $7,500 · 2nd $5,000 · 3rd $2,500 · Best use of Managed Agents $5,000 · Best use of Shopify $2,500 (Shop Cash).
- Judging line from the organizers: "something that wasn't possible last week."
- Unknown, ask the organizers: submission cutoff, demo length.

## 2. Idea

Fire safety digital twin. Floor plan → twin → live fire + evacuation → LLM proposes a fix → simulator proves it.

**Wow moment:** the judges' own room burns on screen, and a judge picks where the fire starts.

## 3. Design decisions (do not change without a reason)

Rule: **physics = code. LLM = eyes, language, orchestration. Decisions = optimizer; the LLM proposes only.**

| Job | Who does it | Why |
|---|---|---|
| Fire + smoke spread | Code (cellular automaton, diffusion) | Must be the same each run. FDS is too heavy for 1 day. |
| Routing | Code (Dijkstra field from open exits, cost = smoke + fire proximity) | ms, deterministic, testable |
| Floor plan → layout JSON | Gemini (multimodal) | No parser exists |
| PA announcement text | Gemini (template fallback with no key) | Language |
| Fix proposals | Gemini + brute-force search | LLM proposes, sim scores each one with the same seed + same fire |
| Scenario sweep (100s of fires, worst cases, report) | Managed Agent. NOT BUILT | Targets the $5,000 prize |
| Learned policy (RL) | Not today. Roadmap line only. | Needs training time |

Answer for the judges to "why not let the LLM decide?": latency, non-determinism, no guarantee. The sim is the referee.

Cut on purpose: 3D, video input, persona occupants, code compliance (NFPA 101), sensor feeds.

## 4. What is built

Plain HTML + JS. No build, no packages, no tests (see `AGENTS.md`). Open `index.html` from disk.

| File | Job |
|---|---|
| `layouts.js` | Preset layouts, data only: `malin` (venue, default), `demo` (generic) |
| `sim.js` | Layout schema + validation, fire, smoke, routing, people, scoring (`run`), layout actions (`applyAction`) |
| `render.js` | Canvas view. Reads state only. |
| `gemini.js` | Prompts + REST call: `layoutFromPhoto`, `announce`, `proposeFixes`, `fallbackAnnouncement` |
| `app.js` | Wires DOM events to the modules |
| `index.html`, `style.css` | Markup, look |

Model: 1 cell = 1 m, 1 tick = 0.5 s. Default fire spread 0.08 (slider). Seed 7. People move 1 cell per 2 ticks, half speed in smoke, go down at a smoke dose limit.

UI: click floor = fire. Click door/exit = lock/unlock (red = locked). Buttons: Pause/Resume, Reset, Replay same fire, Find fix, Apply best + replay. Tables: fix candidates, runs. Side panel: API key (stays in the tab), model ID, floor plan file input (image or PDF), layout JSON.

## 5. Status

Verified (headless Chrome, no console errors):

| Layout | Fire start | Baseline lost | Best fix | Lost after |
|---|---|---|---|---|
| Malin | 26th St Foyer (cell 69,41) | 34 of 333 | Unlock X1 | 3 |
| Generic | Corridor centre (30,28) | 87 of 240 | Unlock E3 | 7 |

Also verified: same seed + same fire = same result. In the generic layout, a fire in the centre of the Main Hall makes "Unlock E3" worse than no change (good line: the obvious fix can be wrong).

NOT verified (no key and no network in the build session):

- All 3 Gemini calls. Test these first.
- Model ID `gemini-4-hydrogen` and the `v1beta/models/{model}:generateContent` endpoint for Gemini 4.
- PDF input through `inline_data` with `application/pdf`.
- Gemini latency for PA text. If slow: clear "Gemini writes the PA text" (template is instant).
- Browser speech on the stage machine.

Assumptions in the Malin layout (correct them):

- Rooms are hand-traced rectangles. Scale is a guess.
- Street doors W1 (7th Ave), S1 + S2 (26th St) follow the plan.
- X1 (Event Bar service door) and X2 (office wing stair) are INVENTED. The plan shows no stairs or fire exits. Find the real ones in the building and edit `layouts.js`. Do not present X1 as real before that.
- Head counts are guesses (Event Hall = 150).

## 6. Gemini facts (web search, 2026-11-21; verify at the venue)

- Gemini 4 family: Argon (general), Carbon (strongest, slowest), Neon (between Hydrogen and Carbon, released 2026-11-18), Hydrogen (fast, cheap).
- API IDs seen: `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`. 1M-token context.
- Suggested use: Hydrogen for PA text; Carbon or Neon for floor plan → layout and fix proposals.
- Managed Agents: Interactions API, 1 call = Linux sandbox that runs code and manages files. Docs: https://ai.google.dev/gemini-api/docs/agents . The docs found list Gemini 3.x Flash models only; Gemini 4 inside Managed Agents is not confirmed.

## 7. Next steps (in order)

1. Push these files to the repo (first task for the new session).
2. Get an API key. Test PA text, Find fix with Gemini, then PDF → layout. Fix the model ID / endpoint if they fail.
3. Walk the venue. Put the real exits and stairs in `layouts.js`.
4. Save the best Gemini layout from the PDF as a preset (cache for the stage).
5. Rehearse the stage script 3×.
6. Only then: Managed Agent sweep. `sim.js` runs in Node (`require('./sim.js')`, `require('./layouts.js')`), so an agent can call `run(layout, ignitions, opts)` for each start cell, rank the worst fires, and write a report. Run it before the demo; show the result as a heatmap, not live.

Time plan agreed at 11:10: sim done by 13:00 (done at 11:30), live photo step by 15:00, PA + fix by 16:30, freeze 17:00, then rehearse. Pad all estimates ×1.5–2.

## 8. Stage script (about 2 min)

1. "This is the room you are in." Drop the venue PDF in → twin appears. (Fallback: preset.)
2. A judge picks a point. Click. Fire and smoke spread; dots move; the PA voice speaks.
3. Fire in the 26th St Foyer: both street doors blocked, the Event Hall goes the long way. Read the "Lost" number.
4. Find fix. Gemini + search propose; the table shows the sim score for each.
5. Apply best + replay. Same fire. Lost 34 → 3.
6. One line: "The LLM proposes. The simulator decides."

## 9. Stage safety

- The sim runs with no network. Only the 3 Gemini steps use the API.
- Do not commit the API key.
- Keep the preset as the fallback for step 1.

## 10. Notes

- The build session could not push: no GitHub write access to the repo. Fix: install the Claude GitHub App on the repo, or reconnect GitHub in Claude settings.
- An in-lane variant was discussed and dropped for today: chemical lab fire twin (SDS → fuel + incompatibility per storage location). The user chose fun over lane. Do not raise it again.
- User style: ASD-STE100, short, tables, absolute dates, mark unverified facts with (?).
