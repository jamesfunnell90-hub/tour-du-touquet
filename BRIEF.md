# Tour du Touquet: brief for Claude Code

Owner: James. Trip: Tour du Touquet, Sat 19 and Sun 20 September 2026.
Goal for this session: **ship a working, shared, live-scoring web app before Saturday morning.** Keep changes focused. Don't rewrite what already works.

Visual reference: open `docs/mockup.html` in a browser. It shows the agreed design and the new formats. The layout, palette, badge, sketch and "LIBERTÉ • ÉGALITÉ • GOLF" motto are all signed off.

---

## 1. What exists already (in this folder)

A working no-build web app (plain ES modules, no framework), tested in a headless browser in demo mode.

| Path | What it is |
|---|---|
| `index.html` | App shell and all CSS (light and dark tokens, mobile first, max width 520px) |
| `js/app.js` | UI: tabs **Live, Score, Leaderboard, More** plus PIN-protected setup |
| `js/engine.js` | Pure scoring engine: handicap shots, Stableford, team formats, singles match play, skins, 2s, stats |
| `js/store.js` | Data layer. Uses Firebase Firestore when `firebase-config.js` has a config; otherwise **demo mode** (localStorage plus BroadcastChannel) |
| `js/seed.js` | Initial trip document, written on first load if the trip doesn't exist |
| `firebase-config.js` | `null` today, so the app runs in demo mode |
| `firestore.rules` | Only signed-in (anonymous) users can read and write under `trips/**`; everything else is closed |
| `courses/library.json` + `courses/<club>/<club>.json` | Course library: club → course → tee, with par, SI, lengths in **metres and yards**, hole names, image paths |
| `courses/belle-dune/hole-XX.jpg`, `course-map.jpg` | Hole graphics taken from the club scorecard |
| `assets/tour-badge.png`, `assets/tour-sketch-mask.png` | Tour badge; the sketch is an alpha mask recoloured with CSS (`--sketch`) |
| `docs/mockup.html` | Signed-off mockup (single file, sample data) |

Hosting target: **GitHub Pages** (public repo, deploy from `main` / root), with **Firebase Firestore** (Spark plan, `europe-west2`) and **Anonymous Auth**.

### Current data model (Firestore)
- `trips/{tripId}` holds a single document with everything except scores:
  `name, subtitle, pin, unit ('m'|'yd'), skinsMode, fillPar, currentRound, teams{id:{name,colour,order}}, players{id:{name,hcp,team}}, rounds{id:{...}}, bets[]`
- `trips/{tripId}/scores/{roundId}` stores `{ s: { <playerId | "T_<teamId>">: { h1: 5, h2: "P", ... } } }`. It is written per cell with `setDoc(..., {merge:true})`, so edits to different cells never clash.
- `trips/{tripId}/log/*` holds the change log `{text, by, at}`. Score changes are debounced to one entry per cell after 4 seconds.
- The default trip id is `touquet-2026`; `?trip=` in the URL overrides it. The setup PIN is `2026`. It is client-side only, a guard against accidents rather than security.

### Handicap rule (already implemented, keep it)
The player's full playing handicap is spread across all 18 holes by stroke index (`shotsOn(h, si)`): one shot where SI ≤ handicap, two where SI ≤ handicap − 18, and so on. Plus handicaps give shots back starting at SI 18. Any segment uses the shots that fall on its own holes. For 9-hole courses, half the handicap is spread over SI 1–9.

---

## 2. Main change: rounds become flexible hole segments (was front/back nine)

Today `round.nines = [{id:'front'|'back', format, points, bestN, allowance, matches}]`. Replace this with **segments**:

```js
round.segments = [
  { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1 },
  { id: "s2", from: 7, to: 12, format: "teambestn", count: 2, basis: "stableford", points: 1 },
  { id: "s3", from: 13, to: 18, format: "teambestn", count: 3, basis: "stableford", points: 1 },
]
```

