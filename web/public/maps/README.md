# maps/
Map JSON files, validated against `schemas/map.schema.json` (spec: `docs/MAP_SCHEMA.md`).

- `demo-hall.json` is the reference map: 64×40 cells (32×20 m), a main hall with a stage, bar and tables, an east corridor, two rooms, 4 exits and 3 cameras. Keep it working, because everyone tests against it.
- Add new venues as new files; don't edit the demo map for experiments.
- Planned: load a map with `?map=/maps/<file>.json`.
