# Implementation Notes — ESPN-Only TV Board

## Source hierarchy

The schedule / network hierarchy is intentionally one layer deep: **ESPN**.

The ESG master spreadsheets are not allowed to override or fill ESPN broadcast fields. They perform two jobs only: identify represented players and make sure a known client matchup does not silently disappear if ESPN fails to return it. Any such placeholder is styled grey and marked `ESPN NOT FOUND` / `NOT FOUND` for TV.

No Google search, Sports Media Watch, team site, conference site or other network source is queried by this app.

## Client-first dashboard

The matchup card is a launcher. The expanded drawer prioritizes represented players before team information. Client profile images use ESPN's player headshot CDN based on the ESPN player IDs already stored in the masters. Direct player links use the ESPN URLs stored in the masters.

ESPN team roster/statistics/schedule links and team statistical-leader headshots are displayed only when they are present in the ESPN scoreboard response. Missing leader/link data is omitted or labeled unavailable rather than fabricated.

## PFF scope

The generated client data reads the `PFF Detail` sheet and attaches the latest completed row with an Overall Grade to each represented player. The matchup module sorts only represented players because the supplied PFF dataset is client-specific. The UI says `Top PFF Clients` rather than implying full-roster coverage.

## Missing network behavior

A game with no `competition.broadcasts[].names` value from ESPN receives:

- `NOT FOUND` instead of a network name
- grey schedule card treatment
- inclusion in the `Not found` filter
- a dashboard warning explicitly stating that no alternate source was used

This includes games that may ultimately be ESPN+ but for which ESPN has not returned the assignment in the schedule payload.
