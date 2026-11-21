"""
Turn metrics.csv into the breaking-point table: latency and model calls by stream count and mode.
Writes breaking_point.csv for whoever builds the chart.

  python summarize_metrics.py
"""
import csv
import statistics
from collections import defaultdict
from pathlib import Path


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else None


rows = list(csv.DictReader(Path("metrics.csv").open()))
groups = defaultdict(list)
for r in rows:
    groups[(r["mode"], int(r["active_streams"]))].append(r)

out = []
print(f"{'mode':9} {'streams':>7} {'frames':>6} {'p50 ms':>7} {'p95 ms':>7} {'hydrogen %':>10} {'errors %':>8}")
for (mode, n), rs in sorted(groups.items()):
    lat = [int(r["end_to_end_ms"]) for r in rs]
    hyd = sum(int(r["called_hydrogen"]) for r in rs) / len(rs) * 100
    err = sum(1 - int(r["ok"]) for r in rs) / len(rs) * 100
    row = {"mode": mode, "streams": n, "frames": len(rs), "p50_ms": pct(lat, 50), "p95_ms": pct(lat, 95),
           "mean_ms": round(statistics.mean(lat)), "hydrogen_call_pct": round(hyd, 1), "error_pct": round(err, 1)}
    out.append(row)
    print(f"{mode:9} {n:7} {len(rs):6} {row['p50_ms']:7} {row['p95_ms']:7} {hyd:10.1f} {err:8.1f}")

with open("breaking_point.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
print("\nwrote breaking_point.csv")
