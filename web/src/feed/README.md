# feed/ (owner: TBD, same person as server/)
Browser side of the live Gemini feed.

- WebSocket client → stores the latest `Observation` per `cameraId` in `state.observations`.
- Ships a **mock** mode (fixed counts per camera) so the rest of the team is never blocked.
- `Observation` in `docs/CONTRACTS.md` is a **draft**: the owner finalises it and updates the doc.
- Each camera's `visibleCells` (from `map/`) is where its observed people are placed.
