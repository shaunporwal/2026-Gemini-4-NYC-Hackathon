# maps/
Map JSON files, validated against `schemas/map.schema.json` (spec: `docs/MAP_SCHEMA.md`). Load one with `?map=/maps/<file>.json`.

| File | Size | What it is |
|---|---|---|
| `cafe.json` | 9×6 | The minimal example: 2 exits, 1 table with 4 chairs, 4 people, 1 camera. |
| `demo-hall.json` | 64×40 (32×20 m) | The reference venue: main hall with 6 table groups and a bar, east corridor, storage room, lounge with chair rows, 4 exits, 90 people, 3 cameras, 4 zones. |
| `convention-center.json` | 160×100 (80×50 m) | **Realistic stress test.** Ballroom with 63 banquet tables (8 chairs each) and a bar, restaurant, gallery around an open-air courtyard (void), kitchen with counters, lobby, 6 classroom breakouts, service corridor, dead-end restrooms, storage pass-through, loading dock with pallets. Non-rectangular outline (void notch), 1,148 people, 26 exit cells including two 1-cell fire exits, 1-cell kitchen doors, 10 cameras (one occluded by the courtyard), 16 zones, custom legend character `B` (bar → table). Longest escape path is 106 cells (53 m). |

Keep both maps working, because everyone tests against them. Put experiments in new files.
