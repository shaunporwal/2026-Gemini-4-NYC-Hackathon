# shared/ (everyone; announce changes)

This document covers the TypeScript grid-map app. The current Malin Fire Twin controls and replay are documented in [the demo guide](../../../prototype/README.md).

- `types.ts`: copied verbatim from `docs/CONTRACTS.md`. Every cross-module type lives here.
- Small pure helpers only: a seeded RNG (`makeRng(seed)` → `state.rng`), `createSimState(map, seed)`, and index helpers (`idx(x,y)`, `cellX(i)`, `cellY(i)`).
- No module-specific logic here.
