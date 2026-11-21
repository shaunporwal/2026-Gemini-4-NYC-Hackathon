# ui/ (shared)
HUD and controls: live stats panel, start/pause/reset, a map picker (`?map=/maps/<file>.json`), compare-scenario button, and a camera list with a live Gemini summary per camera.
UI code only emits intents/events and reads state. Simulation logic doesn't belong here.
