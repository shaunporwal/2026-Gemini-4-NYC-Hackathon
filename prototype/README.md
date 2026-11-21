# Fire Twin

Floor plan or walkthrough video → digital twin → simulated fire and evacuation → Gemini proposes a fix → the simulator compares it.

Gemini 4 NYC Hackathon, 2026-11-21.

## Run

From the repository root run `python3 -m http.server 8765 --bind 127.0.0.1 --directory prototype`, then open http://127.0.0.1:8765/. You can also open `prototype/index.html` directly.

Fresh loads open **The Malin Chelsea (Gemini, from the floor plan PDF)** in **3D twin**. The page title is **Live Evacuation Twin**. Port 8765 enables organizer controls; the existing feed adapter treats other HTTP ports as viewer copies.

For Gemini actions, enter an API key in **Settings**. It stays in this tab's session storage. The simulation can run offline. Restart an existing server from the intended checkout after moving worktrees, then reload the page.

## Demo path

1. (Optional) Settings → "Floor plan and/or video → new twin": Gemini converts a floor plan (photo, PDF, sketch) and/or a walkthrough video to the layout JSON. "Room photo or video → update this twin": Gemini finds which room of the current layout the photo shows, then sets its head count, colors, furniture and blocked doors. The side panel lists what Gemini saw.
2. Choose **Simulate fire**, then click the floor: a rehearsal starts. Fire and smoke spread; people steer continuously toward an available exit using a smoke-weighted route, avoid walls and each other, and form queues. Routes update as hazards change.
3. Inspect the Simulation panel for doorway queues, waiting time and smoke exposure. The prototype is silent; there are no spoken announcements or speech controls.
4. "Find fix": candidates from search + Gemini. The simulator scores each one against the same fire.
5. "Apply best + replay": same fire, new layout. Compare "Lost" in the Runs table.

Click a door or exit to inspect it. To change locks, choose **Simulation → Opening interaction → Toggle locked state**, then click an opening while in venue view. Red = locked.

The **3D twin / 2D plan** buttons above the model switches the view of the same simulation. In 3D: drag to orbit, scroll to zoom, choose Simulate fire and click the floor to start a rehearsal. A layout can carry `wallColor`, a `color` for each room and `objects` (furniture); Gemini fills these from a video so the 3D view looks like the room. Furniture footprints block pedestrian placement and movement, including diagonal shortcuts. Stages remain walkable. Smoke and fire can pass through furnished cells.

### Exit awareness and matched replay

Under **Simulation → Compare exit awareness**, after starting a fire, select **Familiar exit** and **Second exit**. Both must be different, unlocked exits. Set the announcement delay from 0 to 120 seconds after the alarm and the reception percentage from 0 to 100, then click **Compare same crowd**.

The comparison restarts two simulations from the same layout snapshot, movement model, seed 7, initial positions, body sizes, preferred speeds, reaction delays, fire spread setting and precise ignition schedule. In both, everyone initially routes using the familiar exit. In the guided run, the cue teaches a seeded sample of occupants who are still active about the second exit. Reception is a per-person probability, so intermediate percentages can produce a different realized share. Continuous movement and cue delivery use fixed 1/30-second substeps; fire and smoke retain their 0.5-second updates. Recorded ignition times preserve the substep when the user started a fire. Each run stops at 120 seconds after the alarm or once everyone has exited or gone down.

Use **Show in 3D / 2D** to switch the displayed run. Purple heads identify informed occupants in 3D, and **Who learned the exit** lists their IDs and learning times. Learning an exit adds a routing option; actual exit usage is counted separately. Physical exits stay available, including when an occupant happens to reach one without previously knowing about it.

The table reports people out, still inside, down, full-clearance time, total doorway waiting, queued smoke exposure, and use of the two selected exits. Elapsed simulation time is separate from the last exit time; a run reaching its horizon has not necessarily cleared. **All out at** becomes **Not reached** if a completed run has any occupant who failed to exit. Treat all outcome columns together when comparing scenarios.

**Play / Pause** controls both runs. **Compare same crowd** starts another comparison using the chosen settings and recorded fire. **Return to venue** returns to editing, while **Replay** starts the ordinary all-exits-known simulation again. During a comparison, room editing and layout-fix actions are disabled by the app.

The cue's reception probability is a scenario assumption. Sound propagation, sign visibility, announcement comprehension and locally perceived fire knowledge are future work.

### Doorway queues

Pick a door or exit in the queue panel to see its current and peak queue, distinct people who waited, total waiting time and longest uninterrupted individual wait. In continuous mode, waiting is inferred from slow physical progress and crowd obstruction on the approach to an opening, after the person’s reaction delay. It is not inferred from two people sharing a tile. A person can count at several doors during one evacuation.

Each waiting person adds the duration of each crowd substep to the total, in person-seconds. Waiting smoke exposure sums the local smoke index (0–1) multiplied by those seconds. For example, four people waiting for two seconds at an index of 0.5 contribute eight person-seconds and four smoke-seconds. Reset or replay starts the counters fresh.

Layouts (`layouts.js`):

- **The Malin Chelsea (approx.)**: the hackathon venue, traced by hand from the public floor plan. Street doors (7th Ave, 26th St) follow the plan. The 2 locked exits (X1, X2) and all head counts are assumptions for the demo.
  Good start point: the 26th St Foyer (both street doors behind the fire, 150 people in the Event Hall).
