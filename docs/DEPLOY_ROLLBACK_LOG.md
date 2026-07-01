# City Battle — Deploy / Rollback Log

Keep known-good deploy points so we can revert the LIVE demo fast if a change breaks loading.

## How the live demo deploys
- Repo: `github.com/fivelidz/qalarc.ai` → Cloudflare Pages → **qalarc.com/projects/city-battle/**
- Files live under `~/projects/qalarc.ai/projects/city-battle/` (viewer.js, map.html, data/*.json…).
- Rollback = `git checkout <good-sha> -- projects/city-battle/` then commit + push (stash-safe re:
  concurrent chanalyse pushes: `git stash push -u` if needed, only `git add projects/city-battle/`).

## Known-GOOD live points (qalarc.ai commits)

| qalarc.ai SHA | game-repo SHA | State | Notes |
|---|---|---|---|
| `18d8ca5102` | `220b8b2` | **SAFE FALLBACK** | Map N-E-S-W fix, smaller markers, maths fire panel, trajectory arcs. Map JSON was **still the lighter pre-suburb build** (no 89 polygons). Fast-ish load. |
| `3e186fe6dd` | `9b93103` | good | + combat POV viewer + slower combat. Still light JSON. |
| `fde9adff03` | `e5a5336` | good | + tooltips, portrait, immunity band. Still light JSON. |
| `f6c2062e55` | `671a74a` | current-ish | **First build with the 11.4 MB suburb-polygon JSON** — this is where load got SLOW (~7 s to fetch the JSON, feels stuck on phones). |

## 2026-07-01 — load-slowness incident
- Symptom: user reports online tactical map "no longer loading."
- Diagnosis: site DOES load & render (verified headless), but the **11.4 MB citymap JSON** takes
  ~6.9 s to download + parse + build 40k buildings; no loading progress feedback → looks frozen,
  and a stalled fetch never recovers.
- Fix direction: (1) shrink the JSON payload (drop heightmap precision to ints, compact suburb/road
  point precision, optionally gzip a `.json.gz`), (2) add a LOADING progress bar + a fetch timeout
  with retry + a clear error, (3) keep `18d8ca5102` as the instant fallback if needed.
- **If we must revert now:** `cd ~/projects/qalarc.ai && git checkout 18d8ca5102 -- projects/city-battle/ && git commit && push`.

*Last updated: 2026-07-01*