- `from`/`to` is any contiguous hole range within the course. Presets in setup: **9 + 9**, **6 + 6 + 6**, **18**, plus custom.
- **Migration:** if a trip has `nines` but no `segments`, convert `front` to 1–9 and `back` to 10–18, keeping the other fields. Do this when the trip loads and write the result back on the next save.
- Every existing format stays available for any segment: `tbc`, `stableford` (team totals, best N), `betterball`, `scramble`, `singles`. **Add** `teambestn` (below).
- Everywhere that says "Front 9 / Back 9" should show "Holes X–Y" (keep "Front 9 / Back 9" as the label when the range is exactly 1–9 or 10–18).
- Score tab: segment buttons as in the mockup (range plus rule, e.g. "7–12 · Best 2 of 3"); the hole strip shows that segment's holes; "Next" moves on into the next segment automatically.

### New scoring basis setting (per segment)
`basis: "stableford" | "net" | "gross"`, **default `"stableford"`**, selectable in setup for every format where it makes sense (`teambestn`, `singles`, `betterball`; `stableford` is always Stableford; `scramble` stays net strokes).
- Stableford: points = max(0, par + shots − gross + 2). **Higher is better.**
- Net: gross − shots. Lower is better.
- Gross: gross. Lower is better.
- **Pick-up ("P"):** Stableford gives 0 points. Under net or gross, a pick-up ranks worse than any number. When comparing team totals that include pick-ups, the team with fewer counted pick-ups wins; if equal, compare the numeric sum of the rest. Two pick-ups against each other halve.

---

## 3. Confirmed formats for this weekend

### Saturday, Round 1: Golf de Belle Dune, Belle Dune course, Jaune tees (switchable on the morning)
Groups: **09:40 Anywhere But (James, Luke, Will)** and **09:50 Bushy Boys (Alex, Chris, Ronak)**.
Format **"Team 6-6-6"** (`teambestn`, basis Stableford):

| Holes | Counts per hole | Worth |
|---|---|---|
| 1–6 | Best **1** of the team's 3 | 1 point |
| 7–12 | Best **2** added | 1 point |
| 13–18 | All **3** added | 1 point |

Rules:
1. On each hole, each team's hole score = sum of its best `count` player values under the basis (Stableford: highest points).
2. The higher team score wins the hole (lower for net/gross). Equal scores halve.
3. **Pick-ups** count as 0 Stableford points. If all three pick up, their best score is the pick-up (0). If the other team also all pick up, the hole is halved. Under Stableford this falls out naturally (0 v 0), so no special case is needed.
4. A hole is compared only when **both teams have all their scores in** (the groups are 10 minutes apart). Until then the UI shows "waiting for other group".
5. Each segment is a **mini match**: holes won, match-play style. It is decided when the lead is bigger than the holes left ("2&1"); after the last hole it's "1 up" or "Halved". The winner gets `points` (1); a halve gives ½ each.
6. Score screen: each player enters their own gross score. Mark the players whose scores count on this hole ("✓ counts") and fade the others. The bottom bar shows team v team for the hole.
7. Live: one card per segment with status text plus a row of 6 hole squares filled with the winning team's colour (dashed when halved).

### Sunday, Round 2: Aa Saint-Omer Golf Club, Le Val course, 12:00 and 12:10
Groups to be confirmed after Saturday (setup UI already handles this).
Format: **singles match play, holes 1–18, three matches, 1 point each (3 in total)**, basis Stableford.
- A match's two players **may be in different groups**. A hole is decided once both players have scored it.
- Stableford basis: each player uses their own full handicap shots; more points wins the hole; equal points halve (including 0 v 0).
- Net basis keeps the existing option: handicap-difference allowance (`allowance` %, default 100), where the higher handicap gets the difference spread by SI.
- Status text: "Luke 2 up thru 7", "dormie", "wins 3&2", "Halved".
- Seed three empty match slots; "Pair by handicap" already exists.

### Cup
Saturday gives 3 points and Sunday 3. The total is 6, shown as "X of 6 points decided". Leaderboard → Team cup lists each segment and match on its own row.

---

## 4. Setup and deployment tasks (do these with James)

