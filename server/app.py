"""
Gemini live-feed server: phone cameras in, Observations out (docs/CONTRACTS.md).

Phones POST JPEG frames (and short WAV clips) -> one worker per camera -> Decisions API on every
frame (incl. a fast count range) -> Hydrogen in the background when the range changes or on a heartbeat -> Observation to every
browser on the WebSocket /ws. Camera ids and poses come from the map JSON (MAP env var).

Run:   uvicorn app:app --host 0.0.0.0 --port 8000
Phone: https://<your-tunnel>/camera?id=cam-hall-ne

Env flags:
  VENUE=malin     room mode (default): a preset in prototype/layouts.js or a layout .json; one phone per room
  MAP=...json     grid mode instead: a schema-v2 map with posed cameras (positions in cells)
  BASELINE=1      Hydrogen on every frame, no Decisions gating (the comparison baseline)
  HEARTBEAT_S=3   re-count at least this often while people are present
  COUNT_CONF=0.7  Decisions' count range overrides a stale Hydrogen count at this confidence
  WARMUP=1        one call per model at startup (avoids the cold-start first frame)
  SAVE_FRAMES=1   save frames + predictions to eval_frames/ (eval sessions only; off for the demo)
"""
import asyncio
import csv
import json
import math
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import agent as AG
import perception as P
from geometry import MapInfo, VenueInfo, jpeg_aspect, load_venue

HERE = Path(__file__).parent
MAP_PATH = Path(os.getenv("MAP", HERE.parent / "web" / "public" / "maps" / "demo-hall.json"))
BASELINE = os.getenv("BASELINE", "0") == "1"
HEARTBEAT_S = float(os.getenv("HEARTBEAT_S", "3"))
COUNT_CONF = float(os.getenv("COUNT_CONF", "0.7"))  # trust Decisions' count range over a stale Hydrogen count above this
WARMUP = os.getenv("WARMUP", "1") == "1"
SAVE_FRAMES = os.getenv("SAVE_FRAMES", "0") == "1"
HAZARD_CONF = float(os.getenv("HAZARD_CONF", "0.7"))
HAZARD_STREAK = int(os.getenv("HAZARD_STREAK", "2"))  # consecutive frames before we raise a hazard
EXIT_BLOCKED_P = float(os.getenv("EXIT_BLOCKED_P", "0.6"))
AUDIO_CONF = float(os.getenv("AUDIO_CONF", "0.7"))
AUDIO_TTL_S = float(os.getenv("AUDIO_TTL_S", "10"))  # an alarm/scream stays in events this long

METRICS = HERE / "metrics.csv"
EVAL_DIR = HERE / "eval_frames"
PUBLIC_URL_FILE = HERE / ".public_url"  # written when the tunnel starts: the https address phones use


def phone_url() -> str | None:
    """Link to the phone page, or None if no tunnel address is known."""
    try:
        base = PUBLIC_URL_FILE.read_text().strip()
    except OSError:
        return None
    return base.rstrip("/") + "/camera" if base.startswith("https://") else None

# Room mode (default): VENUE = a preset in prototype/layouts.js or a layout .json; each phone picks a room.
# Grid mode: set MAP (and VENUE="") to use a schema-v2 map with posed cameras (positions in cells).
VENUE = os.getenv("VENUE", "" if os.getenv("MAP") else "malin")
MAP = VenueInfo(load_venue(VENUE, HERE.parent / "prototype" / "layouts.js")) if VENUE else MapInfo(MAP_PATH)
latest_frame: dict[str, tuple[bytes, float]] = {}
events: dict[str, asyncio.Event] = {}
cams: dict[str, dict] = {}  # per-camera working state
workers: dict[str, asyncio.Task] = {}
observations: dict[str, dict] = {}  # latest Observation per cameraId
clients: set[WebSocket] = set()
rooms: list[str] = []  # room names of the twin on screen (prototype/). A room name also works as a camera id.
twin_layout: dict = {}  # the presenter's whole layout JSON, passed on as is to copies of the twin page (GET /layout)
LAYOUT_MAX_BYTES = 300_000
plan: dict = {}  # floor plan of that twin for the phone's room picker: {width, height, rooms: [{name, x, y, w, h}]}


