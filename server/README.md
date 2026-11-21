# server/ (owner: TBD, same person as web/src/feed)

This service handles phone camera/audio perception. The current Fire Twin UI performs its Gemini media requests directly from the browser using the Setup key. See [the current Fire Twin demo guide](../prototype/README.md) for launching the Malin scene and matched awareness replay.

Python/FastAPI. **Owns the Gemini API key.** Phone cameras in, `Observation`s out (`docs/CONTRACTS.md`).
It never runs the simulation.

```
phone /camera?id=cam-hall-ne ──JPEG ~1/s──► POST /frame/{cameraId} ─► worker per camera
                             ──WAV 2 s────► POST /audio/{cameraId}      │ Decisions API every frame
                                                                        │ (incl. a fast count range: 0,1,2,3,4-5,6-9,10+)
                                                                        │ Hydrogen in the background: range changes, or every 3 s
browser (web/src/feed) ◄──── WebSocket /ws ◄── Observation ◄────────────┘
```

## Two modes
| Mode | Set | Phones pick | Observation gets |
|---|---|---|---|
| **Room (default)** | `VENUE=malin` (a preset in `prototype/layouts.js`, read with Node) or `VENUE=path/to/layout.json` | A **room** of the prototype layout. No camera pose, no room guessing | `room` (the room name), `peopleCount`, `exits[].id` for exits on that room's walls. No floor positions: the prototype places a room's count inside the room |
| Grid | `MAP=../web/public/maps/demo-hall.json` (and `VENUE=`) | A posed camera from the v2 map | `people` floor positions in cells, `exits[].cells` |

Room mode feeds Shaun's prototype directly:
`FireSim.applyObservation(layout, {rooms: [{name: o.room, people: o.peopleCount}], openings: o.exits.map(e => ({id: e.id, locked: e.blocked}))})`.
Several phones = several rooms at once (tested: 3 rooms in parallel, about 0.5–0.9 s per update each). One phone per room;
two phones in one room would overwrite each other's count.

## Run
```bash
cd server
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # macOS/Linux: .venv/bin/python
echo GEMINI_API_KEY=... > .env                               # gitignored
.venv/Scripts/python -m uvicorn app:app --host 0.0.0.0 --port 8000 --env-file .env
```
Room mode needs Node.js on the PATH (it reads `prototype/layouts.js`).
Phones only allow the camera over **HTTPS**, so tunnel it (this also gets around venue Wi-Fi blocking device-to-device traffic):
```bash
cloudflared tunnel --url http://localhost:8000     # or: ngrok http 8000
```
On each phone open `https://<tunnel>/camera` and pick the camera it is (ids come from the map), or go straight to
`/camera?id=cam-hall-ne`. Options: `&ms=1000` (frame interval), `&w=640` (upload width), `&clip=2` (audio seconds).
Point the phone the way the map camera points: the projection uses the map's `position`, `orientation` and `lens`.

Quick check with one still image:
```bash
curl -X POST --data-binary @test.jpg -H "Content-Type: image/jpeg" localhost:8000/frame/cam-entrance
curl localhost:8000/observations
```

## Models (one job each; entry rule: DECISIONS #19)
| Model | Env var | Job | When |
|---|---|---|---|
| Decisions API `gemini-decision-1` | `DECISION_MODEL` | Calibrated yes/no, score and choice answers: people present, a count range (0, 1, 2, 3, 4–5, 6–9, 10+), density 0–4, fire/smoke, exit blocked (only if the camera sees an exit). Audio clips: alarm / screaming | Every frame, every clip |
| Gemini 4 Hydrogen `gemini-4-hydrogen` | `VISION_MODEL` | Head count, each person's foot point in the image, one-line scene summary | In the background (one call per camera at a time): someone appears, Decisions' count range changes, or every `HEARTBEAT_S`. A change during a call re-counts the newest frame as soon as it finishes |

`THINKING=low` sets Hydrogen's `thinking_level` (`minimal` is rejected by Hydrogen; low media resolution is not faster).
All model calls are in `perception.py`. Measured: Decisions about 0.3–0.7 s, Hydrogen 2.5–4.5 s, first call after start 10–20 s (hence `WARMUP`).
Each frame gives a fast Observation from Decisions; a second Observation follows when a background re-count finishes.

