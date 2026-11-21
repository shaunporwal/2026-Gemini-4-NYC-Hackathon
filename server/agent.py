"""
The twin's Gemini agent (docs/AGENT.md). It answers the organizer's questions by running simulations itself,
headless, on the layout snapshot the page sends. Physics is code: every number in an answer comes from
sim_tools.js (the prototype's engine). The key stays on this server.

- ask():     chat. Gemini 4 Hydrogen (AGENT_MODEL) in a function-calling loop over the sim tools.
- propose(): Advisor tab. Hydrogen proposes changes to test, from a sweep summary.
- guide():   Advisor tab. Gemini 4 Neon (GUIDE_MODEL) writes the advice guide from measured results.
Each reports progress through emit({type: "step" | "thought", text}) so the page can show it while it works.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

from google.genai import types

import perception as P

HERE = Path(__file__).parent
NODE = os.getenv("NODE") or shutil.which("node") or r"C:\Program Files\nodejs\node.exe"
AGENT_MODEL = os.getenv("AGENT_MODEL", "gemini-4-hydrogen")
GUIDE_MODEL = os.getenv("GUIDE_MODEL", "gemini-4-neon")
MAX_TURNS = 8          # model turns per question (each may call several tools)
HISTORY_TURNS = 6      # earlier chat turns sent back to the model


def sim(op: str, layout: dict, fire_rate: float, **extra) -> dict:
    """Run one sim_tools.js operation on the snapshot."""
    req = {"op": op, "layout": layout, "fireRate": fire_rate, **extra}
    r = subprocess.run([NODE, str(HERE / "sim_tools.js")], input=json.dumps(req), capture_output=True,
                       text=True, encoding="utf-8", timeout=180)
    if r.returncode != 0 or not r.stdout.strip():
        return {"error": (r.stderr or "simulation failed")[-300:]}
    return json.loads(r.stdout)


# ---- chat agent ----

ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["unlock", "unlock_all", "widen", "cap_room", "add_exit"]},
        "id": {"type": "string", "description": "door or exit id, for unlock and widen"},
        "room": {"type": "string", "description": "exact room name, for cap_room"},
        "people": {"type": "integer", "description": "new lower occupancy, for cap_room"},
        "x": {"type": "integer"}, "y": {"type": "integer"},
    },
    "required": ["action"],
}

TOOLS = [types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="get_world_summary",
        description="The venue as it is now: rooms with their head counts, exits and doors with width and locked state.",
        parameters_json_schema={"type": "object", "properties": {}}),
    types.FunctionDeclaration(
        name="run_scenario",
        description="Simulate one event on the current venue and return its outcome: people lost and why (fire, smoke, crush), "
                    "falls, evacuation time, exit use, busiest openings. Crowd crush and falls are modelled. Kinds: "
                    "fire (needs room), fall (fire in room + a person falling at door), crush (everyone evacuates, no fire), "
                    "blocked (everyone evacuates with exit blocked).",
        parameters_json_schema={"type": "object", "properties": {
            "kind": {"type": "string", "enum": ["fire", "fall", "crush", "blocked"]},
            "room": {"type": "string", "description": "exact room name, for fire and fall"},
            "exit": {"type": "string", "description": "exit id, for blocked"},
            "door": {"type": "string", "description": "door or exit id where the person falls, for fall"},
        }, "required": ["kind"]}),
    types.FunctionDeclaration(
        name="run_sweep",
        description="Worst-case sweep: many scenarios (fires in rooms weighted by area, falls at doorways, evacuations without "
                    "fire, a blocked exit). Returns losses by cause, the busiest openings, the costliest fire rooms and the "
                    "worst scenarios. Use it for 'biggest risk' questions. Takes about 3 s.",
        parameters_json_schema={"type": "object", "properties": {
            "n": {"type": "integer", "description": "number of scenarios, 12 to 48 (default 24)"}}}),
    types.FunctionDeclaration(
        name="test_changes",
        description="Measure up to 6 changes to the venue on the same sweep scenarios: mean people lost per run and crush falls, "
                    "against no change, and how many runs got better or worse. Use it before recommending a change.",
        parameters_json_schema={"type": "object", "properties": {
            "actions": {"type": "array", "items": ACTION_SCHEMA}}, "required": ["actions"]}),
    types.FunctionDeclaration(
        name="highlight_opening",
        description="Show a door or exit on the organizer's map with your answer.",
        parameters_json_schema={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    types.FunctionDeclaration(
        name="suggest",
        description="Add one recommended action card under your answer (call once per recommendation, at most 4).",
        parameters_json_schema={"type": "object", "properties": {
            "title": {"type": "string"}, "detail": {"type": "string", "description": "1-2 sentences with the measured effect"},
            "opening_id": {"type": "string"}}, "required": ["title", "detail"]}),
    types.FunctionDeclaration(
        name="show_replay",
        description="Replay a simulated scenario on the organizer's map after your answer: the last run_scenario, or the "
                    "worst scenario of the last sweep.",
        parameters_json_schema={"type": "object", "properties": {
            "which": {"type": "string", "enum": ["last_scenario", "worst_of_sweep"]}}, "required": ["which"]}),
])]

SYSTEM = """You are the safety advisor of a live digital twin of an event venue. The organizer asks about risks.
Answer by running simulations with your tools, on the venue exactly as it is now (rooms, head counts, locked doors).
Rules:
- Every number you give must come from a tool result in this conversation. Never guess an outcome.
- Name places as the venue does (room names, exit ids with their names).
- Before you recommend a change, measure it with test_changes; never recommend a change that made results worse.
- Keep answers short: the headline number, the place, one sentence of why, then what to do. Plain text, no Markdown tables.
- Use highlight_opening for the door or exit that matters most, and suggest for each recommended action.
- When you ran a scenario worth watching, call show_replay.
- Say plainly that fire, smoke and crush are demo models, when a decision depends on exact numbers.
- If the question is not about this venue's safety, answer briefly without tools."""


