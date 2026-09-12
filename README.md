# ESG College Football — Week 2 Command Center

GitHub/Render deployment package for the 2026 Week 2 college-football command center.

## Included

- Home/live command center: clients playing now, next up, TV rail and top performers.
- Automatic ESPN scoreboard check every 60 seconds for the focus date.
- ESPN summary checks for relevant live/final client games.
- Full Week 2 client master schedule.
- All-client stat table with manual all-Week-2 ESPN refresh.
- PFF display remains available but PFF network automation is disabled.
- Supplied ESG Football TV Board v1.7 as the TV Guide.
- Same-origin FastAPI ESPN proxy/cache.
- HTTP Basic protection.
- Render Free Blueprint.
- GitHub validation workflow.

## Deploy

See [`DEPLOY_GITHUB_RENDER_FREE.md`](DEPLOY_GITHUB_RENDER_FREE.md).

Quick path:

1. Create a **private** GitHub repository.
2. Upload all files in this package to repository root.
3. In Render choose **New → Blueprint** and connect the repo.
4. Enter `APP_PASSWORD` when prompted.
5. Deploy and sign in with username `esg`.

## Data integrity

The dashboard is a runtime/display layer. The 2026 College Football Client Stats Tracker remains authoritative for controlled publication.

Blank is not zero. Missing ESPN rows are not DNP. TKLS means total tackles. FF/FR remain separate. PFF remains a separately labeled provider.
