# TypeScript grid-map app

This app develops the schema-v2 map loader, camera geometry and three.js grid scene. Its crowd adapter in `src/crowd/voxelSimulation.ts` loads the simulation core from `prototype/sim.js` and supplies grid terrain and spawn cells. The app supports ignition, pause, reset and replay.

For the team's Malin Fire Twin with **Learn a second exit** and **Doorway queues**, follow [the current demo quick start](../README.md#open-the-current-fire-twin).

## Run this app

```bash
cd web
npm install
npm run dev
```

Open the Vite URL, normally http://localhost:5173/. Select another grid with `?map=/maps/cafe.json`. Run `npm run build` to typecheck and build.

The schema is in [MAP_SCHEMA.md](../docs/MAP_SCHEMA.md), cross-module contracts in [CONTRACTS.md](../docs/CONTRACTS.md), and integration plans in [ARCHITECTURE.md](../docs/ARCHITECTURE.md). Module README files describe their implemented entry points and intended integration responsibilities.
