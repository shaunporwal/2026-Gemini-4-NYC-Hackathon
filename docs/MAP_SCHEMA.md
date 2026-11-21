# Map JSON Schema (v1)

The map file is the **single source of truth for the venue**. Everything that is drawn or simulated
comes from it. **Everything physical is a character in the grid**: walls, exits, tables, chairs and
people. Only things that need extra numbers (cameras, named zones) are lists.

- Machine-readable schema: [`schemas/map.schema.json`](../schemas/map.schema.json)
- Examples: [`cafe.json`](../web/public/maps/cafe.json) (9×6), [`demo-hall.json`](../web/public/maps/demo-hall.json) (64×40),
  [`convention-center.json`](../web/public/maps/convention-center.json) (160×100 stress test), all in `web/public/maps/`
- Code: registry `web/src/map/cellTypes.ts`, loader `web/src/map/loader.ts`, cameras `web/src/map/cameras.ts`

## Minimal example

```json
{
  "version": 1,
  "name": "Small Cafe",
  "cellSize": 0.5,
  "rows": [
    "####E####",
    "#.P....P#",
    "#.CTTC..#",
    "#.CTTC.P#",
    "#....P..#",
    "####E####"
  ],
  "cameras": [
    { "id": "cam-cafe", "name": "Cafe corner", "x": 7.5, "y": 1.5, "height": 2.5,
      "yaw": 225, "pitch": -30, "fov": 100, "range": 12 }
  ]
}
```

**The grid size is not fixed.** `width = rows[0].length` and `height = rows.length`. There is no
minimum or maximum. The only rule is that every row has the same length.

## Characters (default legend)

| Char | Type | Walkable | Blocks camera view | Height | Notes |
|---|---|---|---|---|---|
| `#` | `wall` | no | yes | `wallHeight` | |
| `.` | `floor` | yes | no | flat | |
| `E` | `exit` | yes | no | flat | An agent that reaches it is **evacuated**. Put exits in the outer wall. At least 1 is required. |
| `T` | `table` | no | no | 0.75 m | A 2×2 table is four `T`s. |
| `C` | `chair` | no | no | 0.45 m | |
| `P` | `person` | yes | no | — | A **floor cell with one person** on it at the start. Becomes `MapModel.people`. |
| `D` | `door` | yes | no | flat | Optional interior opening (a possible bottleneck). A gap of `.` in a wall works too. |
| ` ` | `void` | no | no | — | Outside the building; not drawn. |

Every property comes from one table: `CELL_TYPES` in `web/src/map/cellTypes.ts` (walkable, opaque,
height, colour, fuel). The loader and the renderer read only that table.

