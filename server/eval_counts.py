"""
Accuracy eval on frames the builders never tuned on (Track 1 style).

labels.csv (hand-labelled by Person 4):
  file,count,hazard,exit_blocked
  0001.jpg,12,none,0
  0002.jpg,0,fire,
  (hazard: none/fire/smoke; exit_blocked: 0/1 or blank if no exit in view)

  python eval_counts.py --folder holdout_frames --labels holdout_frames/labels.csv

Compares:
  baseline = one Hydrogen call per frame (count only)
  gated    = Decisions API first (people present? hazard? exit?), Hydrogen only if people present
"""
import argparse
import csv
import statistics
from pathlib import Path

import perception as P

ap = argparse.ArgumentParser()
ap.add_argument("--folder", required=True)
ap.add_argument("--labels", required=True)
a = ap.parse_args()

labels = list(csv.DictReader(open(a.labels)))
results = []
for i, lab in enumerate(labels, 1):
    jpeg = (Path(a.folder) / lab["file"]).read_bytes()
    has_exit = lab.get("exit_blocked", "") != ""
    r = {"file": lab["file"], "true_count": int(lab["count"])}
    try:
        b = P.run_hydrogen(jpeg)
        r.update(baseline_count=b["count"], baseline_ms=b["ms"])
    except Exception as e:
        r.update(baseline_count=None, baseline_ms=None, baseline_err=str(e)[:120])
    try:
        d = P.run_decisions(jpeg, P.build_questions(has_exit))
        gated_ms = d["ms"]
        if d["people_present"] >= 0.5:
            h = P.run_hydrogen(jpeg)
            gated_count, gated_ms = h["count"], gated_ms + h["ms"]
        else:
            gated_count = 0
        r.update(gated_count=gated_count, gated_ms=gated_ms, pred_hazard=d["hazard"],
                 hazard_conf=round(d["hazard_conf"], 2), true_hazard=lab.get("hazard") or "none")
        if has_exit:
            r.update(pred_exit=int(d["exit_blocked"] >= 0.6), true_exit=int(lab["exit_blocked"]))
    except Exception as e:
        r.update(gated_count=None, gated_err=str(e)[:120])
    results.append(r)
    print(f"[{i}/{len(labels)}] {lab['file']}: true {r['true_count']} | "
          f"baseline {r.get('baseline_count')} | gated {r.get('gated_count')} | hazard {r.get('pred_hazard')}")

keys = sorted({k for r in results for k in r})
with open("eval_results.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=keys)
    w.writeheader()
    w.writerows(results)


def mae(col):
    xs = [abs(r[col] - r["true_count"]) for r in results if r.get(col) is not None]
    return round(statistics.mean(xs), 2) if xs else None


def within1(col):
    xs = [abs(r[col] - r["true_count"]) <= 1 for r in results if r.get(col) is not None]
    return f"{100 * sum(xs) / len(xs):.0f}%" if xs else None


print("\n=== Headcount ===")
print(f"baseline  MAE {mae('baseline_count')}  within±1 {within1('baseline_count')}")
print(f"gated     MAE {mae('gated_count')}  within±1 {within1('gated_count')}")

hz = [r for r in results if "pred_hazard" in r]
if hz:
    acc = sum(r["pred_hazard"] == r["true_hazard"] for r in hz) / len(hz)
    false_alarms = sum(r["true_hazard"] == "none" and r["pred_hazard"] != "none" for r in hz)
    missed = sum(r["true_hazard"] != "none" and r["pred_hazard"] == "none" for r in hz)
    print(f"\n=== Hazard ===\naccuracy {acc:.0%}  false alarms {false_alarms}  missed {missed}  (n={len(hz)})")
ex = [r for r in results if "pred_exit" in r]
if ex:
    acc = sum(r["pred_exit"] == r["true_exit"] for r in ex) / len(ex)
    print(f"\n=== Exit blocked ===\naccuracy {acc:.0%}  (n={len(ex)})")
print("\nwrote eval_results.csv (sort by error to build the failure table)")
