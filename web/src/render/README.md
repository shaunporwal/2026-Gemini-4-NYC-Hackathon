# render/ (owner: three.js teammate)
The three.js voxel scene. It reads `MapModel` (and later `SimState`), draws them, and turns user input into intents.

`scene.ts` is a **starter renderer** written against the map module. Keep it, replace it or rewrite it; only the interface below matters.

## Interface with map/
| Render gets | From | Notes |
|---|---|---|
| Grid size, `cellSize`, `wallHeight` | `MapModel` | Never hardcode a size. |
| `cells[i]` (a `CellType` code) | `MapModel` | Look up colour and height with `SPEC_BY_CODE[code]` from `map/cellTypes.ts`. Don't hardcode per-type styles, so new types render automatically. `height: null` means `wallHeight`; `0` means a flat tile. |
| People | `MapModel.people` now, `SimState.agents` later | Positions in cells (float), at cell centres. `VoxelScene.setPeople(list)` updates the instances; call it every frame once agents move. |
| Cameras + `visibleCells` | `MapModel.cameras` | Draw a marker at `(x, height, y)` and the visible cells as an overlay. |

| Render emits | To |
|---|---|
| Clicked cell `(x, y)` | `pickCell()` raycasts to the floor plane. Later this becomes `{type:"ignite", x, y}` in `state.events`. |
| Moved or rotated camera | Update the camera's `x`/`y`/`yaw`, then call `computeVisibleCells(map, cam)` from `map/cameras.ts` and redraw its cone. |

World mapping: `X = x*cellSize`, `Z = y*cellSize`, `Y` up (metres). Never mutate sim layers or agents.