def ensure_cam(cam_id: str):
    if cam_id in cams:
        return
    cams[cam_id] = {
        "exits": [],  # exit cell groups this camera sees (flat indices)
        "questions": P.build_questions(False),
        "count": 0, "people": [], "summary": None,
        "crowding": 0.0, "present": False, "last_hydrogen": 0.0,
        "bucket": None, "bucket_conf": 0.0,  # Decisions' fast count range, every frame
        "h_count": 0, "h_people": [], "h_valid": False, "h_busy": False, "h_dirty": False,  # last Hydrogen result
        "hazard": "none", "hazard_conf": 0.0, "hazard_streak": 0,
        "exit_p": None,  # P(exit blocked) from the last frame, if the camera sees an exit
        "audio": None, "audio_conf": 0.0, "audio_ts": 0.0,
        "stream": {"ok": False, "latencyMs": None, "lastFrame": None, "frames": 0,
                   "decisionCalls": 0, "hydrogenCalls": 0, "audioCalls": 0, "error": None},
    }
    refresh_pose(cam_id)
    events[cam_id] = asyncio.Event()
    workers[cam_id] = asyncio.create_task(camera_worker(cam_id))


def refresh_pose(cam_id: str):
    """Recompute which exits a camera sees (after load or after the browser moves it)."""
    c = cams[cam_id]
    c["exits"] = MAP.visible_exits(cam_id)
    # A room of the twin (not a map camera) has doors: always ask if the way out is blocked.
    c["questions"] = P.build_questions(bool(c["exits"]) or cam_id not in MAP.cameras or isinstance(MAP, VenueInfo))


def observation(cam_id: str) -> dict:
    """Build the Observation for one camera (shape: docs/CONTRACTS.md)."""
    c = cams[cam_id]
    evs = []
    if c["hazard"] != "none":
        evs.append(c["hazard"])
    blocked = c["exit_p"] is not None and c["exit_p"] >= EXIT_BLOCKED_P
    if blocked:
        evs.append("exit_blocked")
    if c["audio"] and time.time() - c["audio_ts"] < AUDIO_TTL_S:
        evs.append(c["audio"])
    o = {
        "cameraId": cam_id,
        "pose": c.get("pose"),
        "poses": [{k: p[k] for k in ("x", "y", "yaw")} for _, p in sorted(c.get("poses", {}).items())
                  if time.time() - p["t"] < POSE_TTL_S],
        **({"room": MAP.cameras[cam_id]["room"]} if "room" in MAP.cameras.get(cam_id, {}) else {}),
        "timestamp": int((c["stream"]["lastFrame"] or time.time()) * 1000),
        "peopleCount": c["count"],
        "density": P.DENSITY[max(0, min(4, round(c["crowding"])))],
        "events": evs,
        "people": c["people"],
        "hazards": [{"type": c["hazard"], "confidence": round(c["hazard_conf"], 2)}] if c["hazard"] != "none" else [],
        "exits": [{**g, "blocked": blocked, "p": round(c["exit_p"], 2)} for g in c["exits"]]
        if c["exit_p"] is not None else [],
        "stream": dict(c["stream"]),
    }
    if c["summary"]:
        o["summary"] = c["summary"]
    return o


async def publish(cam_id: str):
    o = observation(cam_id)
    observations[cam_id] = o
    msg = {"type": "observation", "observation": o}
    for ws in list(clients):
        try:
            await ws.send_json(msg)
        except Exception:
            clients.discard(ws)


def log_metrics(row: dict):
    new = not METRICS.exists()
    with METRICS.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new:
            w.writeheader()
        w.writerow(row)


POSE_TTL_S = 10  # a phone that sent no frame for this long is no longer in the room's list of phones


