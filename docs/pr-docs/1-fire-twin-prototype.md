# PR 1: Fire Twin prototype + one-screen UI

Status: done

Branch: `add-fire-twin-prototype`

## Goal

Put the plain-JS Fire Twin prototype in the repo, and make its UI fit one screen with no page scroll.

## Scope

In: `prototype/`, `docs/HANDOFF.md`, the venue floor plan PDF, README links, this doc.
Out: `web/`, `server/`, `schemas/` (not touched). Video input (PR 2). Any Gemini test (no key yet).

## Implementation Checklist

- [x] Import prototype files into `prototype/` (own `README.md` + `AGENTS.md`)
- [x] `docs/HANDOFF.md` + `docs/The_Malin_Chelsea_Floor_Plan.pdf`; README links
- [x] UI: shell is 100dvh; no page scroll; action buttons always visible
- [x] UI: stat tiles -> one key-value row
- [x] UI: Gemini settings, sliders, floor plan upload, layout JSON -> Setup dialog
- [x] UI: 44 px tap targets, 16 px inputs, one accent, tokens in `style.css`, "Sample data" tag

UI rules source: skill `site-taste` in `juntotechnologies/swarm-infra`.

## Known Limits

- `ops site-check` not run; rules applied by hand and measured in a browser.
- Dark theme only (map colors are fixed in `render.js`).
- Speed and Fire spread sliders are in Setup, not on the main screen.
- All Gemini calls are unverified (model ID, endpoint, PDF input).
- Malin layout: exits X1, X2 and all head counts are invented.

## Smoke Tests

Browser at 390x664 and 1440x900, served from `prototype/`:

- [x] No vertical or sideways scroll; no control under 44 px; no clipped label; no console errors
- [x] Click floor -> fire starts, PA text shows, counters move
- [x] Find fix -> candidates table fills (1440x900: "Unlock all", lost 116 -> 31)
- [x] Setup dialog fits at 390 px (measured, not seen in a screenshot)
