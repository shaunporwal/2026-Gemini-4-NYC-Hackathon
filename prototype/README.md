# Fire Twin

Floor plan or walkthrough video → digital twin → live fire and evacuation → Gemini proposes a fix → the simulator proves it.

Gemini 4 NYC Hackathon, 2026-11-21.

## Run

From the repository root run `python3 -m http.server 5174 --bind 127.0.0.1 --directory prototype`, then open http://127.0.0.1:5174/. You can also open `prototype/index.html` directly.

Select **The Malin Chelsea (Gemini, from the floor plan PDF)** and click **3D** to reproduce the team's current demo. Fresh loads start in 2D with the approximate Malin preset. The page title is **Fire Twin**.

For Gemini actions, enter an API key in **Setup**. It stays in this tab's session storage. The simulation can run offline. Restart an existing server from the intended checkout after moving worktrees, then reload the page.

## Demo path

1. (Optional) Setup → "Floor plan and/or video → new twin": Gemini converts a floor plan (photo, PDF, sketch) and/or a walkthrough video to the layout JSON. "Room photo or video → update this twin": Gemini finds which room of the current layout the photo shows, then sets its head count, colors, furniture and blocked doors. The side panel lists what Gemini saw.
2. Click the floor: fire starts. Fire and smoke spread; people go to the nearest safe exit; routes update each second.
3. The PA text changes when an exit is blocked (Gemini writes it; the browser speaks it).
4. "Find fix": candidates from search + Gemini. The simulator scores each one against the same fire.
5. "Apply best + replay": same fire, new layout. Compare "Lost" in the Runs table.

Click a door or exit to lock or unlock it. Red = locked.

The **3D / 2D** button in the header switches the view of the same simulation. In 3D: drag to orbit, scroll to zoom, click the floor to start a fire. A layout can carry `wallColor`, a `color` for each room and `objects` (furniture); Gemini fills these from a video so the 3D view looks like the room. Furniture footprints block pedestrian placement and movement, including diagonal shortcuts. Stages remain walkable. Smoke and fire can pass through furnished cells.

### Exit awareness and matched replay

After starting a fire, select **Familiar exit** and **Second exit**. Both must be different, unlocked exits. Set the announcement delay from 0 to 120 seconds after the alarm and the reception percentage from 0 to 100, then click **Compare same crowd**.

The comparison restarts two simulations from the same layout snapshot, seed 7, initial positions, reaction delays, fire spread setting and ignition schedule. In both, everyone initially routes using the familiar exit. In the guided run, the cue teaches a seeded sample of occupants who are still active about the second exit. Reception is a per-person probability, so intermediate percentages can produce a different realized share. Cue delivery is resolved at the 0.5-second simulation timestep. Each run stops at 120 seconds after the alarm or once everyone has exited or gone down.

Use **Show in 3D / 2D** to switch the displayed run. Purple heads identify informed occupants in 3D, and **Who learned the exit** lists their IDs and learning times. Learning an exit adds a routing option; actual exit usage is counted separately. Physical exits stay available, including when an occupant happens to reach one without previously knowing about it.

The table reports people out, still inside, down, full-clearance time, total doorway waiting, queued smoke exposure, and use of the two selected exits. **All out at** becomes **Not reached** if a completed run has any occupant who failed to exit. Treat all outcome columns together when comparing scenarios.

**Play / Pause** controls both runs. **Compare same crowd** starts another comparison using the chosen settings and recorded fire. **Reset** returns to editing, while **Replay fire** starts the ordinary all-exits-known simulation again. During a comparison, room editing and layout-fix actions are disabled by the app.

The cue's reception probability is a scenario assumption. Sound propagation, sign visibility, announcement comprehension and locally perceived fire knowledge are future work.

### Doorway queues

Pick a door or exit in the queue panel to see its current and peak queue, distinct people who waited, total waiting time and longest uninterrupted individual wait. A wait counts when someone has an exit route, is ready to take a step, and people ahead block their progress at the opening. The engine also follows occupied cells back along a line. A person can count at several doors during one evacuation.

Each waiting person adds 0.5 person-seconds per tick. Waiting smoke exposure sums the local smoke index (0–1) multiplied by those seconds. For example, four people waiting for two seconds at an index of 0.5 contribute eight person-seconds and four smoke-seconds. Reset or replay starts the counters fresh.

Layouts (`layouts.js`):

- **The Malin Chelsea (approx.)**: the hackathon venue, traced by hand from the public floor plan. Street doors (7th Ave, 26th St) follow the plan. The 2 locked exits (X1, X2) and all head counts are assumptions for the demo.
  Good start point: the 26th St Foyer (both street doors behind the fire, 150 people in the Event Hall).
- **The Malin Chelsea (Gemini, from the floor plan PDF)** is the current stage layout. It has 293 preset occupants and exits E1–E4. Geometry, head counts and exit assignments require on-site verification.
- **Generic venue (demo)**: good start points are the corridor centre and the corridor west end. A fire in the centre of the Main Hall shows that the obvious fix (unlock E3) can make the result worse.

## Design

- `layouts.js`: preset layouts, data only.
- `sim.js`: deterministic physics + routing (cellular automaton fire, smoke diffusion, Dijkstra field). Same seed + same fire = same result.
- `gemini.js`: the LLM reads, speaks and proposes. It does not decide.
- `render.js`, `app.js`: view and wiring.

1 cell = 1 m. 1 tick = 0.5 s. The fire model is for demonstration, not for engineering use.
