# Fire Twin

Floor plan or walkthrough video → digital twin → live fire and evacuation → Gemini proposes a fix → the simulator proves it.

Gemini 4 NYC Hackathon, 2026-11-21.

## Run

From the repository root run `python3 -m http.server 8765 --bind 127.0.0.1 --directory prototype`, then open http://127.0.0.1:8765/. You can also open `prototype/index.html` directly.

Fresh loads open **The Malin Chelsea (Gemini, from the floor plan PDF)** in **3D twin**. The page title is **Live Evacuation Twin**. Port 8765 enables organizer controls; the existing feed adapter treats other HTTP ports as viewer copies.

For Gemini actions, enter an API key in **Settings**. It stays in this tab's session storage. The simulation can run offline. Restart an existing server from the intended checkout after moving worktrees, then reload the page.

## Demo path

1. (Optional) Settings → "Floor plan and/or video → new twin": Gemini converts a floor plan (photo, PDF, sketch) and/or a walkthrough video to the layout JSON. "Room photo or video → update this twin": Gemini finds which room of the current layout the photo shows, then sets its head count, colors, furniture and blocked doors. The side panel lists what Gemini saw.
2. Choose **Simulate fire**, then click the floor: a rehearsal starts. Fire and smoke spread; people go to the nearest safe exit; routes update each second.
3. Inspect the Simulation panel for doorway queues, waiting time and smoke exposure. The prototype is silent; there are no spoken announcements or speech controls.
4. "Find fix": candidates from search + Gemini. The simulator scores each one against the same fire.
5. "Apply best + replay": same fire, new layout. Compare "Lost" in the Runs table.

Click a door or exit to inspect it. To change locks, choose **Simulation → Opening interaction → Toggle locked state**, then click an opening while in venue view. Red = locked.

The **3D twin / 2D plan** buttons above the model switches the view of the same simulation. In 3D: drag to orbit, scroll to zoom, choose Simulate fire and click the floor to start a rehearsal. A layout can carry `wallColor`, a `color` for each room and `objects` (furniture); Gemini fills these from a video so the 3D view looks like the room. Furniture footprints block pedestrian placement and movement, including diagonal shortcuts. Stages remain walkable. Smoke and fire can pass through furnished cells.

### Exit awareness and matched replay

Under **Simulation → Compare exit awareness**, after starting a fire, select **Familiar exit** and **Second exit**. Both must be different, unlocked exits. Set the announcement delay from 0 to 120 seconds after the alarm and the reception percentage from 0 to 100, then click **Compare same crowd**.

The comparison restarts two simulations from the same layout snapshot, seed 7, initial positions, reaction delays, fire spread setting and ignition schedule. In both, everyone initially routes using the familiar exit. In the guided run, the cue teaches a seeded sample of occupants who are still active about the second exit. Reception is a per-person probability, so intermediate percentages can produce a different realized share. Cue delivery is resolved at the 0.5-second simulation timestep. Each run stops at 120 seconds after the alarm or once everyone has exited or gone down.

Use **Show in 3D / 2D** to switch the displayed run. Purple heads identify informed occupants in 3D, and **Who learned the exit** lists their IDs and learning times. Learning an exit adds a routing option; actual exit usage is counted separately. Physical exits stay available, including when an occupant happens to reach one without previously knowing about it.

The table reports people out, still inside, down, full-clearance time, total doorway waiting, queued smoke exposure, and use of the two selected exits. **All out at** becomes **Not reached** if a completed run has any occupant who failed to exit. Treat all outcome columns together when comparing scenarios.

**Play / Pause** controls both runs. **Compare same crowd** starts another comparison using the chosen settings and recorded fire. **Return to venue** returns to editing, while **Replay** starts the ordinary all-exits-known simulation again. During a comparison, room editing and layout-fix actions are disabled by the app.

The cue's reception probability is a scenario assumption. Sound propagation, sign visibility, announcement comprehension and locally perceived fire knowledge are future work.

### Doorway queues

Pick a door or exit in the queue panel to see its current and peak queue, distinct people who waited, total waiting time and longest uninterrupted individual wait. A wait counts when someone has an exit route, is ready to take a step, and people ahead block their progress at the opening. The engine also follows occupied cells back along a line. A person can count at several doors during one evacuation.

Each waiting person adds 0.5 person-seconds per tick. Waiting smoke exposure sums the local smoke index (0–1) multiplied by those seconds. For example, four people waiting for two seconds at an index of 0.5 contribute eight person-seconds and four smoke-seconds. Reset or replay starts the counters fresh.

### Advisor tab (analysis agent)

**Advisor** in the header opens a tab that analyses the twin on screen. **Run analysis**:

1. Runs 12, 24 or 48 scenarios headless (about 2–5 s): fires started in rooms weighted by floor area, a fire plus a person falling at a doorway, an evacuation with no fire (false alarm, threat), and an evacuation with one exit blocked. Crowd crush and falls are on in every run.
2. Summarises what went wrong: losses by cause (fire, smoke, crush), the busiest openings, the costliest fire starts, the worst scenarios. The **risk map** shows where people were lost (red) and where they fell (amber) over all runs.
3. Picks changes to test: search (unlock each locked exit, widen the 2 busiest openings, cap the room whose fires cost the most) plus up to 4 from the fast model (Hydrogen). New actions: `widen` (an opening 1 m wider) and `cap_room` (an occupancy limit).
4. Runs every scenario again with each change, so each result is a measured difference on the same scenarios (mean lost per run, crush falls, runs better / worse).
5. The reasoning model (Neon) writes the **advice guide** from those numbers: the most prevalent hazards, what staff do when each happens, prevention ranked by measured effect, what to watch for. It is told never to recommend a change that tested worse. Without the server, a template guide is built from the same numbers.

