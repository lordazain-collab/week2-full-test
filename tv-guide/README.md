# ESG Calendar: Watch Guide — v1.7

A client-first football operations watch guide for Exclusive Sports Group.

## Page structure

- `/` — **Calendar: Watch Guide** master summary with separate **NIL Summary** and **NFL Summary** panels and `CLICK MORE` links.
- `/college` — NIL / College Football weekly client watch guide.
- `/nfl` — NFL weekly client watch guide.

The two detailed pages are independent. They no longer navigate day-by-day. Each page is organized by **Week**, and every game card carries its own **day, date and kickoff time**.

## Default workflow

1. Open the master `Calendar: Watch Guide` page.
2. Review the current NIL and NFL week summaries.
3. Click More into the relevant weekly page.
4. The weekly page always opens on **BY CLIENTS**.
5. Client games are shown chronologically across the whole week, grouped inside the page by game day for scanability. The day is not a page/filter boundary.
6. Secondary tabs expose all ESPN games, TV-found games, ESPN TV-not-found games, ranked games and streaming games.
7. Click any matchup to open the client-first matchup dossier.

## Source policy

- **ESPN is primary** for schedule, kickoff, TV/streaming, stadium, location, weather, game status, team links and ESPN team leaders.
- **PFF is secondary only for TV verification.** It never silently replaces ESPN.
- If ESPN has no TV carrier, the game remains in the grey `NOT FOUND` state even if PFF lists a carrier.
- PFF grades in the bottom leaderboard come from the client master snapshot and rotate between top offensive and defensive clients.

## Weekly schedule behavior

The app reads the week number already stored in each master schedule row. Selecting a week loads each dated game day represented by that week and merges the ESPN responses into one weekly slate. Failed ESPN dates keep client placeholders visible rather than dropping the games.

The client priority view does **not** group or filter by network. The network matrix remains secondary.

## Run locally

```bash
npm start
```

Then open `http://localhost:3000/`.

## QA

```bash
npm run check
```

This validates `app.js`, `portal.js`, and `server.js` syntax.
