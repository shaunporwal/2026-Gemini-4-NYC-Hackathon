# Fire Evacuation Digital Twin

A live voxel digital twin of a building. Cameras feed real crowd density into the model
(interpreted by Gemini, from video and audio). **Tap anywhere to start a fire** and see how the
crowd would evacuate: fire and smoke spread, bottlenecks, trapped people, casualties. Then change
the layout and compare the outcomes, **before a real emergency happens**.

Built at the Gemini NYC Hackathon (2026-11-21).

## Open the current Fire Twin

The team demo lives in `prototype/index.html`. It includes the Malin Chelsea model, 2D and 3D views, doorway queues, exit awareness, and matched crowd replays.

From the repository root, serve the current checkout.

```bash
python3 -m http.server 5174 --bind 127.0.0.1 --directory prototype
```

Open http://127.0.0.1:5174/. Select **The Malin Chelsea (Gemini, from the floor plan PDF)**, then click **3D**. The page title is **Fire Twin** and the panel includes **Learn a second exit** and **Doorway queues**.

If port 5174 is occupied, stop the old server or choose another port and open that port. A server serves the checkout from which it was started. After pulling or switching worktrees, restart it from the intended checkout and reload the page. The app starts with the approximate Malin layout and the 2D view on a fresh load, so select the layout and view above.

Opening `prototype/index.html` directly also runs the simulation. Gemini media, announcement and proposal actions use the API key entered in **Setup**, stored in the browser tab.

## Demo

1. Click a floor cell to ignite the simulated fire.
2. Inspect **Doorway queues** for queue size, waiting time and smoke exposure.
3. Under **Learn a second exit**, choose two unlocked exits, set **Announce after (s)** and **Receive cue (%)**, then click **Compare same crowd**.
4. Switch **Show in 3D / 2D** between **Familiar exit only** and **With announcement**. Both runs use the same crowd placement, reaction delays, layout and fire settings.
5. Compare people out, still inside, down, exit usage, total queue waiting and queued smoke exposure. Purple heads mark people who learned the second exit.

See [the demo guide](prototype/README.md) for controls, assumptions and measurement definitions.

## Repository components

| Component | Purpose | Launch |
|---|---|---|
| `prototype/` | Current Fire Twin demo with Gemini media input and comparison UI | Command above |
| `web/` | TypeScript grid-map and camera development app, using an adapter to the shared simulation engine | `cd web && npm install && npm run dev`, normally port 5173 |
| `server/` | Phone camera/audio perception service and observation API | [Backend guide](server/README.md) |

The TypeScript app opens a grid-map scene with its own controls. Use `prototype/` to reproduce the current Malin Fire Twin demo. Its rectangle layout format and the TypeScript schema-v2 grid format are documented in [MAP_SCHEMA.md](docs/MAP_SCHEMA.md).

## Docs
| Doc | What's in it |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Problem, users, demo flow, scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data flow, tick loop, ownership of state |
| [docs/MAP_SCHEMA.md](docs/MAP_SCHEMA.md) | Map JSON format and coordinate system |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Shared TypeScript types: the contract between modules |
| [docs/PLAN.md](docs/PLAN.md) | Owners, 6-hour timeline, git workflow, open questions |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made so far |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Session handoff: prototype status, Gemini facts, next steps, stage script |
| [docs/The_Malin_Chelsea_Floor_Plan.pdf](docs/The_Malin_Chelsea_Floor_Plan.pdf) | Venue floor plan (input for the Malin layout) |
| [specs/](specs/README.md) | TLA+ state-machine model of the phone page: 3 faults found and fixed |
| [docs/EVAL.md](docs/EVAL.md) | Evaluation log: real inputs, timings, failures, changes |
| [docs/pr-docs/](docs/pr-docs/README.md) | One planning doc per PR |
| [CLAUDE.md](CLAUDE.md) | Rules for coding agents (and a good summary for humans) |

## Layout
```
docs/     project docs          schemas/  map JSON Schema
web/      browser app + sim     server/   Gemini live-feed backend
prototype/  standalone plain-JS demo (open index.html, no build)
```
