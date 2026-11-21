"""
Turn metrics.csv into the breaking-point table: latency and model calls by stream count and mode.
Writes breaking_point.csv for whoever builds the chart.

  python summarize_metrics.py [metrics.csv]

Rows have kind=frame (one per processed frame; end_to_end_ms = frame in -> Observation out) or
kind=hydrogen (gated mode: a background re-count finished; end_to_end_ms = frame in -> new count out).
Files from before the kind column count every row as a frame.
"""
import csv
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else None


src = Path(sys.argv[1] if len(sys.argv) > 1 else "metrics.csv")
rows = list(csv.DictReader(src.open()))
groups = defaultdict(list)
for r in rows:
    groups[(r["mode"], int(r["active_streams"]))].append(r)

out = []
print(f"{'mode':9} {'streams':>7} {'frames':>6} {'p50 ms':>7} {'p95 ms':>7} {'count p50':>9} {'hydrogen %':>10} {'errors %':>8}")
for (mode, n), rs in sorted(groups.items()):
    frames = [r for r in rs if r.get("kind", "frame") == "frame"]
    hyd = [r for r in rs if r.get("kind") == "hydrogen"] or [r for r in frames if int(r["called_hydrogen"])]
    if not frames:
        continue
    lat = [int(r["end_to_end_ms"]) for r in frames]
    count_lat = [int(r["end_to_end_ms"]) for r in hyd]
    hyd_pct = len(hyd) / len(frames) * 100
    err = sum(1 - int(r["ok"]) for r in frames) / len(frames) * 100
    row = {"mode": mode, "streams": n, "frames": len(frames), "p50_ms": pct(lat, 50), "p95_ms": pct(lat, 95),
           "mean_ms": round(statistics.mean(lat)), "count_p50_ms": pct(count_lat, 50),
           "hydrogen_call_pct": round(hyd_pct, 1), "error_pct": round(err, 1)}
    out.append(row)
    print(f"{mode:9} {n:7} {len(frames):6} {row['p50_ms']:7} {row['p95_ms']:7} {str(row['count_p50_ms']):>9} "
          f"{hyd_pct:10.1f} {err:8.1f}")

with open("breaking_point.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
print("\nwrote breaking_point.csv")
