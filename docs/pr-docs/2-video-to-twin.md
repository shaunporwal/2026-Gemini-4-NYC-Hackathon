# PR 2: Video and floor plan -> twin (Gemini multimodal)

Status: in progress

Branch: `shaun/video-to-twin`

## Goal

Show Gemini's multimodal input on stage: a phone walkthrough video of the venue (with or without a floor plan) becomes the twin, and the screen shows what Gemini saw and heard.

## Scope

In: `prototype/gemini.js`, `prototype/app.js`, `prototype/index.html`, prototype docs, this doc.
Out: `web/`, `server/`, `sim.js`, `render.js`. Managed Agent sweep. Live camera feed.

## Design

| Input (Setup dialog) | Gemini call | Result |
|---|---|---|
| Floor plan and/or video -> new twin | `layoutFromMedia` | A new layout. With both: geometry from the plan; exits, locked state, head counts from the video |
| Walkthrough video -> update this twin | `updateFromVideo` | The current layout, corrected from the video. Room rectangles stay unless the video contradicts them |

- Video and files over 15 MB go through the Gemini Files API (resumable upload, poll until `ACTIVE`). Small images and PDFs stay inline.
- Gemini returns `notes` (max 6): what it saw or heard, and where. The side panel shows them under "Gemini saw".
- The simulator validates every layout before it loads (`validateLayout`). A bad reply shows an error in the status line; the old twin stays.

## Implementation Checklist

- [x] UI: 2 file inputs in Setup (new twin; update this twin); "Gemini saw" table in the side panel
- [x] `gemini.js`: Files API upload + poll; `mediaPart` picks inline or upload
- [x] `gemini.js`: prompts for video, plan + video, and update; `notes` in the schema
- [x] `app.js`: wire both inputs; status line shows upload / processing / reading
- [x] Test with a real key: floor plan PDF -> twin. `gemini-4-hydrogen`, about 105 s, valid layout: 29 rooms, 28 doors, 4 exits, 6 notes
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

## Smoke Tests

- [x] Browser, `fetch` stubbed: video -> upload start, upload, poll, `generateContent` with a `file_data` part -> layout loads, "Gemini saw" shows 2 notes, no console errors
- [x] No key: status line shows "no API key"; twin unchanged
- [x] Page still has no scroll (pane size)
- [x] Real key: PDF -> twin loads; "Gemini saw" shows 6 notes
- [ ] Real key: the 2 video tests in the checklist
