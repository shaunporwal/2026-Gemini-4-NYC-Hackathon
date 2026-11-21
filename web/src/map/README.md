# map/ (owner: Jacob)
Turns map JSON into the static `MapModel` that every other module reads. Spec: `docs/MAP_SCHEMA.md`.

| File | Job |
|---|---|
| `cellTypes.ts` | **The registry.** `CELL_TYPES` sets walkable, opaque, height, colour and fuel for each type; `DEFAULT_LEGEND` maps characters to types. Add a new type here. |
| `loader.ts` | `fetchMap(url)` / `buildMap(file)`: validates any grid size, reports every problem at once, and builds the typed arrays. `exportMap()` writes camera edits back to JSON. |
| `cameras.ts` | `computeVisibleCells(map, cam)`: the view cone with wall occlusion. `yawToDir(yaw)`. |

- **Writes:** `MapModel` only. Never touches `SimState`.
- `P` → `MapModel.people` (spawn points). Turning them into moving agents is crowd's job.
- **Next:** a rooms-to-grid converter for the `prototype/` presets; camera edits from the 3D view → recompute `visibleCells`.
