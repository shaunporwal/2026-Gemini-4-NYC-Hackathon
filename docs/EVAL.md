# Evaluation log

Real inputs, real key. Each row is one test. Ground truth comes from a person on site.
This file is the evidence for "Proof it works": what we measured, where it fails, what we changed.

## Test photo 1 (2026-11-21)

Photo of a work lounge, about 15 people, taken by Shaun. Ground truth: **West Booth Lounge**, camera facing west.
Layout: preset `malinGemini` (29 rooms, from the floor plan PDF).

| # | System | Time | Room answer | Right? | People | Notes |
|---|---|---|---|---|---|---|
| 1 | Hydrogen, default thinking, 2000 px photo, room names only | 42 s | Central Lounge & Dedicated Desks | No | 13 | 19 furniture items, 5 notes |
| 2 | Decision 1, 2000 px photo, room names as choices | 1.5 s | Central Lounge & Dedicated Desks (confidence 0.71) | No | level 2.5 of 4 (6-15 / 16-40) | West Booth Lounge got 0.03 |
| 3 | Decision 1, 768 px photo, 3 runs | 0.5-1.3 s | Central Lounge & Dedicated Desks (0.57), same all 3 runs | No | level 2.3 | Stable answer |
| 4 | Hydrogen, thinking low, 768 px photo, count + furniture only | 6 s | (not asked) | - | 12 | |
| 5 | Hydrogen, thinking low, 1024 px photo, full update path in the app | 9 s | Central Lounge & Dedicated Desks | No | 11 | 7 furniture items, 4 notes |

### What this shows

- **Speed:** thinking level low + a smaller photo takes the room update from 42 s to 9 s. Decision 1 answers in about 1 s.
- **Failure:** every system put the photo in the wrong room, and Decision 1 was confident (0.57-0.71). A room name carries no picture of the room; "Dedicated Desks" fits a photo of desks better than "Booth Lounge" does. Confidence does not catch this error.
- **People count:** 11, 12, 13 from Gemini; about 15 by a person from the same photo. Not checked on site.

### Change after this failure (planned)

Enrol the venue first: one reference photo for each room, with its name. Then ask "which reference matches this photo?" instead of "which name fits?". Test set = new photos of the same rooms, not the reference photos. Baseline = row 2 (names only).

## Same fire, 2 twins (2026-11-21, about 14:00)

Layout `malinGemini`. A phone streamed West Booth Lounge; Gemini (Hydrogen, 4 saved frames) rebuilt that room: 8 people (the plan guessed 16), 9 furniture items. Fire start: north-west corner of West Booth Lounge. Seed 7.

| Twin | Out | Lost | Time |
|---|---|---|---|
| Floor plan only | 262 of 293 | 31 | 102 s |
| With phones (1 room) | 253 of 285 | 32 | 138 s |

- The phones changed the head count (293 -> 285 in the building) and added furniture that people must walk around: the evacuation takes 36 s longer.
- 1 room and 1 fire only. Not a general result.
- The same photo set gave 7 people in one read and 8 in the next: Gemini's count is not stable.

## Find fix with Gemini (same run)

| Model | Time | Result |
|---|---|---|
| Neon, default thinking | no answer after 60 s | Stopped waiting. Too slow for a live step |
| Hydrogen, thinking low | 10 s | 3 proposals, all valid for the simulator |

| Candidate (from Gemini) | Lost | Gemini's reason |
|---|---|---|
| No change | 32 | |
| New exit at (15,25) | 12 | Direct south egress from Knickerbocker Room, less smoke exposure at D13 |
| New exit at (40,17) | 12 | Relieves D13 and D14 by giving Central Lounge a north exit |
| New exit at (79,33) | 20 | Relieves the D26 bottleneck with an east exit from Event Auditorium |

Change after the failure: fix proposals moved from Neon to Hydrogen, and Find fix now waits 20 s at most. The simulator scores every proposal, so a fast model is enough: a bad proposal costs nothing.

## Head counts from the fast model (server log, real phone frames)

West Booth Lounge, frames within a few minutes: 2, 3, 6, 7, 8, 12, 13. Ground truth not recorded. The count depends on where the phone points; a single frame is not a room count.
