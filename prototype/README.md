# Fire Twin

Floor plan or walkthrough video → digital twin → live fire and evacuation → Gemini proposes a fix → the simulator proves it.

Gemini 4 NYC Hackathon, 2026-11-21.

## Run

Open `index.html` in a browser. No install, no server. The simulation works with no network.
For the Gemini steps, paste an API key in the side panel (it stays in the tab).

## Demo path

1. (Optional) Setup → "Floor plan and/or video → new twin": Gemini converts a floor plan (photo, PDF, sketch) and/or a walkthrough video to the layout JSON. "Room photo or video → update this twin": Gemini finds which room of the current layout the photo shows, then sets its head count, colors, furniture and blocked doors. The side panel lists what Gemini saw.
2. Click the floor: fire starts. Fire and smoke spread; people go to the nearest safe exit; routes update each second.
3. The PA text changes when an exit is blocked (Gemini writes it; the browser speaks it).
4. "Find fix": candidates from search + Gemini. The simulator scores each one against the same fire.
5. "Apply best + replay": same fire, new layout. Compare "Lost" in the Runs table.

Click a door or exit to lock or unlock it. Red = locked.

The **3D / 2D** button in the header switches the view of the same simulation. In 3D: drag to orbit, scroll to zoom, click the floor to start a fire. A layout can carry `wallColor`, a `color` for each room and `objects` (furniture); Gemini fills these from a video so the 3D view looks like the room. The simulator ignores furniture: people walk through it.

Layouts (`layouts.js`):

- **The Malin Chelsea (approx.)**: the hackathon venue, traced by hand from the public floor plan. Street doors (7th Ave, 26th St) follow the plan. The 2 locked exits (X1, X2) and all head counts are assumptions for the demo.
  Good start point: the 26th St Foyer (both street doors behind the fire, 150 people in the Event Hall).
- **Generic venue (demo)**: good start points are the corridor centre and the corridor west end. A fire in the centre of the Main Hall shows that the obvious fix (unlock E3) can make the result worse.

## Design

- `layouts.js`: preset layouts, data only.
- `sim.js`: deterministic physics + routing (cellular automaton fire, smoke diffusion, Dijkstra field). Same seed + same fire = same result.
- `gemini.js`: the LLM reads, speaks and proposes. It does not decide.
- `render.js`, `app.js`: view and wiring.

1 cell = 1 m. 1 tick = 0.5 s. The fire model is for demonstration, not for engineering use.
