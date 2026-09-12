# ESG Calendar: Watch Guide v1.7 — Manifest

## Core
- `index.html` — master Calendar: Watch Guide summary.
- `portal.js` — current-week NFL/NIL summary renderer.
- `college.html` — NIL / College weekly watch guide.
- `nfl.html` — NFL weekly watch guide.
- `app.js` — weekly schedule loading, client overlays, PFF TV verification, weekly filters, matchup dossier and PFF leaderboard.
- `styles.css` — executive watch-guide UI including weekly navigation and master summary panels.
- `server.js` — static server plus ESPN and PFF proxy routes.
- `data/client-data.js` — compiled college + NFL client/schedule snapshot.

## Supporting
- `scripts/build_client_data.py`
- `render.yaml`
- `package.json`
- `README.md`
- `docs/IMPLEMENTATION_NOTES.md`
- `docs/QA_REPORT.md`

## v1.7 changes
- New master header/page: **Calendar: Watch Guide**.
- Master page now contains **NIL Summary** and **NFL Summary**, each with `CLICK MORE` navigation.
- Removed day-by-day navigation from both detailed calendars.
- Detailed calendars are controlled by **week number**.
- Every matchup card now shows its individual **day + date + time** prominently.
- Client tab remains the default and does not use network grouping.
- Secondary network matrix now carries day/date in each kickoff column so multi-day weekly slates remain unambiguous.
- Week-level copy rundown and ICS export.
