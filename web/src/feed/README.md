# feed/ (owner: TBD, same person as server/)
Browser side of the live Gemini feed. Server and wire format: `server/README.md`.

- WebSocket client to `ws://<server>/ws` → stores the latest `Observation` per `cameraId` in `state.observations`.
  Messages are `{"type":"observation","observation":Observation}`. `GET /observations` returns the same data for polling.
- When the user moves a camera, send `{"type":"cameras","cameras":[CameraDef]}` so the server projects with the new pose.
- Ships a **mock** mode (fixed observations per camera) so the rest of the team is never blocked.
- Placing people: use `Observation.people` (cells, approximate) and snap each to the nearest walkable cell.
  If it's empty, spread `peopleCount` over the camera's `visibleCells`.
- `exits[].blocked` and `events` (`fire`, `smoke`, `exit_blocked`, `alarm`, `screaming`) are for crowd (routes) and ui (warnings).
  A camera fire/smoke event is a warning only; it doesn't start the sim (DECISIONS #22).
