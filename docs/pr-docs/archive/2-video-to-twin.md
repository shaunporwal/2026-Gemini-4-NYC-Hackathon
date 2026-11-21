# PR 2: Video and floor plan -> twin (Gemini multimodal) + 3D voxel view

Implementation is merged. This document records the original PR scope and checks. For the current UI including queues and awareness replay, use [the demo guide](../../prototype/README.md).


Status: done

Branch: `shaun/video-to-twin`

## Goal

Show Gemini's multimodal input on stage: a phone walkthrough video of the venue (with or without a floor plan) becomes the twin, and the screen shows what Gemini saw and heard.

## Scope

In: `prototype/gemini.js`, `prototype/app.js`, `prototype/index.html`, `prototype/render3d.js`, `prototype/vendor/`, `prototype/layouts.js`, prototype docs, this doc. Also merges `main` (Jacob's `web/` map + voxel scene) into the branch.
Out: changes to `web/`. (Scope grew during the day: `server/` is now adapted and run; `sim.js` gained `applyObservation` and furniture as obstacles + fuel.) Managed Agent sweep. Live camera feed.

## Design

| Input (Setup dialog) | Gemini call | Result |
|---|---|---|
| Floor plan and/or video -> new twin | `layoutFromMedia` | A new layout. With both: geometry from the plan; exits, locked state, head counts from the video |
| Room photo or video -> update this twin | `observe` + `applyObservation` | Gemini finds which room of the current layout the input shows and returns a small patch: head count, floor and wall colors, furniture, blocked doors, notes. Code applies the patch; geometry does not change |

- Video and files over 15 MB go through the Gemini Files API (resumable upload, poll until `ACTIVE`). Small images and PDFs stay inline.
- Gemini returns `notes` (max 6): what it saw or heard, and where. The side panel shows them under "Gemini saw".
- The simulator validates every layout before it loads (`validateLayout`). A bad reply shows an error in the status line; the old twin stays.

### 3D view

- A 3D / 2D button in the header switches the view of the same running sim. `render3d.js` has the same interface as `render.js`.
- The look is ported from `web/src/render/scene.ts` (one instanced box per cell, voxel people). The `web/` app is not embedded: it is TypeScript + Vite and has no fire or crowd sim yet.
- Layout gains optional `wallColor`, room `color` and `objects` (furniture). The Gemini prompts ask for them from a video, so the 3D view looks like the room.

## Implementation Checklist

- [x] UI: 2 file inputs in Setup (new twin; update this twin); "Gemini saw" table in the side panel
- [x] `gemini.js`: Files API upload + poll; `mediaPart` picks inline or upload
- [x] `gemini.js`: prompts for video, plan + video, and update; `notes` in the schema
- [x] `app.js`: wire both inputs; status line shows upload / processing / reading
- [x] Test with a real key: floor plan PDF -> twin. `gemini-4-hydrogen`, about 105 s, valid layout: 29 rooms, 28 doors, 4 exits, 6 notes
- [x] 3D voxel view of the live sim (fire, smoke, people, locked doors), orbit + zoom, click to ignite; 3D / 2D toggle
- [x] Layout: optional `wallColor`, room `color`, `objects`; Gemini prompts ask for them
- [ ] Test with a real key: does Gemini return colors and objects from a video, and do they look right in 3D
- [x] Room photo -> update this twin (patch reply, not a whole layout). Real key, photo of a hackathon room: 42 s, matched "Central Lounge & Dedicated Desks", 13 people, 19 furniture items, 5 notes
- [x] Ground truth for that photo: West Booth Lounge. Gemini's room match was WRONG in every variant tested (see `docs/EVAL.md`)
- [x] Decisions API (`gemini-decision-1`) called from the browser: works, about 1 s, room choice + crowd level + blocked exit in 1 call (test only, not in the app yet)
- [x] 2 Gemini 4 models, 1 job each: Hydrogen (photos, PA; thinking low) and Neon (floor plan, fixes). Photo update: 42 s -> 9 s
- [ ] Room match with reference photos (enrolment), then put Decision 1 in the app as the fast first step
- [x] Perception server (Elijah, `server/`) runs on the demo Mac with the real key: Decisions 1.4 s + Hydrogen 6.2 s on the test photo. Key and floor plan come from the twin page (local requests only)
- [x] Twin listens to the server: "Live camera" table, head count per room before the fire, a camera that sees fire starts the fire (switch in Setup; not tested with real footage)
- [x] Phone page rebuilt: floor plan with a key number on every room + list, camera starts on confirm, one-photo fallback; tunnel (cloudflared) gives phones HTTPS
- [x] TLA+ model of the phone page (`specs/`): 3 timing faults found and fixed with a session number
- [x] Real iPhone streamed frames (Event Bar & Pre-Function, West Booth Lounge); frames saved on the demo Mac in `server/eval_frames/`
- [x] Live view on the twin (phone frames + the sim's smoke and fire), saved frames you can pick, QR to join; stable public address (Tailscale Funnel); Camera / Twin switch; a phone copy of the twin follows the presenter's layout
- [x] Camera frames inform the simulation: Gemini reads the newest frame of a known room (furniture, colors, notes) and the furniture goes into the physics: people walk around it, it burns faster. Tested with a real phone frame: 14 items in West Booth Lounge
- [x] Sound: the server's alarm detection works (synthetic alarm: "alarm", 0.84, 0.9 s) and an alarm heard by a phone starts the fire in that room. Phone microphone fix (audio context made inside the tap) NOT yet confirmed on a real iPhone
- [x] TLA+ models: phone page, linked chain, app flow with a no-dead-end check (`specs/`)
- [ ] Real iPhone: microphone clips arrive; several phones at once
- [ ] Evidence table: same fire on the plan-only twin and on the camera-informed twin
- [ ] Test with a real key: walkthrough video -> update this twin
- [ ] Test with a real key: plan + video -> new twin
- [ ] Record the venue walkthrough (30-60 s, show each door and exit)
- [x] Gemini's floor plan result saved as preset `malinGemini` in `layouts.js` (stage fallback, with its notes)
- [ ] Walk the venue: check exits E3 (NW stair) and E4 (central core) in `malinGemini`, and X1, X2 in `malin`
- [x] Hackathon API resources found in email (2026-11-21): a hackathon Google account from Google DeepMind for ai.dev (credentials stay in email, never in the repo); models Argon, Carbon, Neon, Hydrogen
- [x] Hackathon account signed in at AI Studio; its "Workshop API key" is in use (project on Tier 3)

## Known Limits

- Verified with a real key (2026-11-21): model IDs `gemini-4-argon|carbon|neon|hydrogen`, the `v1beta` endpoint, inline PDF input, PA text.
- Still unverified: Files API from a browser (CORS, the `x-goog-upload-url` header), any video call, video size and length limits, Find fix with Gemini.
- Floor plan -> twin took about 105 s: too slow to run live on stage. Use the `malinGemini` preset on stage, or start the call before the pitch.
- In `malinGemini`, exits E3, E4 and all head counts are Gemini's reading of the plan, not checked against the building.
- Geometry from video alone will be rough. The safe stage path is plan + video, or "update this twin".
- The API key is typed into the page. Root `CLAUDE.md` says Gemini is only called from `server/`; that rule covers `web/`, and this prototype does not follow it.
- Setup dialog is taller than a 390x664 phone screen now; it scrolls inside with no scroll bar.

- Furniture positions are Gemini's estimate from 1 frame: rough. If furniture would wall people in, the sim drops it for that run and says so.
- Head counts from the fast model move a lot between frames of the same room (2, 6, 12, 13 seen).
- With the Setup switch on, any alarm-like sound or fire-like picture starts a fire: a false alarm on stage is possible.
- 3D colors and furniture from a real Gemini reply were tested with 1 photo only. `wallColor` from 1 room colors the walls of the whole building.
- Room matching from room names alone fails (1 of 1 photo wrong, with confidence 0.57-0.71).
- Neon for floor plan -> twin and for fix proposals is untested.
- 3D is not checked at phone size or against the UI rules audit.
- `web/` and `prototype/` still use 2 map formats; no converter yet.

## Smoke Tests

- [x] Browser, `fetch` stubbed: video -> upload start, upload, poll, `generateContent` with a `file_data` part -> layout loads, "Gemini saw" shows 2 notes, no console errors
- [x] No key: status line shows "no API key"; twin unchanged
- [x] Page still has no scroll (pane size)
- [x] Real key: PDF -> twin loads; "Gemini saw" shows 6 notes
- [x] 3D: Gemini floor plan preset renders; hand-added colors + furniture render; click starts a fire; run completes (267 out, 26 lost); orbit and zoom work; no console errors; page has no scroll
- [ ] Real key: the 2 video tests in the checklist