- **The Malin Chelsea (Gemini, from the floor plan PDF)** is the current stage layout. It has 293 preset occupants and exits E1–E4. Geometry, head counts and exit assignments require on-site verification.
- **Generic venue (demo)**: good start points are the corridor centre and the corridor west end. A fire in the centre of the Main Hall shows that the obvious fix (unlock E3) can make the result worse.

## Design

- `layouts.js`: preset layouts, data only.
- `sim.js`: deterministic simulation timing, fire, smoke, Dijkstra routing, exposure, results and the optional legacy tile movement model.
- `continuous.js`: continuous pedestrian steering, body collisions, wall clearance, doorway crossing and queue measurements. It has no rendering, DOM or model calls.
- Same snapshot, movement model, parameters, seed and precise ignition schedule produce the same result; changing the movement model can change outcomes.
- `gemini.js`: the LLM reads and proposes. It does not decide.
- `render.js`, `app.js`: view and wiring.

Room presets use 1 m cells; imported grids use their `cellSize` (normally 0.5 m). Pedestrian positions are fractional cell coordinates. Physical speeds and the default 0.22 m body radius are converted using that cell size. Continuous crowd steps run at 30 Hz; hazards still advance every 0.5 s with the existing per-cell coefficients. Changing grid resolution does not make the fire model physically equivalent.

Crowd defaults in `continuous.js`: 1.1–1.45 m/s preferred walking speed (stable per person), 3 m/s² acceleration limit, 0.24 m soft personal-space gap, 3.5 m route lookahead and adaptive contact resolution capped at 32 passes, stopping early near 1 mm convergence. Wall-constrained corrections separate body circles without bounce, though small residual overlaps can remain within numerical tolerance. Personal-space preference relaxes near an opening while the physical body radius stays fixed. A queue requires 0.3 s of sustained slowdown with an ahead-body chain leading to an opening. Density is neighbors per square metre within a 1 m radius; contact counts touching neighbors, while compression is a 0–1 personal-space indicator.

Continuous movement is the default (`crowdMode: "continuous"`); the older tile model remains an optional baseline (`crowdMode: "tiles"`). More than one person can occupy a cell when their bodies fit. Placement reports people it cannot fit, rather than silently treating them as evacuated. Ordinary continuous rehearsals stop after 120 seconds from the alarm, or sooner if no active occupants remain. A run without an alarm also has a 120-second bound. Keep the same model and parameters for matched comparisons.

The engine exposes `seconds` and the integer `substep` (30 Hz); `tick` remains the completed 0.5-second hazard tick. Recorded ignitions carry `{tick, substep, x, y}`; preserve `substep` when replaying. `stats()` includes `elapsedSeconds`, `lastOutSeconds`, `requestedPeople`, `unplaced`, `crowdMode` and `modelVersion` (`continuous-v1` or `tiles-v1`). `seconds` in the result remains rounded elapsed time for existing displays. A last exit time is a full-clearance time only when every modeled occupant exited and none were omitted at placement.

The crowd and fire models are illustrative, not engineering validation. Contact, compression and density help show bottlenecks; they are not calibrated pressure, stampede or crush-injury predictions. Smoke exposure remains a normalized smoke-index integral, not a medical dose.

## Frontend workspace and agent hookup

The single-page organizer view keeps the twin and playback controls beside Assistant, Simulation and Activity tabs. The layout picker has a themed in-page menu with arrow/Home/End keys, type-ahead, Enter/Space selection and Escape dismissal. Settings retains the existing photo/video and JSON imports. Camera detections warn in Activity; they never start a rehearsal automatically.

People retain their jointed running figures, raised arms, oversized heads, big expressive eyes, raised eyebrows and surprised mouths. Both views follow the same continuous engine positions. Facing and running gestures respond to motion; queued occupants can shuffle while waiting. The oversized heads and raised arms are cosmetic: small floor-plane body circles determine collisions, so faces do not widen a doorway. Multiple people in a cell remain distinct bodies rather than a visual fan-out. Low walls can be toggled; Fit view restores the building framing. Reduced-motion preferences disable interpolation and gestures and keep flame textures still. Pausing freezes animation. Procedural flame ribbons, floor glow, embers and soft smoke replace hazard blocks; they read the same fire/smoke fields, with no change to spread, exposure, or casualties. Raised-arm gestures are stylized presentation, not a validated panic behavior model.

Crowding colors use local simulated crowd density and contact, while waiting occupants are highlighted. These colors show illustrative congestion, not calibrated pressure or crush-injury thresholds. The Simulation panel retains actual engine doorway measurements and matched exit-awareness replay.

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

Verify in the browser: load the default 3D venue → Simulate fire → click floor → inspect Simulation queues → Pause/Play/Replay → Compare exit awareness → Return to venue → switch 2D/Cameras → open Settings. Check desktop and narrow layouts. Watch a narrow doorway and a corner in both views: bodies should turn smoothly, stay inside walkable space and queue without snapping to tile centers. Pause must freeze movement and effects; replay must reproduce the same crowd. Inspect both slow and fast playback, and verify an exit-awareness cue changes knowledge without changing initial placement or the scheduled fire. Camera and model-service actions require their respective services and credentials.
