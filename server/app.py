"""
Gemini live-feed server: phone cameras in, Observations out (docs/CONTRACTS.md).

Phones POST JPEG frames (and short WAV clips) -> one worker per camera -> Decisions API on every
frame -> Hydrogen only when crowding changes or on a heartbeat -> Observation pushed to every
browser on the WebSocket /ws. Camera ids and poses come from the map JSON (MAP env var).

Run:   uvicorn app:app --host 0.0.0.0 --port 8000
Phone: https://<your-tunnel>/camera?id=cam-hall-ne

Env flags:
  MAP=../web/public/maps/demo-hall.json   map whose cameras we serve
  BASELINE=1      Hydrogen on every frame, no Decisions gating (the comparison baseline)
  HEARTBEAT_S=10  refresh positions at least this often even if nothing changed
  SAVE_FRAMES=1   save frames + predictions to eval_frames/ (eval sessions only; off for the demo)
"""
import asyncio
import csv
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import perception as P
from geometry import MapInfo, jpeg_aspect

HERE = Path(__file__).parent
MAP_PATH = Path(os.getenv("MAP", HERE.parent / "web" / "public" / "maps" / "demo-hall.json"))
BASELINE = os.getenv("BASELINE", "0") == "1"
HEARTBEAT_S = float(os.getenv("HEARTBEAT_S", "10"))
SAVE_FRAMES = os.getenv("SAVE_FRAMES", "0") == "1"
HAZARD_CONF = float(os.getenv("HAZARD_CONF", "0.7"))
HAZARD_STREAK = int(os.getenv("HAZARD_STREAK", "2"))  # consecutive frames before we raise a hazard
EXIT_BLOCKED_P = float(os.getenv("EXIT_BLOCKED_P", "0.6"))
AUDIO_CONF = float(os.getenv("AUDIO_CONF", "0.7"))
AUDIO_TTL_S = float(os.getenv("AUDIO_TTL_S", "10"))  # an alarm/scream stays in events this long

METRICS = HERE / "metrics.csv"
EVAL_DIR = HERE / "eval_frames"

MAP = MapInfo(MAP_PATH)
latest_frame: dict[str, tuple[bytes, float]] = {}
events: dict[str, asyncio.Event] = {}
cams: dict[str, dict] = {}  # per-camera working state
workers: dict[str, asyncio.Task] = {}
observations: dict[str, dict] = {}  # latest Observation per cameraId
clients: set[WebSocket] = set()


def ensure_cam(cam_id: str):
    if cam_id in cams:
        return
    cams[cam_id] = {
        "exits": [],  # exit cell groups this camera sees (flat indices)
        "questions": P.build_questions(False),
        "count": 0, "people": [], "summary": None,
        "crowding": 0.0, "bucket": None, "last_hydrogen": 0.0,
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
    c["questions"] = P.build_questions(bool(c["exits"]))


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
        "timestamp": int((c["stream"]["lastFrame"] or time.time()) * 1000),
        "peopleCount": c["count"],
        "density": P.DENSITY[max(0, min(4, round(c["crowding"])))],
        "events": evs,
        "people": c["people"],
        "hazards": [{"type": c["hazard"], "confidence": round(c["hazard_conf"], 2)}] if c["hazard"] != "none" else [],
        "exits": [{"cells": g, "blocked": blocked, "p": round(c["exit_p"], 2)} for g in c["exits"]]
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


def save_eval_frame(cam_id, ts, jpeg, c):
    d = EVAL_DIR / cam_id
    d.mkdir(parents=True, exist_ok=True)
    name = f"{int(ts * 1000)}.jpg"
    (d / name).write_bytes(jpeg)
    pred = EVAL_DIR / "predictions.csv"
    new = not pred.exists()
    with pred.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["file", "camera", "pred_count", "crowding", "hazard", "exit_p", "mode"])
        w.writerow([f"{cam_id}/{name}", cam_id, c["count"], round(c["crowding"], 2), c["hazard"],
                    c["exit_p"], "baseline" if BASELINE else "gated"])


async def camera_worker(cam_id: str):
    c = cams[cam_id]
    ev = events[cam_id]
    while True:
        await ev.wait()
        ev.clear()
        jpeg, recv_ts = latest_frame[cam_id]  # always the newest frame; stale ones are dropped
        dec_ms = hyd_ms = 0
        called_h = False
        try:
            if BASELINE:
                need_h = True
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

                bucket = round(d["crowding"])
                if d["people_present"] < 0.5:
                    c["count"], c["people"] = 0, []
                    need_h = False
                else:
                    need_h = (bucket != c["bucket"]) or (time.time() - c["last_hydrogen"] > HEARTBEAT_S)
                c["bucket"] = bucket

            if need_h:
                h = await asyncio.to_thread(P.run_hydrogen, jpeg)
                c["stream"]["hydrogenCalls"] += 1
                called_h = True
                hyd_ms = h["ms"]
                c["count"] = h["count"]
                c["summary"] = h["summary"] or c["summary"]
                aspect = jpeg_aspect(jpeg)
                pts = [MAP.project(cam_id, u, v, aspect) for u, v in h["people"]]
                c["people"] = [p for p in pts if p]  # unknown camera or above the horizon -> dropped
                c["last_hydrogen"] = time.time()

            latency = round((time.time() - recv_ts) * 1000)
            c["stream"].update(ok=True, latencyMs=latency, error=None)
        except Exception as e:  # keep the stream alive; surface the error in the Observation
            latency = round((time.time() - recv_ts) * 1000)
            c["stream"].update(ok=False, latencyMs=latency, error=f"{type(e).__name__}: {e}"[:300])

        await publish(cam_id)
        log_metrics({
            "ts": round(time.time(), 3), "camera": cam_id, "mode": "baseline" if BASELINE else "gated",
            "active_streams": sum(1 for x in cams.values()
                                  if x["stream"]["lastFrame"] and time.time() - x["stream"]["lastFrame"] < 5),
            "decision_ms": dec_ms, "hydrogen_ms": hyd_ms, "called_hydrogen": int(called_h),
            "end_to_end_ms": latency, "count": c["count"], "crowding": round(c["crowding"], 2),
            "hazard": c["hazard"], "exit_p": c["exit_p"], "ok": int(c["stream"]["ok"]),
        })
        if SAVE_FRAMES:
            save_eval_frame(cam_id, recv_ts, jpeg, c)


@asynccontextmanager
async def lifespan(app: FastAPI):
    for cam_id in MAP.cameras:
        ensure_cam(cam_id)
    yield
    for t in workers.values():
        t.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/frame/{cam_id}")
async def post_frame(cam_id: str, request: Request):
    jpeg = await request.body()
    ensure_cam(cam_id)
    now = time.time()
    latest_frame[cam_id] = (jpeg, now)
    c = cams[cam_id]
    c["stream"]["lastFrame"] = now
    c["stream"]["frames"] += 1
    events[cam_id].set()
    return {"cameraId": cam_id, "known": cam_id in MAP.cameras, "peopleCount": c["count"],
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


@app.get("/camera")
async def camera_page():
    return FileResponse(HERE / "camera.html")


@app.get("/")
async def index():
    return {"map": MAP.name, "mode": "baseline" if BASELINE else "gated",
            "cameras": {k: {"name": v["name"], "page": f"/camera?id={k}"} for k, v in MAP.cameras.items()},
            "ws": "/ws", "observations": "/observations"}