def read_pose(q) -> dict | None:
    """Where the phone stands and looks, from the frame's query string: x, y in layout cells; yaw in degrees,
    0 = north on the plan (smaller y), 90 = east (larger x). None if the phone did not say."""
    try:
        x, y, yaw = float(q["x"]), float(q["y"]), float(q["yaw"])
    except (KeyError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (x, y, yaw)):
        return None
    return {"x": round(x, 1), "y": round(y, 1), "yaw": round(yaw % 360)}


def save_eval_frame(cam_id, ts, jpeg, c):
    d = EVAL_DIR / cam_id
    d.mkdir(parents=True, exist_ok=True)
    name = f"{int(ts * 1000)}.jpg"
    (d / name).write_bytes(jpeg)
    if c.get("pose"):
        (d / f"{int(ts * 1000)}.pose.json").write_text(json.dumps(c["pose"]))
    pred = EVAL_DIR / "predictions.csv"
    new = not pred.exists()
    with pred.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["file", "camera", "pred_count", "crowding", "hazard", "exit_p", "mode"])
        w.writerow([f"{cam_id}/{name}", cam_id, c["count"], round(c["crowding"], 2), c["hazard"],
                    c["exit_p"], "baseline" if BASELINE else "gated"])


def active_streams() -> int:
    return sum(1 for x in cams.values() if x["stream"]["lastFrame"] and time.time() - x["stream"]["lastFrame"] < 5)


def reconcile(c: dict):
    """Shown count = the last Hydrogen count, unless Decisions is confident the scene is now outside it
    (for example the phone swung from a busy table to one person). Then show the edge of Decisions' range
    and drop the stale positions until the next Hydrogen result."""
    if not c["present"]:
        c["count"], c["people"] = 0, []
        c["h_valid"] = False  # an old Hydrogen count must not come back when people return
        return
    lo, hi = P.COUNT_BUCKETS.get(c["bucket"], (0, 999))
    if not c["h_valid"]:  # no Hydrogen count for this scene yet: show the bottom of Decisions' range
        c["count"], c["people"] = (lo if c["bucket"] else 0), []
    elif c["bucket_conf"] >= COUNT_CONF and not lo <= c["h_count"] <= hi:
        c["count"], c["people"] = max(lo, min(hi, c["h_count"])), []
    else:
        c["count"], c["people"] = c["h_count"], c["h_people"]


def launch_hydrogen(cam_id: str, jpeg: bytes, recv_ts: float):
    c = cams[cam_id]
    c["h_busy"], c["h_dirty"] = True, False
    asyncio.create_task(hydrogen_job(cam_id, jpeg, recv_ts))


async def hydrogen_job(cam_id: str, jpeg: bytes, recv_ts: float):
    """Exact count + positions + summary for one frame. Gated mode runs this in the background (one per
    camera at a time), so a 4-10 s Hydrogen call never holds up the ~0.5 s Decisions updates."""
    c = cams[cam_id]
    try:
        h = await asyncio.to_thread(P.run_hydrogen, jpeg)
        c["stream"]["hydrogenCalls"] += 1
        aspect = jpeg_aspect(jpeg)
        pts = [MAP.project(cam_id, u, v, aspect) for u, v in h["people"]]
        if BASELINE:
            c["present"] = True
        if c["present"]:  # everyone may have left while we were counting
            c["h_count"], c["h_people"], c["h_valid"] = h["count"], [p for p in pts if p], True
        c["debug"] = {"jpeg": jpeg, "points": h["people"], "count": h["count"], "summary": h["summary"],
                      "ts": time.time()}  # last counted frame, memory only, for /debug
        reconcile(c)
        c["summary"] = h["summary"] or c["summary"]
        hyd_ms, ok, err = h["ms"], 1, None
    except Exception as e:
        hyd_ms, ok, err = 0, 0, f"{type(e).__name__}: {e}"[:300]
        c["stream"].update(ok=False, error=err)
    finally:
        c["last_hydrogen"] = time.time()
        c["h_busy"] = False
    if not BASELINE:
        await publish(cam_id)
        log_metrics({
            "ts": round(time.time(), 3), "camera": cam_id, "mode": "gated", "kind": "hydrogen",
            "active_streams": active_streams(), "decision_ms": 0, "hydrogen_ms": hyd_ms, "called_hydrogen": 1,
            "end_to_end_ms": round((time.time() - recv_ts) * 1000), "count": c["count"],
            "crowding": round(c["crowding"], 2), "hazard": c["hazard"], "exit_p": c["exit_p"], "ok": ok,
        })
        # the scene changed while we were counting: count the newest frame right away
        if c["h_dirty"] and c["present"] and cam_id in latest_frame:
            launch_hydrogen(cam_id, *latest_frame[cam_id])


