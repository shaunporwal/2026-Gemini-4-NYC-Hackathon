import type { CameraDef, MapModel } from "../shared/types";

/** Compass yaw (0 = north = -y, 90 = east = +x) → unit vector in grid space. */
export function yawToDir(yawDeg: number): { dx: number; dy: number } {
  const r = (yawDeg * Math.PI) / 180;
  return { dx: Math.sin(r), dy: -Math.cos(r) };
}

/**
 * Walkable cells inside the camera's horizontal cone (yaw ± fov/2, within range) with line of
 * sight from the camera (opaque cells such as walls occlude). Cost is O(range² · range), fine
 * for interactive use on maps a few hundred cells wide.
 */
export function computeVisibleCells(map: MapModel, cam: CameraDef): Uint32Array {
  const { width, height, walkable } = map;
  const dir = yawToDir(cam.yaw);
  const cosHalf = Math.cos(((cam.fov / 2) * Math.PI) / 180);
  const out: number[] = [];

  const x0 = Math.max(0, Math.floor(cam.x - cam.range));
  const x1 = Math.min(width - 1, Math.ceil(cam.x + cam.range));
  const y0 = Math.max(0, Math.floor(cam.y - cam.range));
  const y1 = Math.min(height - 1, Math.ceil(cam.y + cam.range));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (!walkable[i]) continue;
      const vx = x + 0.5 - cam.x;
      const vy = y + 0.5 - cam.y;
      const dist = Math.hypot(vx, vy);
      if (dist > cam.range) continue;
      if (dist > 0.5 && (vx * dir.dx + vy * dir.dy) / dist < cosHalf) continue;
      if (hasLineOfSight(map, cam.x, cam.y, x + 0.5, y + 0.5)) out.push(i);
    }
  }
  return Uint32Array.from(out);
}

function hasLineOfSight(map: MapModel, ax: number, ay: number, bx: number, by: number): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const cx = Math.floor(ax + (bx - ax) * t);
    const cy = Math.floor(ay + (by - ay) * t);
    if (map.opaque[cy * map.width + cx]) return false;
  }
  return true;
}
