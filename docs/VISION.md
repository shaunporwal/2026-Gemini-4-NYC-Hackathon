# Vision — Fire Evacuation Digital Twin

## One-liner
A live voxel **digital twin** of a building: cameras feed real crowd density into the
model, and anyone can **tap anywhere on the map to start a fire** and watch how the crowd
would actually evacuate — spread, smoke, bottlenecks, casualties — *before* it happens.

## Problem
Evacuation plans are static drawings made for an empty building. Real risk depends on
**how many people are where, right now**, and on which exits they will actually reach.
Venue operators (event halls, clubs, offices, schools) have cameras but no way to turn
that feed into "if a fire started at the bar right now, 14 people would be trapped behind
door B."

## Who it's for
- Venue / facility safety managers (planning, staffing, exit placement)
- Event organisers (live capacity decisions)
- Fire marshals / first responders (pre-incident planning)

## Core experience (the demo)
1. A voxel 3D model of the venue loads from a JSON floor plan.
2. Cameras are placed on the map; each has a position + orientation and a visible cone.
3. A Gemini model watches each live feed (video + audio) and reports how many people are
   in view → the twin populates those cells with agents.
4. The user **taps a cell → fire ignites**. Fire and smoke spread across the grid.
5. Agents route to the nearest safe exit, slow down in smoke and crowds, and avoid fire.
6. Live stats: evacuated / trapped / casualties / time-to-clear, and **bottleneck
   highlighting** on doors and corridors.
7. **Compare scenarios**: same fire, different layout (e.g. extra exit, blocked door) →
   side-by-side outcome.

## Scope for this hackathon (6 h, 4 people)
**In**
- JSON-defined map of any size (single floor), voxel 3D render (three.js)
- Everything physical in the grid: wall, floor, exit, table, chair, person (+ door, void)
- Camera objects with orientation, visible-cell cone (walls occlude), draggable/rotatable in 3D
- Grid fire + smoke spread (model details owned by the fire teammate — TBD)
- Individual crowd agents following a distance field to exits
- Gemini live-feed interpretation → per-camera people counts (owned by the Gemini teammate)
- Live evac/casualty stats, bottleneck detection, scenario comparison

**Out (for now)**
- In-app map editor (JSON only for v1; editor is a stretch goal)
- Multi-floor buildings / stairs
- Physically accurate fire modelling (CFD, CO toxicity, etc.)
- Pixel-accurate person localisation from video

**Stretch**
- In-app paint editor for the map
- Camera POV render (simulated view vs. real feed)
- Panic behaviours (freeze, herd, return-to-entrance)
- Gemini-written post-run safety recommendations

## Success = the judges see
"Real people on a real camera → appear in the twin → tap → fire → a visible bottleneck
forms at a door → we add an exit in the JSON → re-run → fewer casualties."
