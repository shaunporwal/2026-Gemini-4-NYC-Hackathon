# map/ (owner: Jacob)
Turns map JSON into the static `MapModel` that every other module reads.

- **Owns:** map loading and validation, the furniture/obstacle catalog (default height, blocking, fuel, colour), camera `visibleCells` (view cone + wall occlusion), exporting an edited map back to JSON.
- **Writes:** `MapModel`, `CameraState.visibleCells`. Never touches `SimState`.
- **Spec:** `docs/MAP_SCHEMA.md`, `schemas/map.schema.json`.
- **Next up:** camera drag/rotate in 3D (with `render/`) → recompute `visibleCells` → export to JSON. Stretch: in-app paint editor.
