from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

required = [
    "index.html",
    "assets/styles.css",
    "assets/week2.js",
    "data/week2-baseline.js",
    "server/week2_router.py",
    "tv-guide/index.html",
    "tv-guide/college.html",
    "render.yaml",
    "requirements.txt",
    "main.py",
]
missing = [p for p in required if not (ROOT / p).exists()]
if missing:
    raise SystemExit("Missing required files: " + ", ".join(missing))

html = (ROOT / "index.html").read_text(encoding="utf-8")
js = (ROOT / "assets" / "week2.js").read_text(encoding="utf-8")
manifest = json.loads((ROOT / "BUILD_MANIFEST.json").read_text(encoding="utf-8"))

if "Week 2" not in html:
    raise SystemExit("index.html is not recognized as the Week 2 dashboard.")
if "const AUTO_MS = 60000" not in js:
    raise SystemExit("60-second ESPN polling constant is missing.")
if "/api/v1/college/week2" not in js:
    raise SystemExit("Week 2 ESPN proxy path is missing.")
if "Manual Week 2 refresh complete" not in js:
    raise SystemExit("Manual all-Week-2 refresh workflow is missing.")
if manifest.get("automatic", {}).get("pff") is not False:
    raise SystemExit("PFF automation must remain disabled.")

print("Package validation: PASS")
