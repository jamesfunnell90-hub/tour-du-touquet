# Tour du Touquet

Live golf scoring for the Tour du Touquet: team cup, hole-by-hole scoring, leaderboards and side bets.
Hosted on GitHub Pages, with live sync through Firebase Firestore.

## Files
- `index.html` the app
- `js/` app code (`engine.js` does all the scoring maths)
- `firebase-config.js` paste your Firebase config here; while it's `null` the app runs in demo mode (this phone only)
- `firestore.rules` database rules to paste into Firebase
- `courses/` course library (one JSON file per club, plus hole pictures) and `library.json` listing them
- `assets/` tour badge and sketch

## Trips
The default trip is `touquet-2026`. Add `?trip=some-name` to the link to start a separate trip.
The setup PIN starts as **2026** (change it under More → Trip settings).

## Adding a course
Add the club's JSON file under `courses/<club>/` and list it in `courses/library.json`.
