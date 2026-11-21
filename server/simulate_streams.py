"""
Stress test: pretend to be N cameras by posting saved JPEGs to the server.
Use it to find the breaking point without needing N phones.

  python simulate_streams.py --streams 6 --folder sample_frames --ms 1000 --seconds 60
  python summarize_metrics.py          # then read the table

Tip: delete metrics.csv before each session so runs don't mix.
Grab sample frames from a phone video:  ffmpeg -i clip.mp4 -vf fps=1,scale=640:-1 sample_frames/%04d.jpg
"""
import argparse
import asyncio
import itertools
import time
from pathlib import Path

import httpx


async def stream(client, url, cam, frames, ms, until):
    for f in itertools.cycle(frames):
        if time.time() > until:
            return
        t0 = time.time()
        try:
            await client.post(f"{url}/frame/{cam}", content=f.read_bytes(),
                              headers={"Content-Type": "image/jpeg"})
        except Exception as e:
            print(cam, "post failed:", e)
        await asyncio.sleep(max(0, ms / 1000 - (time.time() - t0)))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--streams", type=int, default=3)
    ap.add_argument("--folder", default="sample_frames")
    ap.add_argument("--ms", type=int, default=1000)
    ap.add_argument("--seconds", type=int, default=60)
    a = ap.parse_args()

    frames = sorted(Path(a.folder).glob("*.jpg"))
    if not frames:
        raise SystemExit(f"No .jpg files in {a.folder}")
    until = time.time() + a.seconds
    async with httpx.AsyncClient(timeout=30) as client:
        await asyncio.gather(*[
            # offset each stream so they don't all send the same frame
            stream(client, a.url, f"SIM{i + 1}", frames[i % len(frames):] + frames[:i % len(frames)], a.ms, until)
            for i in range(a.streams)
        ])
        state = (await client.get(f"{a.url}/observations")).json()
    print(f"\n{a.streams} streams @ {a.ms} ms, mode={state['mode']}")
    for cam, o in sorted(state["observations"].items()):
        s = o["stream"]
        print(f"  {cam}: latency {s['latencyMs']} ms, ok={s['ok']}, frames={s['frames']}, "
              f"decisions={s['decisionCalls']}, hydrogen={s['hydrogenCalls']}, err={s['error']}")


if __name__ == "__main__":
    asyncio.run(main())
