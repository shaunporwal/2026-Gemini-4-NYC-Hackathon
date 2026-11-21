# Map JSON Schema (v1)

The map file is the **single source of truth for the venue**. Everything that is drawn or
simulated comes from it. Machine-readable schema: [`schemas/map.schema.json`](../schemas/map.schema.json).
Example: [`web/public/maps/demo-hall.json`](../web/public/maps/demo-hall.json).

## Coordinate system (memorise this)

```
        x → (columns)                 three.js world:
  y   ┌──────────────┐                  X = x * cellSize
  ↓   │  rows[0]     │  north (yaw 0)   Z = y * cellSize
      │  rows[1]     │                  Y = up (metres)
      └──────────────┘
```

- **Horizontal units are cells.** `x` = column, `y` = row, origin top-left of `rows[0]`.
  Cell `(x, y)` covers `[x, x+1) × [y, y+1)`; its centre is `(x+0.5, y+0.5)`.
- **Vertical units are metres** (`height`, `wallHeight`).
- `cellSize` converts cells → metres (default `0.5`).
- **Yaw** is a compass bearing in degrees: `0` = north (−y, toward `rows[0]`), `90` = east
  (+x), `180` = south, `270` = west. Clockwise positive.
- **Pitch** in degrees: `0` = horizontal, negative = looking down.
- Flat cell index: `i = y * width + x` (used by all typed-array layers).

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `1` | yes | Bump on breaking schema change. |
| `name` | string | yes | Shown in UI and in Gemini prompts. |
| `cellSize` | number (m) | no, `0.5` | Metres per cell. |
| `wallHeight` | number (m) | no, `3` | Voxel height of wall cells. |
| `legend` | `{char: CellType}` | no | Defaults below; override or add characters. |
| `rows` | string[] | yes | All rows **must be the same length**. `width = rows[0].length`, `height = rows.length`. Any size works. |
| `objects` | MapObject[] | no | Furniture / obstacles placed on floor cells. |
| `zones` | Zone[] | no | Named rectangles for stats, labels and prompt text. |
| `cameras` | CameraDef[] | no | Camera placements (see below). |

### Cell types & default legend

| Char | CellType | Walkable | Notes |
|---|---|---|---|
| `#` | `wall` | no | Blocks movement and camera line-of-sight. |
| `.` | `floor` | yes | |
| `D` | `door` | yes | Interior opening; candidate bottleneck. |
| `E` | `exit` | yes | Agent reaching it is **evacuated**. Put on the outer wall. |
| ` ` | `void` | no | Outside the building; not rendered. |

### MapObject (furniture / obstacles)

```json
{ "id": "bar", "type": "bar", "x": 34, "y": 14, "w": 3, "h": 14, "height": 1.1 }
```

- Axis-aligned footprint `x, y, w, h` in cells (covers `x..x+w-1`, `y..y+h-1`).
- `type`: `table | chair | bar | stage | seating | shelf | obstacle`.
- Optional overrides: `height` (m), `blocksMovement` (bool), `fuel` (0–1, for the fire model).
  Defaults per type will live in `web/src/map/catalog.ts` (see the table below).
- `stage` defaults to walkable (`blocksMovement: false`), everything else blocks.

| type | height (m) | blocksMovement | fuel |
|---|---|---|---|
| table | 0.75 | yes | 0.6 |
| chair | 0.45 | yes | 0.5 |
| bar | 1.1 | yes | 0.8 |
| stage | 0.5 | no | 0.7 |
| seating | 0.5 | yes | 0.9 |
| shelf | 2.0 | yes | 0.9 |
| obstacle | 1.0 | yes | 0.2 |

An empty floor cell has a base fuel of 0.1. The fuel values are placeholders for the fire owner to retune.

### Zone

```json
{ "id": "main-hall", "name": "Main Hall", "x": 1, "y": 1, "w": 39, "h": 38 }
```
Used for per-room stats ("Main Hall: 120 people, 3 trapped") and human-readable context.

### CameraDef

```json
{ "id": "cam-hall-ne", "name": "Main Hall NE corner",
  "x": 38.5, "y": 1.5, "height": 2.8,
  "yaw": 225, "pitch": -30, "fov": 90, "range": 40 }
```

| Field | Unit | Notes |
|---|---|---|
| `id` | string | Stable key. The Gemini feed reports observations by this id. |
| `x`, `y` | cells (float) | Position on the plan. Use `.5` to centre in a cell. |
| `height` | metres | Mounting height. |
| `yaw` | degrees | Compass bearing (see above). |
| `pitch` | degrees | Negative = down. |
| `fov` | degrees | Horizontal field of view. |
| `range` | cells | Max view distance. |

The runtime derives `visibleCells` for each camera: cells inside the horizontal cone
(`yaw ± fov/2`, within `range`) **with line of sight** (walls occlude). Observations from
the Gemini feed are distributed only into a camera's visible walkable cells.
Cameras are draggable/rotatable in 3D; the edited values can be exported back to JSON.

## Validation rules (to be enforced by the map loader, `web/src/map/loader.ts`)
1. `rows` non-empty, all rows equal length.
2. Every character appears in the (merged) legend.
3. At least one `exit` cell.
4. Objects and zones lie inside the grid; object ids and camera ids are unique.
5. Objects must sit on `floor` cells (warn, not fail, if they overlap doors/exits).

## Changing the schema
The schema is a team contract. Change it by: updating this doc + `schemas/map.schema.json`
+ `docs/CONTRACTS.md` / `web/src/shared/types.ts` in the same commit, bump `version` if breaking, and tell the team.
