import { CellType, type CameraState, type CellTypeName, type MapFile, type MapModel, type PersonSpawn } from "../shared/types";
import { CELL_TYPES, DEFAULT_LEGEND } from "./cellTypes";
import { computeVisibleCells } from "./cameras";

export class MapValidationError extends Error {
  constructor(readonly mapName: string, readonly problems: string[]) {
    super(`Map "${mapName}" is invalid:\n  - ${problems.join("\n  - ")}`);
  }
}

export async function fetchMap(url: string): Promise<{ file: MapFile; model: MapModel }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load map ${url} (HTTP ${res.status})`);
  const file = (await res.json()) as MapFile;
  return { file, model: buildMap(file) };
}

/**
 * Validate a MapFile and build the static runtime MapModel. Works for any grid size.
 * Collects every problem it finds and throws one MapValidationError listing them all.
 */
export function buildMap(file: MapFile): MapModel {
  const name = file?.name ?? "?";
  const problems: string[] = [];

  if (file?.version !== 2) problems.push(`"version" must be 2 (got ${JSON.stringify(file?.version)})`);
  if (!file?.name) problems.push(`"name" is required`);
  const dims = file?.dimensions;
  const posInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  if (!dims || !posInt(dims.width) || !posInt(dims.height)) {
    problems.push(`"dimensions" must have positive integer "width" and "height" (in cells)`);
  }
  if (!Array.isArray(file?.rows) || file.rows.length === 0) problems.push(`"rows" must be a non-empty array of strings`);
  if (problems.length) throw new MapValidationError(name, problems);

  const rows = file.rows;
  const { width, height } = dims;
  if (rows.length !== height) problems.push(`"rows" has ${rows.length} rows, dimensions.height is ${height}`);
  rows.forEach((r, y) => {
    if (typeof r !== "string") problems.push(`row ${y} is not a string`);
    else if (r.length !== width) problems.push(`row ${y} has ${r.length} characters, dimensions.width is ${width}`);
  });

  const legend: Record<string, CellTypeName> = { ...DEFAULT_LEGEND, ...(file.legend ?? {}) };
  for (const [ch, type] of Object.entries(legend)) {
    if (ch.length !== 1) problems.push(`legend key ${JSON.stringify(ch)} must be exactly one character`);
    if (!CELL_TYPES[type]) problems.push(`legend '${ch}' maps to unknown type "${type}"`);
  }
  if (problems.length) throw new MapValidationError(name, problems);

  const n = width * height;
  const cells = new Uint8Array(n);
  const walkable = new Uint8Array(n);
  const opaque = new Uint8Array(n);
  const baseFuel = new Float32Array(n);
  const exits: number[] = [];
  const people: PersonSpawn[] = [];
  const unknown = new Map<string, string>(); // char → first location

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const spec = CELL_TYPES[legend[ch]];
      if (!spec) {
        if (!unknown.has(ch)) unknown.set(ch, `(${x}, ${y})`);
        continue;
      }
      const i = y * width + x;
      cells[i] = spec.code;
      walkable[i] = spec.walkable ? 1 : 0;
      opaque[i] = spec.opaque ? 1 : 0;
      baseFuel[i] = spec.fuel;
      if (spec.code === CellType.Exit) exits.push(i);
      if (spec.spawnsPerson) people.push({ id: people.length, x: x + 0.5, y: y + 0.5 });
    }
  }
  for (const [ch, at] of unknown) {
    problems.push(`unknown character ${JSON.stringify(ch)} first seen at ${at}; add it to "legend"`);
  }
  if (exits.length === 0) problems.push(`map has no exit cells (use 'E')`);

  // Zones
  const zones = file.zones ?? [];
  const zoneOf = new Int16Array(n).fill(-1);
  zones.forEach((z, zi) => {
    if (z.x < 0 || z.y < 0 || z.w < 1 || z.h < 1 || z.x + z.w > width || z.y + z.h > height) {
      problems.push(`zone "${z.id}" is outside the ${width}×${height} grid`);
      return;
    }
    for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) zoneOf[y * width + x] = zi;
  });

  // Cameras
  const camIds = new Set<string>();
  for (const c of file.cameras ?? []) {
    if (camIds.has(c.id)) problems.push(`duplicate camera id "${c.id}"`);
    camIds.add(c.id);
    const { position: p, orientation: o, lens: l } = c;
    if (!p || !o || !l) {
      problems.push(`camera "${c.id}" needs "position", "orientation" and "lens" blocks`);
      continue;
    }
    if (!(p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)) {
      problems.push(`camera "${c.id}" at (${p.x}, ${p.y}) is outside the ${width}×${height} grid`);
    }
    if (!(l.fov > 0 && l.fov <= 180 && l.range > 0)) problems.push(`camera "${c.id}" lens needs 0 < fov <= 180 and range > 0`);
  }

  if (problems.length) throw new MapValidationError(name, problems);

  const model: MapModel = {
    name: file.name,
    width,
    height,
    cellSize: dims.cellSize ?? 0.5,
    wallHeight: dims.wallHeight ?? 3,
    cells,
    walkable,
    opaque,
    baseFuel,
    zoneOf,
    zones,
    cameras: [],
    exitCells: Uint32Array.from(exits),
    people,
  };
  model.cameras = (file.cameras ?? []).map((c): CameraState => ({ ...c, visibleCells: computeVisibleCells(model, c) }));
  return model;
}

/** Serialize the map back to JSON (e.g. after cameras were moved in the 3D view). */
export function exportMap(model: MapModel, original: MapFile): MapFile {
  return { ...original, cameras: model.cameras.map(({ visibleCells: _v, ...def }) => def) };
}
