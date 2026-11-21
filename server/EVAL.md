# Headcount eval (for the pitch)

## Run 1: Hydrogen vs Carbon on real phone frames (2026-11-21)

- **Frames:** 21, evenly spaced from 121 frames filmed on one phone in the hackathon hall (`cam-entrance`).
  They include empty floor and doors, close-ups, busy tables with 8–11 people, motion blur, and the phone turned sideways.
- **Labels:** drafted by Claude from the images, with a confidence per frame (7 sure, 7 medium, 7 low: busy background tables).
  **Still to do:** a person who was there checks the low-confidence counts. Until then, treat these as provisional.
- **Same frames, same prompt** for both models (`eval_counts.py`; `VISION_MODEL` switched). Both runs ran at the same time, so the latencies include load.

| Model | MAE, all 21 | MAE, sure + medium (11) | Within ±1 | Gated pipeline MAE | Latency p50 / max |
|---|---|---|---|---|---|
| **gemini-4-hydrogen** | **0.29** | 0.36 | 100% | 0.33 | 5.7 s / 9.6 s |
| gemini-4-carbon | 0.43 | 0.36 | 95% | 0.43 | 5.3 s / 6.3 s |

- Both models: 0 false fire/smoke alarms on 21 frames; every empty frame counted as 0.
- Carbon over-counted the busiest frames (11 → 13, 8 → 9). Hydrogen's misses were ±1.
- Sideways phone and motion blur did not break either model.
- **Decision: keep Hydrogen** for live counting. Carbon is no more accurate here and not faster.

Raw results: `eval_frames/run_hydrogen/eval_results.csv`, `eval_frames/run_carbon/eval_results.csv` (gitignored; the frames are photos of people).
