"""
Map geometry for the perception server: cameras and exits from the map JSON, and the
image -> floor projection that turns Hydrogen's foot positions into cell coordinates.

Coordinates follow docs/MAP_SCHEMA.md: x = column, y = row (cells, origin top-left, y down),
heights in metres, yaw = compass degrees (0 = north = -y, 90 = east = +x), pitch negative = down.
"""
import json
import math
import re
import subprocess
from pathlib import Path

# Mirrors DEFAULT_LEGEND in web/src/map/cellTypes.ts (schema v2). Only walls are opaque.
DEFAULT_LEGEND = {" ": "void", ".": "floor", "#": "wall", "D": "door", "E": "exit",
                  "T": "table", "C": "chair", "P": "person"}


class MapInfo:
    def __init__(self, path: Path):
        m = json.loads(Path(path).read_text())
        self.name = m["name"]
        dims = m["dimensions"]
        self.width, self.height = int(dims["width"]), int(dims["height"])
        self.cell_size = float(dims.get("cellSize", 0.5))
        legend = {**DEFAULT_LEGEND, **m.get("legend", {})}
        self.cells = [legend.get(ch, "void") for row in m["rows"] for ch in row]  # flat, i = y * width + x
        self.cameras = {}
        for c in m.get("cameras", []):
            self.set_camera(c)
        self.exit_groups = self._exit_groups()

    def set_camera(self, c: dict):
        """Store a schema-v2 CameraDef (position / orientation / lens) as a flat dict."""
        self.cameras[c["id"]] = {
            "id": c["id"], "name": c.get("name", c["id"]),
            "x": float(c["position"]["x"]), "y": float(c["position"]["y"]), "z": float(c["position"]["z"]),
            "yaw": float(c["orientation"]["yaw"]), "pitch": float(c["orientation"]["pitch"]),
            "fov": float(c["lens"]["fov"]), "range": float(c["lens"]["range"]),
        }

    def cell(self, x: int, y: int) -> str:
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.cells[y * self.width + x]
        return "void"

    def _exit_groups(self) -> list[list[int]]:
        """Exits have no IDs in the map, so a run of touching E cells is one exit (flat indices)."""
        seen, groups = set(), []
        for i, t in enumerate(self.cells):
            if t != "exit" or i in seen:
                continue
            stack, group = [i], []
            seen.add(i)
            while stack:
                j = stack.pop()
                group.append(j)
                x, y = j % self.width, j // self.width
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    k = ny * self.width + nx
                    if 0 <= nx < self.width and 0 <= ny < self.height and k not in seen and self.cells[k] == "exit":
                        seen.add(k)
                        stack.append(k)
            groups.append(sorted(group))
        return groups

    def _in_view(self, cam: dict, tx: float, ty: float) -> bool:
        dx, dy = tx - cam["x"], ty - cam["y"]
        dist = math.hypot(dx, dy)
        if dist > cam["range"] or dist < 1e-6:
            return False
        bearing = math.degrees(math.atan2(dx, -dy)) % 360  # compass bearing of the target
        off = (bearing - cam["yaw"] + 180) % 360 - 180
        if abs(off) > cam["fov"] / 2:
            return False
        # line of sight: walls block, stop one cell short so the wall around the exit doesn't count
        steps = int(dist * 4)
        for s in range(1, steps):
            px, py = cam["x"] + dx * s / steps, cam["y"] + dy * s / steps
            if math.hypot(tx - px, ty - py) < 1.0:
                break
            if self.cell(int(px), int(py)) == "wall":
                return False
        return True

    def visible_exits(self, cam_id: str) -> list[dict]:
        """Exit groups with at least one cell this camera can see: [{"cells": [...]}] (exits have no ids here)."""
        cam = self.cameras.get(cam_id)
        if not cam:
            return []
        out = []
        for g in self.exit_groups:
            if any(self._in_view(cam, i % self.width + 0.5, i // self.width + 0.5) for i in g):
                out.append({"cells": g})
        return out

    def project(self, cam_id: str, u: float, v: float, aspect: float):
        """Image fraction (u right, v down, 0..1) of a person's feet -> floor point in cells, or None.
        Pinhole camera at the map pose, rays hit the floor plane. aspect = image height / width.
        Approximate: no lens distortion, assumes the map's fov is the image's horizontal fov."""
        cam = self.cameras.get(cam_id)
        if not cam:
            return None
        yaw, pitch = math.radians(cam["yaw"]), math.radians(cam["pitch"])
        fx, fy = math.sin(yaw), -math.cos(yaw)  # horizontal forward (x, y)
        rx, ry = math.cos(yaw), math.sin(yaw)  # right
        fwd = (math.cos(pitch) * fx, math.cos(pitch) * fy, math.sin(pitch))  # z up
        up = (-math.sin(pitch) * fx, -math.sin(pitch) * fy, math.cos(pitch))
        th = math.tan(math.radians(cam["fov"]) / 2)
        tv = th * aspect
        a, b = (2 * u - 1) * th, (1 - 2 * v) * tv
        d = (fwd[0] + a * rx + b * up[0], fwd[1] + a * ry + b * up[1], fwd[2] + b * up[2])
        if d[2] >= -1e-6:  # at or above the horizon (model error): put it at max range on that bearing
            hx, hy = d[0], d[1]
            n = math.hypot(hx, hy) or 1.0
            px, py = hx / n * cam["range"], hy / n * cam["range"]
            dist = cam["range"]
        else:
            t = cam["z"] / -d[2]  # metres along the ray
            px, py = d[0] * t / self.cell_size, d[1] * t / self.cell_size  # offset in cells
            dist = math.hypot(px, py)
        if dist > cam["range"]:
            px, py = px * cam["range"] / dist, py * cam["range"] / dist
        x = min(max(cam["x"] + px, 0.0), self.width - 0.01)
        y = min(max(cam["y"] + py, 0.0), self.height - 0.01)
        return {"x": round(x, 2), "y": round(y, 2)}


def jpeg_aspect(jpeg: bytes) -> float:
    """Height / width read from the JPEG's SOF marker (no Pillow needed). Falls back to 3:4."""
    i = 2
    while i + 9 < len(jpeg):
        if jpeg[i] != 0xFF:
            i += 1
            continue
        marker = jpeg[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h = int.from_bytes(jpeg[i + 5:i + 7], "big")
            w = int.from_bytes(jpeg[i + 7:i + 9], "big")
            return h / w if w else 0.75
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + int.from_bytes(jpeg[i + 2:i + 4], "big")
    return 0.75


# ---------------------------------------------------------------- room mode (prototype layouts)

def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_venue(spec: str, layouts_js: Path) -> dict:
    """spec = a preset name in prototype/layouts.js (e.g. "malin"), read with Node so there is one copy
    of the layout, or a path to a layout JSON (for example one saved from the prototype's Setup panel)."""
    if spec.endswith(".json"):
        return json.loads(Path(spec).read_text(encoding="utf-8"))
    js = f"const L=require({json.dumps(str(layouts_js))});const v=L[{json.dumps(spec)}];"          f"if(!v){{console.error('no preset '+{json.dumps(spec)}+'; have: '+Object.keys(L));process.exit(1)}}"          "process.stdout.write(JSON.stringify(v))"
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8", check=True)
    except FileNotFoundError:
        raise SystemExit("VENUE needs Node.js to read prototype/layouts.js (or pass a .json layout path)")
    except subprocess.CalledProcessError as e:
        raise SystemExit(f"VENUE={spec}: {e.stderr.strip()}")
    return json.loads(out.stdout)


class VenueInfo:
    """A prototype layout (rooms, doors, exits; see prototype/sim.js). One camera per room: the phone says
    which room it is in, so there is no camera pose and no room guessing. People get no floor positions;
    the prototype places a room's count inside the room itself."""

    def __init__(self, layout: dict):
        self.name = layout["name"]
        self.width = int(layout["width"])
        self.exits = layout.get("exits", [])
        self.cameras = {}
        for r in layout["rooms"]:
            cid = slug(r["name"])
            self.cameras[cid] = {"id": cid, "name": r["name"], "room": r["name"],
                                 "rect": (r["x"], r["y"], r["w"], r["h"])}

    def visible_exits(self, cam_id: str) -> list[dict]:
        """Exits on this room's walls (room rectangles include their walls): [{"id", "cells"}]."""
        cam = self.cameras.get(cam_id)
        if not cam:
            return []
        x, y, w, h = cam["rect"]
        out = []
        for e in self.exits:
            if e["x"] < x + w and e["x"] + e["w"] > x and e["y"] < y + h and e["y"] + e["h"] > y:
                cells = [(e["y"] + j) * self.width + e["x"] + i for j in range(e["h"]) for i in range(e["w"])]
                out.append({"id": e["id"], "cells": cells})
        return out

    def project(self, cam_id, u, v, aspect):
        return None  # no camera pose in room mode

    def set_camera(self, c: dict):
        raise KeyError("room mode has no camera poses")
