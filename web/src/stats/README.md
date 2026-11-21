# stats/ (owner: TBD, likely the crowd owner)
- Produces a `StatsSnapshot` each step: total / active / evacuated / casualties / trapped, and time-to-clear.
- **Bottlenecks:** a congestion score on door and corridor cells (agents waiting or slow over time), which `render/` highlights.
- **Scenario compare:** run two cloned states headless with the same seed (for example, the base map versus the map with an extra exit) and diff the snapshots.