def ask(question: str, history: list, layout: dict, fire_rate: float, emit) -> dict:
    """One chat turn. Returns {text, openingId?, suggestions, replay?, tools}."""
    client = P.get_client()
    contents = []
    for h in (history or [])[-HISTORY_TURNS:]:
        if isinstance(h, dict) and isinstance(h.get("text"), str):
            contents.append(types.Content(role="user" if h.get("role") == "user" else "model", parts=[types.Part(text=h["text"][:2000])]))
    contents.append(types.Content(role="user", parts=[types.Part(text=question[:2000])]))
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM, tools=TOOLS,
        thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_level="low"),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    reply = {"text": "", "suggestions": [], "tools": []}
    last = {"scenario": None, "worst": None}

    def call_tool(name: str, args: dict) -> dict:
        if name == "get_world_summary":
            return sim("world", layout, fire_rate)
        if name == "run_scenario":
            emit({"type": "step", "text": "Simulating: " + " ".join(str(v) for v in args.values())})
            r = sim("scenario", layout, fire_rate, args=args)
            if r.get("scenario"):
                last["scenario"] = r.pop("scenario")
                emit({"type": "step", "text": f"{last['scenario']['label']}: {r['lost']} of {r['of']} lost, {r['seconds']} s"})
            return r
        if name == "run_sweep":
            emit({"type": "step", "text": f"Running a sweep of {args.get('n', 24)} scenarios"})
            r = sim("sweep", layout, fire_rate, args=args)
            if r.get("worst"):
                last["worst"] = r["worst"][0]["scenario"]
                for w in r["worst"]:
                    w.pop("scenario", None)
                emit({"type": "step", "text": f"Sweep: {r['overall']['meanLost']} lost per run on average, worst {r['overall']['maxLost']}"})
            return r
        if name == "test_changes":
            emit({"type": "step", "text": "Testing " + str(len(args.get("actions") or [])) + " change(s) on the same scenarios"})
            r = sim("test", layout, fire_rate, args=args)
            for t in r.get("results", []):
                emit({"type": "step", "text": f"{t['change']}: {t['meanLost']} lost per run ({t['lostChange']:+}), "
                                              f"{t['betterRuns']} runs better, {t['worseRuns']} worse" if t["valid"] else f"{t['change']}: not valid here"})
            return r
        if name == "highlight_opening":
            reply["openingId"] = str(args.get("id", ""))[:12]
            return {"ok": True}
        if name == "suggest":
            if len(reply["suggestions"]) < 4:
                reply["suggestions"].append({"title": str(args.get("title", ""))[:80], "detail": str(args.get("detail", ""))[:300],
                                             **({"openingId": str(args["opening_id"])[:12]} if args.get("opening_id") else {})})
            return {"ok": True}
        if name == "show_replay":
            s = last["scenario"] if args.get("which") == "last_scenario" else last["worst"]
            if not s:
                return {"error": "nothing to replay yet: run a scenario or a sweep first"}
            reply["replay"] = s
            return {"ok": True, "label": s["label"]}
        return {"error": "unknown tool " + name}

    for _ in range(MAX_TURNS):
        resp = client.models.generate_content(model=AGENT_MODEL, contents=contents, config=config)
        cand = (resp.candidates or [None])[0]
        if not cand or not cand.content or not cand.content.parts:
            break
        contents.append(cand.content)   # as returned, so thought signatures go back to the model
        calls = []
        for part in cand.content.parts:
            if part.thought and part.text:
                emit({"type": "thought", "text": part.text})
            elif part.function_call:
                calls.append(part.function_call)
            elif part.text:
                reply["text"] += part.text
        if not calls:
            break
        responses = []
        for fc in calls:
            args = dict(fc.args or {})
            reply["tools"].append(fc.name)
            try:
                result = call_tool(fc.name, args)
            except Exception as e:
                result = {"error": f"{type(e).__name__}: {e}"[:300]}
            responses.append(types.Part.from_function_response(name=fc.name, response={"result": result}))
        contents.append(types.Content(role="user", parts=responses))
        reply["text"] = ""   # only the text after the last tool call is the answer
    reply["text"] = reply["text"].strip() or "I could not finish that answer. Try asking again, more narrowly."
    return reply