async def camera_worker(cam_id: str):
    c = cams[cam_id]
    ev = events[cam_id]
    while True:
        await ev.wait()
        ev.clear()
        jpeg, recv_ts = latest_frame[cam_id]  # always the newest frame; stale ones are dropped
        dec_ms = 0
        called_h = False
        try:
            if BASELINE:
                c["present"] = True
                await hydrogen_job(cam_id, jpeg, recv_ts)  # baseline: Hydrogen inline on every frame
                called_h = True
            else:
                d = await asyncio.to_thread(P.run_decisions, jpeg, c["questions"])
                c["stream"]["decisionCalls"] += 1
                dec_ms = d["ms"]
                c["crowding"] = d["crowding"]

                # Hazard with debounce so one bad frame doesn't raise an alarm
                if d["hazard"] != "none" and d["hazard_conf"] >= HAZARD_CONF:
                    c["hazard_streak"] += 1
                else:
                    c["hazard_streak"] = 0
                if c["hazard_streak"] >= HAZARD_STREAK:
                    c["hazard"], c["hazard_conf"] = d["hazard"], d["hazard_conf"]
                elif c["hazard_streak"] == 0:
                    c["hazard"], c["hazard_conf"] = "none", 0.0

                c["exit_p"] = d.get("exit_blocked")

                was_present = c["present"]
                c["present"] = d["people_present"] >= 0.5
                changed = d["count_bucket"] != c["bucket"]
                c["bucket"], c["bucket_conf"] = d["count_bucket"], d["count_conf"]
                reconcile(c)  # nobody there -> 0 and no Hydrogen
                if c["present"] and (not was_present or changed or time.time() - c["last_hydrogen"] > HEARTBEAT_S):
                    if c["h_busy"]:
                        c["h_dirty"] = True  # re-count as soon as the current call finishes
                    else:
                        launch_hydrogen(cam_id, jpeg, recv_ts)
                        called_h = True

            latency = round((time.time() - recv_ts) * 1000)
            c["stream"].update(ok=True, latencyMs=latency, error=None)
        except Exception as e:  # keep the stream alive; surface the error in the Observation
            latency = round((time.time() - recv_ts) * 1000)
            c["stream"].update(ok=False, latencyMs=latency, error=f"{type(e).__name__}: {e}"[:300])

        await publish(cam_id)
        log_metrics({
            "ts": round(time.time(), 3), "camera": cam_id, "mode": "baseline" if BASELINE else "gated",
            "kind": "frame", "active_streams": active_streams(),
            "decision_ms": dec_ms, "hydrogen_ms": 0, "called_hydrogen": int(called_h),
            "end_to_end_ms": latency, "count": c["count"], "crowding": round(c["crowding"], 2),
            "hazard": c["hazard"], "exit_p": c["exit_p"], "ok": int(c["stream"]["ok"]),
        })
        if SAVE_FRAMES:
            save_eval_frame(cam_id, recv_ts, jpeg, c)