1. **GitHub:** create the public repo `tour-du-touquet`, commit this folder, and turn on Pages (main / root). Confirm the site loads and shows "Demo · this phone only".
2. **Firebase:** James creates the project (or use the Firebase CLI if he's logged in):
   - Firestore in `europe-west2`, production mode; deploy `firestore.rules`.
   - Authentication → Anonymous → enable.
   - Register a Web app and paste the config into `firebase-config.js`. The web API key is meant to be public.
   - Add `<user>.github.io` to Auth → Authorized domains.
3. **Test sync before the weekend (priority: this part is untested).** Use the Firestore emulator locally, or the live project with two browser profiles:
   - Score on one device; it appears on the other within about 2 seconds.
   - Offline: score in airplane mode, reconnect, and check it syncs. Uses `persistentLocalCache`.
   - Two devices editing different cells at the same time lose nothing.
   - Setup save on one device updates the other.
   - Check the `firebasejs/10.12.2` gstatic imports load (they couldn't be fetched from the build sandbox).
4. Update `js/seed.js` to the confirmed setup above: segments for R1, singles over 1–18 for R2, empty groups for R2, handicaps `null` until James enters them. **If the live trip document already exists, migrate it instead of reseeding, so no scores are lost.**

---

## 5. Acceptance tests (add `tests/engine.test.mjs`, run with `node --test`)

Belle Dune hole data is in `courses/belle-dune/belle-dune.json`. Sample handicaps: James 14, Luke 9, Will 22 (Anywhere But); Alex 18, Chris 6, Ronak 11 (Bushy Boys).

1. **Shots:** handicap 12 on the Belle Dune front 9 gets shots on holes 1, 2, 5, 7, 8 and 9 (6 in total). `shotsOn(20,1)=2`, `shotsOn(20,3)=1`, `shotsOn(-2,17)=-1`, `shotsOn(-2,16)=0`.
2. **Hole 1** (par 4, SI 12), best 1 of 3, Stableford:
   - Anywhere But: James 5 (1 shot) → 2, Luke 4 → 2, Will 6 (1 shot) → 1. Team = 2.
   - Bushy Boys: Alex 4 (1 shot) → 3, Chris 5 → 1, Ronak 4 → 2. Team = 3.
   - Result: **Bushy Boys win the hole.**
3. **Hole 7** (par 4, SI 5), best 2 of 3, Stableford:
   - Anywhere But: James 5 → 2, Luke 4 → 3, Will 7 → 0. Team = 5.
   - Bushy Boys: Alex 5 → 2, Chris 4 → 3, Ronak P → 0. Team = 5.
   - Result: **halved.**
4. **Pick-ups:** all three of one team pick up and all three of the other pick up: halved. All three of one team pick up while the other team's best is 1 point: the other team wins.
5. **Segment status:** after 4 of 6 holes, Anywhere But have won 3, Bushy Boys 0, with 1 halved. Result: "Anywhere But win 3&2", status final, 1 point to Anywhere But.
6. **Waiting:** a hole where only one group has scored isn't counted, and the segment "thru" count doesn't move.
7. **Singles** (Luke 9 v Chris 6, Stableford) on hole 7 (SI 5; both get a shot), both score 5: halved. A match 3 up with 2 to play is final: "3&2".
8. **Cup:** 3 segments + 3 matches = 6 points available; halves give ½.
9. **Migration:** a trip with `nines` front/back becomes segments 1–9 and 10–18 with the same format settings.
10. The existing engine tests still pass (team Stableford, better ball, scramble team handicap 20/15/10, skins, individual board excludes scramble).

UI smoke test (Playwright, demo mode): enter the PIN → set handicaps → save → score 3 holes for each group → Live shows segment 1 status and coloured hole squares → Leaderboard shows the cup row.

---

## 6. Guardrails
- Mobile first. Test at 390px wide in light and dark mode. Big tap targets on the Score tab (existing 46px steppers).
- Keep the no-build setup (GitHub Pages serves the files as they are). No framework migration this week.
- Don't break demo mode; it's the fallback if Firebase has problems on the day.
- UK English in the UI. Distances in metres or yards, switchable per phone.
- Don't store anything sensitive: names and handicaps only.

## 7. Backlog (after the trip, not now)
- Player library shared across trips (`people` collection); copy a trip as a template.
- Installable app (manifest plus service worker) with offline app shell.
- Course import from a scorecard photo or PDF; hole graphics for Le Val, Haute Drève and Aldenham; full per-tee distances for Le Val (currently only Noir has hole lengths).
- Ladies' par and SI per tee (Aldenham red is par 71).
- Real admin auth instead of a client-side PIN; per-trip write rules.
- Richer trip summary (best segment, head-to-head record), shareable results image.
- Course map view per hole (the `course-map.jpg` and hole images are stored for this).
