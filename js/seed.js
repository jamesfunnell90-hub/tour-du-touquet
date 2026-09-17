// Starting data for the Tour du Touquet 2026. Only used when the trip does not exist yet.
export function seedTrip() {
  return {
    name: "Tour du Touquet",
    subtitle: "Comité du Tour · MMXXVI",
    pin: "2026",
    unit: "m",
    skinsMode: "net",
    fillPar: true,
    currentRound: "r1",
    teams: {
      ab: { name: "Anywhere But", colour: "blue", order: 1 },
      bb: { name: "Bushy Boys", colour: "claret", order: 2 },
    },
    players: {
      james: { name: "James", hcp: null, team: "ab" },
      luke: { name: "Luke", hcp: null, team: "ab" },
      will: { name: "Will", hcp: null, team: "ab" },
      alex: { name: "Alex", hcp: null, team: "bb" },
      chris: { name: "Chris", hcp: null, team: "bb" },
      ronak: { name: "Ronak", hcp: null, team: "bb" },
    },
    rounds: {
      // Saturday: "Team 6-6-6" - three hole-by-hole mini matches, 1 point each.
      r1: {
        id: "r1", label: "Saturday - Belle Dune", date: "2026-09-19", order: 1,
        clubId: "belle-dune", courseId: "belle-dune-18", teeId: "jaune",
        handicaps: true, useAltPar: false,
        groups: [
          { id: "g1", time: "09:50", playerIds: ["james", "luke", "will"] },
          { id: "g2", time: "09:40", playerIds: ["alex", "chris", "ronak"] },
        ],
        segments: [
          { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1, matches: [] },
          { id: "s2", from: 7, to: 12, format: "teambestn", count: 2, basis: "stableford", points: 1, matches: [] },
          { id: "s3", from: 13, to: 18, format: "teambestn", count: 3, basis: "stableford", points: 1, matches: [] },
        ],
      },
      // Sunday: singles match play over 18 holes, three matches, 1 point each. Groups and
      // pairings are confirmed after Saturday - "Pair by handicap" in setup handles the matches.
      r2: {
        id: "r2", label: "Sunday - Saint-Omer", date: "2026-09-20", order: 2,
        clubId: "aa-saint-omer", courseId: "le-val", teeId: "jaune",
        handicaps: true, useAltPar: false,
        groups: [
          { id: "g1", time: "12:00", playerIds: [] },
          { id: "g2", time: "12:10", playerIds: [] },
        ],
        segments: [
          { id: "s1", from: 1, to: 18, format: "singles", basis: "stableford", points: 1, allowance: "100", matches: [{ a: "", b: "" }, { a: "", b: "" }, { a: "", b: "" }] },
        ],
      },
    },
    bets: [],
    createdAt: Date.now(),
  };
}
