# render/ (owner: three.js teammate)

This document covers the TypeScript grid-map app. The current Malin Fire Twin controls and replay are documented in [the demo guide](../../../prototype/README.md).

The three.js voxel scene reads the grid map and displays people and hazard arrays provided by the simulation adapter.

`scene.ts` implements the grid-map view. The dedicated Malin demo renderer is `prototype/render3d.js`.

## Interface with map/
| Render gets | From | Notes |
|---|---|---|
| Grid size, `cellSize`, `wallHeight` | `MapModel` | Never hardcode a size. |
| `cells[i]` (a `CellType` code) | `MapModel` | Look up colour and height with `SPEC_BY_CODE[code]` from `map/cellTypes.ts`. Don't hardcode per-type styles, so new types render automatically. `height: null` means `wallHeight`; `0` means a flat tile. |
| People | `MapModel.people` now, `SimState.agents` later | Positions in cells (float), at cell centres. `VoxelScene.setPeople(list)` updates the instances; call it every frame once agents move. |
| Cameras + `visibleCells` | `MapModel.cameras` | Draw a marker at `position` (world `X = x*cellSize`, `Y = z`, `Z = y*cellSize`) and the visible cells as an overlay. |

| Render emits | To |
|---|---|
| Clicked cell `(x, y)` | `pickCell()` raycasts to the floor plane. Later this becomes `{type:"ignite", x, y}` in `state.events`. |
| Moved or rotated camera | Update the camera's `position` / `orientation`, then call `computeVisibleCells(map, cam)` from `map/cameras.ts` and redraw its cone. |

World mapping: `X = x*cellSize`, `Z = y*cellSize`, `Y` up (metres). Never mutate sim layers or agents.