Steps 3 and 5 call Gemini **on the server** (`server/agent.py`, endpoints `/advisor/propose` and `/advisor/guide`), never from the browser.

### Assistant chat (the agent)

The **Assistant** panel connects to the server agent when the page runs on the organizer's laptop (port 8765) and the server is up on port 8000. Each question goes to `/agent/ask` with a snapshot of the twin on screen (rooms, head counts, locked doors). Gemini 4 Hydrogen answers by calling simulation tools itself: `get_world_summary`, `run_scenario` (fire, fall, crush, blocked exit), `run_sweep`, `test_changes`, and `highlight_opening`, `suggest`, `show_replay` for the map. Every number in an answer comes from a tool result. Progress shows in the panel header and in Activity; a replay the agent asks for starts in the twin. Measured on the Malin (Gemini) preset: "what happens if a fire starts in the Event Auditorium?" about 8 s; "what is the biggest risk and what should I change?" (sweep + tests) about 28 s.

**Agent thoughts** shows each step: the loop's own steps (`Agent`), each measured result (`Sim`) and the models' thought summaries as they stream. Click a scenario row to replay it in 2D / 3D. **Copy** puts the guide on the clipboard as Markdown. Timing measured on the Malin (Gemini) preset with 24 scenarios: runs + tests about 8 s, Hydrogen proposals about 6 s, Neon guide about 75 s (its thoughts stream meanwhile).

**Crowd model** (`sim.js`, demo heuristics, not calibrated): a cell holds one person, so crush pressure comes from the queue at an opening, people waiting per metre of its width. Above 16 per metre, people within 2 cells of the opening build up pressure; at 8 pressure-seconds they fall. A fallen person (amber) blocks their cell, breathes smoke, is lost if the press continues (24 pressure-seconds), and otherwise gets up after 25 s and walks at half speed. Random trips (more likely in thick smoke) use their own RNG, so fire and placement stay matched. Timed events: `fall` (the person nearest a cell falls), `block` (an opening becomes unusable), `alarm` (evacuation without fire). Setup → "Crowd crush and falls in the twin" turns the crowd model on for ordinary runs too; it is off by default, so existing fire-only results are unchanged.

Layouts (`layouts.js`):

- **The Malin Chelsea (approx.)**: the hackathon venue, traced by hand from the public floor plan. Street doors (7th Ave, 26th St) follow the plan. The 2 locked exits (X1, X2) and all head counts are assumptions for the demo.
  Good start point: the 26th St Foyer (both street doors behind the fire, 150 people in the Event Hall).
- **The Malin Chelsea (Gemini, from the floor plan PDF)** is the current stage layout. It has 293 preset occupants and exits E1–E4. Geometry, head counts and exit assignments require on-site verification.
- **Generic venue (demo)**: good start points are the corridor centre and the corridor west end. A fire in the centre of the Main Hall shows that the obvious fix (unlock E3) can make the result worse.

## Design

- `layouts.js`: preset layouts, data only.
- `sim.js`: deterministic physics + routing (cellular automaton fire, smoke diffusion, Dijkstra field). Same seed + same fire = same result.
- `gemini.js`: the LLM reads and proposes. It does not decide.
- `render.js`, `app.js`: view and wiring.

1 cell = 1 m. 1 tick = 0.5 s. The fire model is for demonstration, not for engineering use.

## Frontend workspace and agent hookup

The single-page organizer view keeps the twin and playback controls beside Assistant, Simulation and Activity tabs. Settings retains the existing photo/video and JSON imports. Camera detections warn in Activity; they never start a rehearsal automatically.

People have articulated figures and interpolated movement in 3D, and directional markers in 2D. These are rendering changes only: `sim.js` still determines positions, speed, routes and outcomes. Low walls can be toggled; Fit view restores the building framing. Reduced-motion preferences disable interpolation and limb animation.

Crowding is a visual overlay of active occupants in surrounding 3 × 3 cells. Yellow starts at three, orange at four, red at six or two queued neighbors. Waiting occupants also turn amber. These colors are illustrative clusters, not calibrated density, pressure or crush-injury thresholds. The Simulation panel retains actual engine doorway measurements and matched exit-awareness replay.

`assistant.js` is only a UI adapter; no agent service or fabricated recommendations are included. The agent owner connects it with:

```js
TwinAssistant.connect({
  async ask(question) {
    // Call your service and map its response to this presentation format.
    return { text: replyText, suggestions: [{ title, detail, openingId }] };
  }
});
```

Reply shape: `{text: string, openingId?: string, suggestions?: [{title, detail, openingId?}]}`. `openingId` must match this prototype's current door/exit ID (for example E1); Show opening selects the queue metrics and focuses that opening in 3D. `TwinAssistant.receive(reply)` renders pushed findings. `connect(null)` disconnects and disables chat. Loading a layout clears old messages and ignores any pending answer. The adapter does not apply fixes, start simulations, or implement background watch; the agent owner still needs to connect world/snapshot IDs and tool results to the app.

Verify in the browser: load the default 3D venue → Simulate fire → click floor → inspect Simulation queues → Pause/Play/Replay → Compare exit awareness → Return to venue → switch 2D/Cameras → open Settings. Check desktop and narrow layouts. Camera and model-service actions require their respective services and credentials.
