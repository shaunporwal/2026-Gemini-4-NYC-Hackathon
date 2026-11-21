"""
Model calls for the venue twin perception layer.

- run_decisions(): Gemini Decisions API (gemini-decision-1). Fast, calibrated checks on every frame:
  people present? how crowded? fire/smoke? exit blocked?
- run_hydrogen(): Gemini 4 Hydrogen. Head count, per-person foot positions (image fractions) and a
  one-line scene summary. Only called when the Decisions layer says something changed (or on a
  heartbeat), which is what lets us scale streams.
- run_audio(): Decisions API on a short WAV clip from the phone mic: alarm or screaming?

Model names are env vars so you can swap them without touching code.
"""
import base64
import os
import time

from google import genai
from google.genai import types
from pydantic import BaseModel

DECISION_MODEL = os.getenv("DECISION_MODEL", "gemini-decision-1")
VISION_MODEL = os.getenv("VISION_MODEL", "gemini-4-hydrogen")
THINKING = os.getenv("THINKING", "low")  # set to "" if the model rejects thinking_level

# The key comes from GEMINI_API_KEY, or at run time from the Fire Twin page on this machine (POST /twin).
# It stays in memory: never written to disk, never returned by an endpoint.
_key = os.getenv("GEMINI_API_KEY", "").strip()
_client = None


def set_key(key: str):
    global _key, _client
    if key.strip() != _key:
        _key, _client = key.strip(), None


def has_key() -> bool:
    return bool(_key)


def get_client():
    global _client
    if not _key:
        raise RuntimeError("no API key yet: open the Fire Twin page on the server machine")
    if _client is None:
        _client = genai.Client(api_key=_key, http_options={"api_version": "v1beta"})  # Decisions API lives on v1beta
    return _client

CONTEXT = "A frame from a fixed camera in an indoor event venue (a hackathon hall)."

# Observation.density names, same order as CROWDING_LEVELS (score 0..4)
DENSITY = ["empty", "sparse", "moderate", "crowded", "packed"]

CROWDING_LEVELS = [
    "Empty floor",
    "A few people, lots of open space",
    "Moderately busy, people can move freely",
    "Crowded, people close together, movement slowed",
    "Packed, people cannot move freely",
]


def build_questions(has_exit: bool) -> dict:
    q = {
        "people_present": {
            "type": "noul",
            "instructions": "Are any people visible in this frame?",
            "criteria": {
                "true_description": "At least one person is visible, even partly",
                "false_description": "No people are visible",
            },
        },
        "crowding": {
            "type": "score",
            "instructions": "How crowded is the visible floor area?",
            "criteria": CROWDING_LEVELS,  # ordered low -> high, scored 0..4
        },
        "hazard": {
            "type": "choice",
            "instructions": "Is fire or smoke visible anywhere in this frame?",
            "criteria": {
                "none": "No fire and no smoke visible",
                "fire": "Flames are visible",
                "smoke": "Smoke or haze is visible without clear flames",
            },
        },
    }
    if has_exit:
        q["exit_blocked"] = {
            "type": "noul",
            "instructions": "Is the doorway or exit in this frame blocked so people could not walk through freely?",
            "criteria": {
                "true_description": "A person or object is obstructing the doorway",
                "false_description": "The doorway is clear to walk through",
            },
        }
    return q


def run_decisions(jpeg: bytes, questions: dict) -> dict:
    """One Decisions API call answering every question for this frame."""
    t0 = time.time()
    result = get_client().decisions.create(
        model=DECISION_MODEL,
        input=[
            {"type": "text", "text": CONTEXT},
            # NOTE: inline image bytes are passed as base64 "data", mirroring the documented PDF block.
            # If this errors, check ai.google.dev/gemini-api/docs/decisions for the inline image field name.
            {
                "type": "image",
                "data": base64.b64encode(jpeg).decode(),
                "mime_type": "image/jpeg",
                "resolution": "low",
            },
        ],
        questions=questions,
    )
    a = result.answers
    out = {
        "people_present": float(a["people_present"].noul),  # P(yes), 0.01..0.99
        "crowding": float(a["crowding"].score),  # probability-weighted 0..4
        "hazard": a["hazard"].choice,
        "hazard_conf": float(a["hazard"].confidence),
        "ms": round((time.time() - t0) * 1000),
    }
    if "exit_blocked" in questions:
        out["exit_blocked"] = float(a["exit_blocked"].noul)
    return out


class Person(BaseModel):
    x: float  # 0 = left edge of image, 1 = right edge
    y: float  # 0 = top edge, 1 = bottom edge (feet position)


class Positions(BaseModel):
    count: int
    people: list[Person]
    summary: str


POSITIONS_PROMPT = (
    "Count every person visible in this camera frame, including people who are partly hidden "
    "or far away. For each person give the point where their feet touch the floor (estimate it "
    "if their feet are hidden) as fractions of the image: x from 0 (left) to 1 (right), "
    "y from 0 (top) to 1 (bottom). count must equal the number of entries in people. "
    "summary: one short sentence on what the crowd is doing (for example queueing at the bar, "
    "moving toward a door). Do not describe or identify individuals."
)


def run_hydrogen(jpeg: bytes) -> dict:
    t0 = time.time()
    cfg = dict(response_mime_type="application/json", response_schema=Positions)
    if THINKING:
        cfg["thinking_config"] = types.ThinkingConfig(thinking_level=THINKING)
    r = get_client().models.generate_content(
        model=VISION_MODEL,
        contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), CONTEXT, POSITIONS_PROMPT],
        config=types.GenerateContentConfig(**cfg),
    )
    pos = r.parsed if isinstance(r.parsed, Positions) else Positions.model_validate_json(r.text)
    people = [p for p in pos.people if 0 <= p.x <= 1 and 0 <= p.y <= 1]
    return {"count": len(people), "people": [(p.x, p.y) for p in people], "summary": pos.summary.strip()[:200],
            "ms": round((time.time() - t0) * 1000)}


AUDIO_QUESTIONS = {
    "audio_event": {
        "type": "choice",
        "instructions": "Is there an emergency sound in this audio clip from an event venue?",
        "criteria": {
            "none": "Normal venue noise: talking, music, applause, footsteps, or silence",
            "alarm": "A fire alarm, siren or other alarm tone is sounding",
            "screaming": "People are screaming or shouting in distress",
        },
    },
}


def run_audio(wav: bytes) -> dict:
    """One Decisions call on a short audio clip (16 kHz mono WAV from camera.html)."""
    t0 = time.time()
    result = get_client().decisions.create(
        model=DECISION_MODEL,
        input=[
            {"type": "text", "text": "A short audio clip from a microphone in an indoor event venue."},
            {"type": "audio", "data": base64.b64encode(wav).decode(), "mime_type": "audio/wav"},
        ],
        questions=AUDIO_QUESTIONS,
    )
    a = result.answers["audio_event"]
    return {"event": a.choice, "conf": float(a.confidence), "ms": round((time.time() - t0) * 1000)}