## Endpoints
| Endpoint | What |
|---|---|
| `POST /frame/{cameraId}` | JPEG body. Only the newest frame per camera is processed; stale ones are dropped. |
| `POST /audio/{cameraId}` | 16 kHz mono WAV body (`camera.html` makes it; the API doesn't take webm). |
| `WS /ws` | Server → browser: `{"type":"observation","observation":Observation}` after each frame, plus the latest per camera on connect. Browser → server: `{"type":"cameras","cameras":CameraDef[]}` after a camera is moved, so positions and visible exits use the new pose. |
| `GET /observations` | Snapshot `{t, map, mode, observations: {cameraId: Observation}}`. For debugging, or for a client that polls. |
| `GET /camera`, `GET /` | Phone page; index of the map's cameras. |
| `GET /debug?id=<cameraId>` | **Laptop only** (refused through the tunnel). The last frame Hydrogen counted, with a numbered dot on each person it found, its count, the count shown now and Decisions' range. Kept in memory only, one frame per camera. |

Switching the browser from WebSocket to polling (or back) is a client-side change only: both carry the same `Observation`.

## How an Observation is filled
| Field | Source |
|---|---|
| `peopleCount` | Hydrogen's exact count. Within about 1 s of a change it shows the edge of Decisions' range instead, when Decisions is ≥ `COUNT_CONF` sure the old count is wrong (or there is no count yet for this scene); `people` is then empty until Hydrogen catches up |
| `summary` | Hydrogen |
| `people` | Hydrogen foot points → ray from the map camera pose → floor plane → cells (`geometry.py`). Approximate (no lens model); snap to walkable cells in the browser |
| `density` | Decisions crowding score rounded: empty, sparse, moderate, crowded, packed |
| `hazards`, events `fire`/`smoke` | Decisions, raised only after `HAZARD_STREAK` frames at ≥ `HAZARD_CONF` |
| `exits`, event `exit_blocked` | Exits = groups of touching `E` cells inside the camera's cone with line of sight. Blocked when P ≥ `EXIT_BLOCKED_P`. If a camera sees two exits, one answer covers both |
| events `alarm`/`screaming` | Decisions on the last audio clip, kept for `AUDIO_TTL_S` |
| `stream` | Latency, frame and call counts, last error |

## Flags
| Env | Default | What |
|---|---|---|
| `MAP` | `../web/public/maps/demo-hall.json` | Map whose cameras and exits are used |
| `BASELINE=1` | 0 | Hydrogen on every frame, no gating (the comparison baseline) |
| `HEARTBEAT_S` | 3 | Max seconds between re-counts while people are present (measured from the last one finishing) |
| `COUNT_CONF` | 0.7 | Decisions' count range overrides a stale Hydrogen count at this confidence |
| `WARMUP` | 1 | One call per model at startup, so the first phone frame isn't a cold start |
| `HAZARD_CONF` / `HAZARD_STREAK` | 0.7 / 2 | Hazard needs this confidence on N frames in a row |
| `EXIT_BLOCKED_P` | 0.6 | Probability threshold for an exit to count as blocked |
| `AUDIO_CONF` / `AUDIO_TTL_S` | 0.7 / 10 | Audio event threshold and how long it stays in `events` |
| `SAVE_FRAMES=1` | 0 | Save frames + predictions to `eval_frames/` (eval sessions only, **off for the demo**) |

## Not verified yet (check first against the real API)
- Decisions inline image: sent as base64 `data` in an `"type":"image"` block (the SDK types allow it; the docs only show `uri` for images).
- Decisions audio block (`"type":"audio"`, `audio/wav`).
- Hydrogen with image input and `thinking_level`. Fallbacks: `THINKING=""`, or `VISION_MODEL=gemini-4-carbon`.
- Whether `gemini-decision-1` counts as a Gemini 4 model for the entry rule.

## Rules
- Privacy: no face recognition; the summary never identifies people. Frames are not stored unless `SAVE_FRAMES=1` during eval. `/debug` holds the last counted frame per camera in memory and only answers on localhost.
- No real smoke or fire indoors: the fire test uses a tablet playing a fire video.
- Keep a failure log for the pitch: what broke, what changed, numbers before and after.

## Breaking point (gated vs baseline)
```bash
ffmpeg -i clip.mp4 -vf fps=1,scale=640:-1 sample_frames/%04d.jpg   # frames from a phone video
rm -f metrics.csv
for n in 1 3 6 10; do python simulate_streams.py --streams $n --seconds 60; done
python summarize_metrics.py        # → breaking_point.csv for the chart
```
Repeat with `BASELINE=1` (restart the server). If streams pile up: lower `w`, raise `ms`, or raise `HEARTBEAT_S`.
`metrics.csv` rows are `kind=frame` (frame → Observation) or `kind=hydrogen` (frame → new count).

## Accuracy eval (held-out frames nobody tuned on)
`labels.csv` in the folder: `file,count,hazard,exit_blocked`. Then
`python eval_counts.py --folder holdout_frames --labels holdout_frames/labels.csv` →
headcount MAE and ±1 accuracy (baseline vs gated), hazard false alarms and misses, `eval_results.csv`.

## Files
| File | Job |
|---|---|
| `app.py` | FastAPI app, camera workers, gating, Observation building, WebSocket |
| `perception.py` | All Gemini calls and prompts |
| `geometry.py` | Map JSON → cameras and exits; image → floor projection |
| `camera.html` | Phone page: frames + WAV clips |
| `debug.html` | Debug view: what Hydrogen counted |
| `simulate_streams.py`, `summarize_metrics.py`, `eval_counts.py` | Stress test and eval |
| `EVAL.md` | Headcount eval results (Hydrogen vs Carbon on real frames) |
| `FAILURE_LOG.md` | What broke, what changed, numbers before and after (for the pitch) |
| `test.jpg` | Synthetic test frame (drawn figures, not a real photo) |
