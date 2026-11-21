import { CellType, type CellTypeName } from "../shared/types";

/**
 * THE registry of everything a grid character can be. To add a new kind of cell:
 *   1. add its name to CellTypeName (shared/types.ts) and a code to CellType if it is a cell,
 *   2. add one entry here,
 *   3. give it a default character in DEFAULT_LEGEND.
 * Loader, validation and renderer are all driven from this table.
 */
export interface CellTypeSpec {
  /** Numeric code stored in MapModel.cells. */
  code: CellType;
  walkable: boolean;
  /** Blocks camera line of sight. */
  opaque: boolean;
  /** Voxel height in metres. null = use map.wallHeight. 0 = flat (floor only). */
  height: number | null;
  color: number;
  /** Base fuel 0..1 for the fire model (placeholder values; the fire owner may retune). */
  fuel: number;
  /** Spawns a person on this cell (the cell itself becomes `code`). */
  spawnsPerson?: boolean;
}

export const CELL_TYPES: Record<CellTypeName, CellTypeSpec> = {
  void: { code: CellType.Void, walkable: false, opaque: false, height: 0, color: 0x000000, fuel: 0 },
  floor: { code: CellType.Floor, walkable: true, opaque: false, height: 0, color: 0x2a2f38, fuel: 0.1 },
  wall: { code: CellType.Wall, walkable: false, opaque: true, height: null, color: 0xb8bcc6, fuel: 0 },
  door: { code: CellType.Door, walkable: true, opaque: false, height: 0, color: 0x4a7bd1, fuel: 0.3 },
  exit: { code: CellType.Exit, walkable: true, opaque: false, height: 0, color: 0x2ecc71, fuel: 0 },
  table: { code: CellType.Table, walkable: false, opaque: false, height: 0.75, color: 0x8b5a2b, fuel: 0.6 },
  chair: { code: CellType.Chair, walkable: false, opaque: false, height: 0.45, color: 0xc0703a, fuel: 0.5 },
  person: { code: CellType.Floor, walkable: true, opaque: false, height: 0, color: 0x2a2f38, fuel: 0.1, spawnsPerson: true },
};

export const DEFAULT_LEGEND: Record<string, CellTypeName> = {
  " ": "void",
  ".": "floor",
  "#": "wall",
  D: "door",
  E: "exit",
  T: "table",
  C: "chair",
  P: "person",
};

/** Reverse lookup: cell code → spec (person maps to floor). */
export const SPEC_BY_CODE: CellTypeSpec[] = [];
for (const name of Object.keys(CELL_TYPES) as CellTypeName[]) {
  const spec = CELL_TYPES[name];
  if (!spec.spawnsPerson) SPEC_BY_CODE[spec.code] = spec;
}