**To add a new kind of cell** (for example a sofa or a fire door):
1. Add the name to `CellTypeName` (and a code to `CellType` if it's a new cell kind) in `shared/types.ts`.
2. Add one entry to `CELL_TYPES`.
3. Add a default character to `DEFAULT_LEGEND`.

No other code changes are needed.

**Custom characters per map:** `"legend": { "B": "table", "s": "chair" }` is merged over the defaults.

## Coordinate system (memorise this)

```
        x → (columns)                 three.js world:
  y   ┌──────────────┐                  X = x * cellSize
  ↓   │  rows[0]     │  north (yaw 0)   Z = y * cellSize
      │  rows[1]     │                  Y = up (metres)
      └──────────────┘
```

- **Horizontal units are cells.** `x` = column, `y` = row, with the origin at the top-left of
  `rows[0]`. Cell `(x, y)` covers `[x, x+1) × [y, y+1)`, so its centre is `(x+0.5, y+0.5)`.
- **Vertical units are metres** (`height`, `wallHeight`).
- `cellSize` converts cells to metres (default `0.5`).
- **Yaw** is a compass bearing in degrees: `0` = north (−y, toward `rows[0]`), `90` = east (+x),
  `180` = south, `270` = west. Clockwise is positive.
- **Pitch** is in degrees: `0` = horizontal, negative = looking down.
- Flat cell index: `i = y * width + x`. All per-cell typed arrays use it.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `1` | yes | Bump on a breaking schema change. |
| `name` | string | yes | Shown in the UI and in Gemini prompts. |
| `cellSize` | number (m) | no, `0.5` | Metres per cell. |
| `wallHeight` | number (m) | no, `3` | Voxel height of wall cells. |
| `legend` | `{char: type}` | no | Extra or overriding characters. |
| `rows` | string[] | yes | The grid. |
| `zones` | Zone[] | no | Named rectangles, used for stats and labels. |
| `cameras` | Camera[] | no | Camera placements. |

### Zone

```json
{ "id": "main-hall", "name": "Main Hall", "x": 1, "y": 1, "w": 39, "h": 38 }
```
An axis-aligned rectangle in cells (covers `x..x+w-1`, `y..y+h-1`). Used for per-room stats
("Main Hall: 60 people, 3 trapped") and human-readable context for Gemini.

### Camera

```json
{ "id": "cam-hall-ne", "name": "Main Hall NE corner",
  "x": 38.5, "y": 1.5, "height": 2.8, "yaw": 225, "pitch": -30, "fov": 90, "range": 40 }
```

| Field | Unit | Notes |
|---|---|---|
| `id` | string | Stable key. The Gemini feed reports observations by this id. |
| `x`, `y` | cells (float) | Position on the plan. Use `.5` to centre in a cell. |
| `height` | metres | Mounting height. |
| `yaw` | degrees | Compass bearing (see above). |
| `pitch` | degrees | Negative = down. |
| `fov` | degrees | Horizontal field of view. |
| `range` | cells | Maximum view distance. |

The loader computes `visibleCells` for each camera: walkable cells inside the horizontal cone
(`yaw ± fov/2`, within `range`) with **line of sight**, where opaque cells (walls) block the view.
People reported by the Gemini feed for a camera are placed only in that camera's visible cells.
Changing a camera's position or yaw means calling `computeVisibleCells(map, cam)` again.

## What the loader produces (`MapModel`)

`buildMap(file)` returns everything as flat typed arrays of length `width*height`:
`cells` (a `CellType` code), `walkable`, `opaque`, `baseFuel` and `zoneOf`. It also returns
`exitCells`, `people` (one `{id, x, y}` per `P`, at the cell centre), `zones` and `cameras` (with
`visibleCells`). See `docs/CONTRACTS.md`.

## Validation rules (`web/src/map/loader.ts`)

The loader collects **all** problems and throws one `MapValidationError` that lists them:
1. `version` is `1`, `name` is present, `rows` is a non-empty array of strings.
2. All rows are the same length.
3. Every character is in the merged legend (the error gives the first location of each unknown character).
4. Legend keys are single characters, and their values are known types.
5. There is at least one `exit` cell.
6. Zones are inside the grid. Camera ids are unique and cameras are inside the grid.

## Relation to the `prototype/` layout format

The plain-JS prototype on `main` uses rectangles: `rooms[]` (each with a people count),
`doors[]` and `exits[]` (each can be `locked`), with 1 cell = 1 m. Converting between the two:

| Prototype | This schema |
|---|---|
| `rooms[]` (rectangles that include their walls) | Wall characters `#` in the grid, plus optional `zones[]` for the room names |
| `rooms[].people` (a count, placed randomly) | One `P` per person, at an exact position |
| `doors[]`, `exits[]` | `D` and `E` characters |
| `exits[].locked` | Not in v1. Add a `locked-exit` cell type if it's needed (one registry entry) |
| No furniture | `T` and `C` |
| 1 cell = 1 m, width 10–120 × height 10–80 | `cellSize` is set per map (0.5 m default), any size |

A rooms-to-grid converter is straightforward: paint room outlines as `#`, paint openings as
`D`/`E`, and scatter `people` as `P`. That makes the prototype's presets (for example the Malin
Chelsea venue) loadable here.

## Changing the schema

The schema is a team contract. When it changes, update this doc, `schemas/map.schema.json`,
`docs/CONTRACTS.md` and `web/src/shared/types.ts` in the same commit. Bump `version` if the change
is breaking, and tell the team.
