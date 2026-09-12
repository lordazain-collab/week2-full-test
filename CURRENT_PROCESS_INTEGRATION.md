# ESG College Week 2 Command Center — current-process integration

This package is designed as a Week 2 module for the existing authenticated FastAPI/SQLite ESG Football service.

## 1. Serve the front end

Copy the package's `index.html`, `assets/`, `data/`, and `tv-guide/` under the static directory you use for the authenticated dashboard, for example:

- `/college/week2/` → this Week 2 Command Center
- `/college/week2/tv-guide/college.html?week=2` → the packaged ESG Football TV Board v1.7

Keep the route behind the same authentication middleware as the current dashboard.

## 2. Add the ESPN proxy/cache

Copy `server/week2_router.py` into the application package and include the router from the main FastAPI app:

```python
from .week2_router import router as week2_router
app.include_router(week2_router)
```

The front end first tries these same-origin routes:

- `GET /api/v1/college/week2/scoreboard?date=YYYY-MM-DD`
- `GET /api/v1/college/week2/summary/{ESPN_EVENT_ID}`

If they are not installed, the preview attempts the documented public ESPN JSON endpoints directly. The proxy is preferred in production because it centralizes caching and avoids browser CORS variability.

## 3. Controlled workbook / PFF

The page attempts to read `GET /api/v1/performances?week=2&league=college` from the existing normalized app. If that route returns Week 2 PFF fields, they display in the PFF tab and stats table.

No PFF endpoint is called automatically. PFF remains manual and source-labeled.

## 4. Runtime behavior

- ESPN scoreboard: automatic every 60 seconds for the current focus date.
- ESPN summary: one request per tracked live/final game, then each athlete is matched by ESPN Athlete ID.
- Final ESPN observations stay runtime snapshots until reviewed/reconciled into the controlled tracker.
- "Manual Refresh All Week 2 ESPN Stats" refreshes all Week 2 date scoreboards, then summaries only for live/final client games.
- Missing athlete rows remain blank and are never converted to zero or DNP.
- TKLS means total tackles; FF and FR are independent fields.
- Starts and snaps are not inferred from box-score absence.
- PFF automation is disabled.

## 5. TV Guide

`tv-guide/` is the supplied ESG Football TV Board v1.7. Its top-level navigation links were made relative for nested packaging, and its automatic PFF schedule verification call is disabled to honor the Week 2 manual-only PFF requirement. Its ESPN-primary watch-guide behavior and controlled PFF display surfaces remain.