async def warmup():
    """One call to each model at startup, so the first phone frame doesn't pay the 10-20 s cold start."""
    test = HERE / "test.jpg"
    if not WARMUP or not test.exists():
        return
    jpeg = test.read_bytes()
    for name, fn in [("decisions", lambda: P.run_decisions(jpeg, P.build_questions(False))),
                     ("hydrogen", lambda: P.run_hydrogen(jpeg))]:
        try:
            r = await asyncio.to_thread(fn)
            print(f"warmup {name}: {r['ms']} ms", flush=True)
        except Exception as e:
            print(f"warmup {name} failed: {type(e).__name__}: {e}"[:300], flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    for cam_id in MAP.cameras:
        ensure_cam(cam_id)
    asyncio.create_task(warmup())
    yield
    for t in workers.values():
        t.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def never_cache(request: Request, call_next):
    """Pages change during the day: a phone must not keep an old copy of the camera page or the twin."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/frame/{cam_id}")
async def post_frame(cam_id: str, request: Request):
    jpeg = await request.body()
    ensure_cam(cam_id)
    now = time.time()
    latest_frame[cam_id] = (jpeg, now)
    c = cams[cam_id]
    c["pose"] = read_pose(request.query_params)
    # More than one phone can film the same room: keep each phone's pose (phone = an id the phone made up).
    phone = request.query_params.get("phone", "")[:40] or "one"
    c.setdefault("poses", {}).pop(phone, None)
    if c["pose"]:
        c["poses"][phone] = {**c["pose"], "t": now}
    c["stream"]["lastFrame"] = now
    c["stream"]["frames"] += 1
    events[cam_id].set()
    return {"cameraId": cam_id, "known": cam_id in rooms or cam_id in MAP.cameras, "timestamp": int(now * 1000),
            "peopleCount": c["count"], "density": P.DENSITY[max(0, min(4, round(c["crowding"])))],
            "hazard": c["hazard"], "ok": c["stream"]["ok"], "latencyMs": c["stream"]["latencyMs"],
            "error": c["stream"]["error"]}


@app.post("/audio/{cam_id}")
async def post_audio(cam_id: str, request: Request):
    """A short WAV clip from the phone mic. Not queued: if the model is slow, clips just overlap."""
    wav = await request.body()
    ensure_cam(cam_id)
    c = cams[cam_id]
    try:
        a = await asyncio.to_thread(P.run_audio, wav)
        c["stream"]["audioCalls"] += 1
        if a["event"] != "none" and a["conf"] >= AUDIO_CONF:
            c["audio"], c["audio_conf"], c["audio_ts"] = a["event"], a["conf"], time.time()
        await publish(cam_id)
        return {"cameraId": cam_id, **a}
    except Exception as e:
        return {"cameraId": cam_id, "error": f"{type(e).__name__}: {e}"[:300]}


warmed = {"done": False}


def use_venue(layout: dict):
    """Room mode follows the layout that is on the presenter's screen (not a preset read at startup).
    A phone names its room by the room's NAME, so each room is listed under its name as well as its slug."""
    global MAP
    try:
        venue = VenueInfo(layout)
    except (KeyError, TypeError, ValueError):
        return
    for cam in list(venue.cameras.values()):
        venue.cameras[cam["room"]] = cam
    MAP = venue
    for cam_id in list(cams):
        refresh_pose(cam_id)


def is_local(request: Request) -> bool:
    """True only for a request made on this machine, not one that came in through a tunnel or proxy."""
    host = request.client.host if request.client else ""
    forwarded = any(h in request.headers for h in ("cf-connecting-ip", "x-forwarded-for", "forwarded"))
    return host in ("127.0.0.1", "::1") and not forwarded


@app.post("/twin")
async def post_twin(request: Request):
    """From the Fire Twin page on this machine: the API key (kept in memory) and the room names of the twin."""
    if not is_local(request):
        return JSONResponse({"error": "local requests only"}, status_code=403)
    body = await request.json()
    if isinstance(body.get("key"), str) and body["key"].strip():   # an empty key never clears a working one
        P.set_key(body["key"])
    p = body.get("plan")
    if isinstance(p, dict) and isinstance(p.get("rooms"), list):
        num = lambda v: float(v) if isinstance(v, (int, float)) else 0.0
        plan.clear()
        plan.update(width=num(p.get("width")), height=num(p.get("height")), rooms=[
            {"name": str(r.get("name"))[:60], **{k: num(r.get(k)) for k in ("x", "y", "w", "h")}}
            for r in p["rooms"][:200] if isinstance(r, dict)])
        rooms[:] = [r["name"] for r in plan["rooms"]]
    lay = body.get("layout")
    if isinstance(lay, dict) and len(json.dumps(lay)) <= LAYOUT_MAX_BYTES:
        twin_layout.clear()
        twin_layout.update(lay)
        use_venue(lay)
    if P.has_key() and not warmed["done"]:   # the key arrives after startup: warm the models up now
        warmed["done"] = True
        asyncio.create_task(warmup())
    return {"ready": P.has_key(), "rooms": len(rooms)}


def streamed(job):
    """Run job(emit) in a thread; the response is NDJSON: progress events, then {"type": "result", ...} or {"type": "error"}."""
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    emit = lambda ev: loop.call_soon_threadsafe(q.put_nowait, ev)

    async def work():
        try:
            emit({"type": "result", "result": await asyncio.to_thread(job, emit)})
        except Exception as e:
            emit({"type": "error", "text": f"{type(e).__name__}: {e}"[:300]})
        emit(None)

    async def lines():
        task = asyncio.create_task(work())
        while (ev := await q.get()) is not None:
            yield json.dumps(ev) + "\n"
        await task
    return StreamingResponse(lines(), media_type="application/x-ndjson")


def agent_request(request: Request, body: dict):
    """The agent spends the API key: laptop only. Returns an error response, or None if the request can go ahead."""
    if not is_local(request):
        return JSONResponse({"error": "the agent answers on the organizer's laptop only"}, status_code=403)
    if not P.has_key():
        return JSONResponse({"error": "no API key on the server yet"}, status_code=503)
    if not isinstance(body.get("layout", {}), dict) or len(json.dumps(body)) > 4 * LAYOUT_MAX_BYTES:
        return JSONResponse({"error": "bad request"}, status_code=400)
    return None


@app.post("/agent/ask")
async def agent_ask(request: Request):
    """Chat with the agent. Body: {question, history: [{role, text}], layout (the page's snapshot), fireRate}."""
    body = await request.json()
    if err := agent_request(request, body):
        return err
    question = str(body.get("question", "")).strip()
    if not question or not isinstance(body.get("layout"), dict):
        return JSONResponse({"error": "question and layout needed"}, status_code=400)
    rate = float(body.get("fireRate") or 0.08)
    return streamed(lambda emit: AG.ask(question, body.get("history") or [], body["layout"], rate, emit))


@app.post("/advisor/propose")
async def advisor_propose(request: Request):
    """Advisor tab: changes to test. Body: {layout, summary}."""
    body = await request.json()
    if err := agent_request(request, body):
        return err
    return streamed(lambda emit: AG.propose(body.get("layout") or {}, body.get("summary") or {}, emit))


@app.post("/advisor/guide")
async def advisor_guide(request: Request):
    """Advisor tab: the advice guide. Body: {facts}."""
    body = await request.json()
    if err := agent_request(request, body):
        return err
    return streamed(lambda emit: AG.guide(body.get("facts") or {}, emit))


@app.get("/layout")
async def get_layout():
    """The presenter's layout, for a copy of the twin page opened somewhere else."""
    if not twin_layout:
        return JSONResponse({"error": "no layout yet"}, status_code=404)
    return JSONResponse(twin_layout, headers={"Cache-Control": "no-store"})


@app.get("/frame/{cam_id}/latest.jpg")
async def latest_jpeg(cam_id: str):
    """The newest frame of one camera, for the live view on the twin page."""
    if cam_id not in latest_frame:
        return JSONResponse({"error": "no frame"}, status_code=404)
    return Response(latest_frame[cam_id][0], media_type="image/jpeg", headers={"Cache-Control": "no-store"})


CAPTURE_FILE = re.compile(r"^\d+\.jpg$")


def saved_pose(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None
CAPTURES_PER_ROOM = 12


@app.get("/captures")
async def list_captures():
    """Saved frames (SAVE_FRAMES=1), newest first, for each room: [{file, t}] where t is ms since 1970."""
    out = {}
    if EVAL_DIR.is_dir():
        for d in sorted(p for p in EVAL_DIR.iterdir() if p.is_dir()):
            files = sorted((f.name for f in d.iterdir() if CAPTURE_FILE.match(f.name)), reverse=True)[:CAPTURES_PER_ROOM]
            if files:
                out[d.name] = [{"file": f, "t": int(f[:-4]), "pose": saved_pose(d / (f[:-4] + ".pose.json"))} for f in files]
    return {"saving": SAVE_FRAMES, "rooms": out}


@app.get("/captures/{room}/{file}")
async def get_capture(room: str, file: str):
    """One saved frame. Only a file name of digits + .jpg inside a room folder that exists."""
    folder = next((p for p in EVAL_DIR.iterdir() if p.is_dir() and p.name == room), None) if EVAL_DIR.is_dir() else None
    if not folder or not CAPTURE_FILE.match(file) or not (folder / file).is_file():
        return JSONResponse({"error": "no such capture"}, status_code=404)
    return FileResponse(folder / file, media_type="image/jpeg")


@app.get("/qr.svg")
async def qr_svg():
    """QR code of the phone link, for the big screen."""
    import io
    import segno
    url = phone_url()
    if not url:
        return JSONResponse({"error": "no public address"}, status_code=404)
    out = io.BytesIO()
    segno.make(url, error="m").save(out, kind="svg", scale=8, border=2, dark="#0c0f14", light="#ffffff")
    return Response(out.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.websocket("/ws")
async def ws_feed(ws: WebSocket):
    """Server -> browser: {"type":"observation","observation":Observation}, latest per camera on connect.
    Browser -> server: {"type":"cameras","cameras":CameraDef[]} after the user moves a camera."""
    await ws.accept()
    clients.add(ws)
    try:
        for o in observations.values():
            await ws.send_json({"type": "observation", "observation": o})
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "cameras":
                for cam in msg.get("cameras", []):
                    try:
                        MAP.set_camera(cam)
                    except (KeyError, TypeError, ValueError):
                        continue
                    if cam["id"] in cams:
                        refresh_pose(cam["id"])
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


@app.get("/observations")
async def get_observations():
    """Snapshot of the latest Observation per camera (debugging, and for clients that poll)."""
    return {"t": time.time(), "map": MAP.name, "mode": "baseline" if BASELINE else "gated",
            "observations": observations}


def local_only(request: Request) -> bool:
    """/debug shows camera images: only from this laptop, never through the tunnel (it adds cf-connecting-ip)."""
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost") and "cf-connecting-ip" not in request.headers


@app.get("/debug/frame/{cam_id}")
async def debug_frame(cam_id: str, request: Request):
    d = cams.get(cam_id, {}).get("debug")
    if not local_only(request) or not d:
        return Response(status_code=404)
    return Response(d["jpeg"], media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/debug/info/{cam_id}")
async def debug_info(cam_id: str, request: Request):
    c = cams.get(cam_id)
    if not local_only(request) or not c or not c.get("debug"):
        return Response(status_code=404)
    d = c["debug"]
    return {"points": d["points"], "hydrogenCount": d["count"], "summary": d["summary"], "age_s": round(time.time() - d["ts"], 1),
            "shownCount": c["count"], "range": c["bucket"], "rangeConf": round(c["bucket_conf"], 2)}


@app.get("/debug")
async def debug_page(request: Request):
    if not local_only(request):
        return Response(status_code=404)
    return FileResponse(HERE / "debug.html")


@app.get("/camera")
async def camera_page():
    return FileResponse(HERE / "camera.html")


@app.get("/")
async def index():
    return {"map": MAP.name, "mode": "baseline" if BASELINE else "gated", "ready": P.has_key(), "rooms": rooms, "plan": plan,
            "phoneUrl": phone_url(),
            "cameras": {k: {"name": v["name"], "page": f"/camera?id={k}"} for k, v in MAP.cameras.items() if v.get("id", k) == k},
            "ws": "/ws", "observations": "/observations"}


# The twin page itself (prototype/), for people who are not at the demo machine: <address>/app/
# A remote viewer has no API key, so the Gemini steps in the page are off; the live feed still shows.
app.mount("/app", StaticFiles(directory=HERE.parent / "prototype", html=True), name="twin")
