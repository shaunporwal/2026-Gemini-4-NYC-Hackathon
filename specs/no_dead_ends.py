"""No dead end: from every reachable state, every goal can still be reached.

Reads the state graph that TLC wrote (-dump dot) and, for each goal, searches backward from the
goal states. A state that cannot reach a goal is a dead end for that goal.

    java -cp tla2tools.jar tlc2.TLC -config AppFlow_fixed.cfg -dump dot,actionlabels flow.dot AppFlow.tla
    python3 no_dead_ends.py flow.dot
"""
import re
import sys
from collections import defaultdict

# Goal name -> text that the state must contain (TLC prints a state as "var = value" lines).
GOALS = {
    "room picker": ['page = "pick"'],
    "camera page": ['page = "camera"'],
    "camera live": ['cam = "live"'],
    "twin": ['page = "twin"'],
    "twin, fresh sim": ['page = "twin"', 'sim = "idle"'],
    "fire running": ['sim = "running"'],
    "run complete": ['sim = "done"'],
    "fix ready to apply": ["fix = TRUE"],
    "2D view": ['page = "twin"', 'view = "2d"'],
    "3D view": ['page = "twin"', 'view = "3d"'],
    "Live view": ['page = "twin"', 'view = "live"'],
}


def load(path):
    text = open(path).read()
    nodes = {n: label.replace('\\"', '"').replace("\\n", " ")
             for n, label in re.findall(r'^(-?\d+) \[label="((?:[^"\\]|\\.)*)"', text, re.M)}
    back = defaultdict(set)
    for a, b in re.findall(r"^(-?\d+) -> (-?\d+)", text, re.M):
        back[b].add(a)
    return nodes, back


def main(path):
    nodes, back = load(path)
    if not nodes:
        print("no states in the graph: TLC did not run. Nothing was checked.")
        return 2
    bad = 0
    print(f"{len(nodes)} states")
    for goal, needs in GOALS.items():
        seen = {n for n, label in nodes.items() if all(x in label for x in needs)}
        todo = list(seen)
        while todo:
            for p in back[todo.pop()]:
                if p not in seen:
                    seen.add(p)
                    todo.append(p)
        stuck = len(nodes) - len(seen)
        bad += stuck > 0
        print(f"  {'DEAD END' if stuck else 'ok      '}  {goal}: " + (f"{stuck} states cannot reach it" if stuck else "reachable from every state"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