# ---- Advisor tab: proposals and guide (moved here from the browser so the key stays on the server) ----

def _stream_json(model: str, prompt: str, thinking: str | None, emit) -> dict:
    cfg = types.ThinkingConfig(include_thoughts=True, **({"thinking_level": thinking} if thinking else {}))
    text = ""
    for chunk in P.get_client().models.generate_content_stream(
            model=model, contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", thinking_config=cfg)):
        for part in ((chunk.candidates or [None])[0].content.parts if chunk.candidates and chunk.candidates[0].content else []) or []:
            if part.thought and part.text:
                emit({"type": "thought", "text": part.text, "model": model})
            elif part.text:
                text += part.text
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b < a:
        raise ValueError("no JSON in the reply")
    return json.loads(text[a:b + 1])


PROPOSE_ACTIONS = """{"action":"unlock","id":"<id of a locked door or exit>","reason":"..."}
{"action":"widen","id":"<id of a door or exit>","reason":"..."}  (1 m wider)
{"action":"cap_room","room":"<exact room name>","people":<new lower occupancy>,"reason":"..."}
{"action":"add_exit","x":<int>,"y":<int>,"reason":"..."}  (a wall cell between a room interior and the outside, not a corner)"""


def propose(layout: dict, summary: dict, emit) -> list:
    out = _stream_json(AGENT_MODEL,
        "You are a venue safety analyst. A deterministic evacuation simulator ran many scenarios on this venue "
        "(fires in different rooms, falls at doorways, evacuations with no fire, a blocked exit). The summary is below. "
        "Propose up to 4 different single changes to test, aimed at the hazards that cost the most people. "
        "The simulator will run every scenario again with each change, so be specific. Allowed actions:\n" + PROPOSE_ACTIONS +
        '\nreason = 1 short sentence that names the hazard it targets. Return JSON: {"proposals":[...]}\n'
        "Layout: " + json.dumps(layout) + "\nSummary of the runs: " + json.dumps(summary), "low", emit)
    items = out.get("proposals") if isinstance(out, dict) else None
    return [dict(p, reason=str(p.get("reason", ""))[:200]) for p in (items or []) if isinstance(p, dict)][:4]


GUIDE_FORMAT = ('{"headline":"<1 sentence: the main finding>",'
                '"prevalent":[{"hazard":"...","where":"<room or door id>","howOften":"<from the runs>","impact":"<from the runs>"}],'
                '"during":[{"when":"<trigger, e.g. queue at a door over 20 people, fire in a room, a person falls>","do":"<what staff do, 1-2 sentences>"}],'
                '"prevent":[{"action":"...","priority":"high|medium|low","evidence":"<the measured change, or untested>"}],'
                '"watch":["<what the cameras and staff should watch for, with a number>"],'
                '"limits":"<1 sentence on what the simulation does not model>"}')


def guide(facts: dict, emit) -> dict:
    return _stream_json(GUIDE_MODEL,
        "You are a crowd and fire safety advisor for an event venue. Write an advice guide for the venue manager from the "
        "simulation results below. Rules: use only numbers that are in the results; say which hazards are most prevalent and why; "
        "say what staff should do when each hazard happens; recommend prevention, best first, and give the measured effect for "
        'every change that was tested ("tests"); never recommend a change whose results were worse; say plainly when something is untested. '
        "Plain English, short sentences. Maximum 5 items in each list. Return only JSON in this format:\n" + GUIDE_FORMAT +
        "\nResults: " + json.dumps(facts), None, emit)
