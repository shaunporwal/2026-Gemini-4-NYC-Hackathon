# shared/ (everyone; announce changes)
- `types.ts`: copied verbatim from `docs/CONTRACTS.md`. Every cross-module type lives here.
- Small pure helpers only: a seeded RNG (`makeRng(seed)` → `state.rng`), `createSimState(map, seed)`, and index helpers (`idx(x,y)`, `cellX(i)`, `cellY(i)`).
- No module-specific logic here.
