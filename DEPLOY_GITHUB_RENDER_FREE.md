# GitHub + Render Free deployment

This folder is ready to use as the root of a **private GitHub repository** and deploy as a Render **Free** web service.

## GitHub

Create a private repository and upload this entire package so `main.py`, `render.yaml`, `requirements.txt`, and `index.html` are at repository root.

Do not commit `.env`, passwords, or API keys.

## Render

1. In Render choose **New → Blueprint**.
2. Connect the private GitHub repository.
3. Select the repository.
4. Render reads `render.yaml`.
5. Enter a strong `APP_PASSWORD` when prompted.
6. Deploy.

Default username: `esg`.

Health check: `/health`

`/health` is intentionally unauthenticated. All dashboard/static/API routes are protected by HTTP Basic authentication.

## Free-plan behavior

This package does not require persistent storage. The Week 2 baseline, TV Guide and UI ship in GitHub.

ESPN responses are cached in process for short periods only. A service restart can clear that cache without changing the baseline.

A free instance may sleep when idle. The first request after idle can therefore be slower. During games, keeping the dashboard open keeps the user-facing monitoring flow active.

## ESPN runtime

The page uses the same-origin server routes:

- `/api/v1/college/week2/scoreboard?date=YYYY-MM-DD`
- `/api/v1/college/week2/summary/{ESPN_EVENT_ID}`

The server caches scoreboard results for 30 seconds and game summaries for 45 seconds.

The browser automatically checks the focus date every 60 seconds. The manual Week 2 refresh remains available.

## PFF

PFF is deliberately manual. This deployment makes no automatic PFF requests.

## Controlled-data rule

This web service is a runtime/display layer and does not write to the controlled College master tracker.

Before PDF/report publication, reconcile displayed stats to the controlled `2026 College Football Client Stats Tracker`.

- Blank is not zero.
- Missing ESPN athlete row is not DNP.
- TKLS means total tackles.
- FF and FR remain separate.
- Starts and snaps are not inferred.
- ESPN conventional stats and PFF remain separate.

## Local test

macOS/Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export APP_USERNAME=esg
export APP_PASSWORD='choose-a-password'
uvicorn main:app --reload --port 8000
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:APP_USERNAME='esg'
$env:APP_PASSWORD='choose-a-password'
uvicorn main:app --reload --port 8000
```

Open `http://127.0.0.1:8000/`.
