# Team Plan (6 hours, 4 people)

## Current delivery status

The team demonstration runs from `prototype/` using [the root quick start](../README.md#open-the-current-fire-twin). Ruhan's simulation work includes crowd movement, doorway queue measurements, exit awareness and matched replay. Shaun's media-to-twin work and 3D view are integrated there.

The tables below retain the original TypeScript work allocation and kickoff schedule. The grid-map app also runs the shared engine through `web/src/crowd/voxelSimulation.ts`. Remaining integration work includes live observations into the demonstrated UI and broader evaluation.


## Ownership
Each module has **one owner**. Others may read it and open small PRs, but the owner merges.

| Area | Folder(s) | Owner |
|---|---|---|
| Map architecture: schema, cell registry, loader, cameras + visible cells | `web/src/map`, `schemas/`, `web/public/maps` | Jacob |
| three.js voxel renderer | `web/src/render` | _three.js teammate_ |
| Fire + smoke model | `web/src/fire` | _TBD_ |
| Crowd agents + stats | `web/src/crowd`, `web/src/stats` | _TBD_ |
| Gemini live-feed backend + client | `server/`, `web/src/feed` | _TBD_ |
| UI / HUD / demo polish | `web/src/ui` | shared |
| Contracts (`docs/CONTRACTS.md` → `shared/types.ts`), docs | `web/src/shared`, `docs/` | everyone, announce changes |

## Timeline (relative to kickoff)
| Time | Milestone |
|---|---|
| **0:00–0:30** | Read `docs/`, agree on `docs/CONTRACTS.md`, set up `web/` (Vite + TS + three.js) and copy the contracts into `shared/types.ts`. **Contracts frozen** after this (changes must be announced). |
| **0:30–2:30** | Parallel build. Each module works against the demo map + mocks: fire can run with no agents; crowd can run with no fire; feed can be mocked with `mockObservations`. |
| **2:30** | **Integration checkpoint #1** — everything on `main`, one tap ignites a fire and agents run. |
| **2:30–4:30** | Feature work: live feed → agents, bottlenecks, casualties, compare scenarios, camera gizmos. |
| **4:30** | **Feature freeze.** Only bug fixes and polish. |
| **4:30–5:30** | Demo script rehearsal, record a backup video, tune fire/crowd params for drama. |
| **5:30–6:00** | Buffer + submission. |

## Mocks so nobody is blocked
- No live feed yet → `feed/` exposes a mock that emits fixed `Observation`s per camera.
- No fire yet → crowd tests with a hand-set `state.fire` patch.
- No renderer yet → systems can log `StatsSnapshot` to the console.

## Git workflow
- Verify the current `prototype/` demo in the browser before publishing. For `web/` changes, also run its build. Pull often.
- Short-lived branches: `<name>/<feature>` (e.g. `jacob/camera-cones`). Small PRs or direct
  pushes to `main` for tiny, self-contained changes inside your own folder.
- Commit messages: `area: what changed` (e.g. `map: add visible-cell raycast`).

## Open questions
- [ ] Fire/smoke model details and casualty rule (fire owner)
- [x] Exact `Observation` payload + update rate from Gemini (feed owner): `docs/CONTRACTS.md`, `server/README.md`
- [ ] How live counts reconcile with existing agents (spawn/remove vs. adjust) (crowd + feed)
- [x] Current demo venue is the Gemini-derived Malin preset in `prototype/layouts.js`.
- [x] Server language (Python vs. Node) (feed owner): Python, DECISIONS #23
- [ ] Who builds floor plan photo → map JSON (schema v2), and with which Gemini 4 model (DECISIONS #20)
- [ ] Confirm `gemini-decision-1` counts toward the two-Gemini-4-models rule; if not, Carbon for the floor plan covers it
