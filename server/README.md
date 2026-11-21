# server/ (owner: TBD)
A thin backend that **owns the Gemini API key** and interprets the live camera feeds (video and audio).

- Input: one or more camera streams, each tied to a `cameraId` from the map JSON.
- Output: `Observation` messages (see `docs/CONTRACTS.md`) pushed to the browser over WebSocket.
- Useful prompt context per camera: the camera `name`, the zone it overlooks, and what it should see (derived from the map). The browser can send this to the server on connect.
- Language (Python or Node), model, update rate and payload are the owner's call. Record them in `docs/DECISIONS.md`.
- Never runs the simulation. Never ships the key to the browser (`.env`, gitignored).
