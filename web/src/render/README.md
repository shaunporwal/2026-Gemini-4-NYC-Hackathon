# render/ (owner: Jacob)
three.js voxel scene. Reads `MapModel` and `SimState`, draws them, and turns user input into intents.

- **Draws:** floor, walls, doors and exits (one InstancedMesh per type), furniture, fire/smoke overlays, agents, camera markers and view cones, bottleneck highlights.
- **Input:** click/tap → raycast to the floor plane → cell `(x, y)` → pushes `{type:"ignite"}` to `state.events`. Camera gizmos: drag to move, rotate to change yaw.
- **Rule:** never mutates sim layers or agents directly. Emit events instead.
- World mapping: `X = x*cellSize`, `Z = y*cellSize`, `Y` up (metres).
