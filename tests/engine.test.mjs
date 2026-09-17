import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as E from "../js/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const belleDuneClub = JSON.parse(readFileSync(path.join(__dirname, "../courses/belle-dune/belle-dune.json"), "utf8"));
const belleDune = belleDuneClub.courses.find(c => c.id === "belle-dune-18");

// ---------- fixtures ----------
function makeTrip() {
  return {
    teams: {
      ab: { name: "Anywhere But", colour: "blue", order: 1 },
      bb: { name: "Bushy Boys", colour: "claret", order: 2 },
    },
    players: {
      james: { name: "James", hcp: 14, team: "ab" },
      luke: { name: "Luke", hcp: 9, team: "ab" },
      will: { name: "Will", hcp: 22, team: "ab" },
      alex: { name: "Alex", hcp: 18, team: "bb" },
      chris: { name: "Chris", hcp: 6, team: "bb" },
      ronak: { name: "Ronak", hcp: 11, team: "bb" },
    },
  };
}
function makeRound(segments) {
  return {
    id: "r1", label: "Round 1", handicaps: true, useAltPar: false,
    groups: [
      { id: "g1", time: "09:40", playerIds: ["james", "luke", "will"] },
      { id: "g2", time: "09:50", playerIds: ["alex", "chris", "ronak"] },
    ],
    segments,
  };
}
function ctxFor(trip, round, scores) {
  return { trip, course: belleDune, round, scores, players: trip.players };
}

// ---------- 1. shots ----------
test("shotsOn: handicap 12 on the Belle Dune front 9", () => {
  const front9 = belleDune.holes.filter(h => h.number <= 9);
  const withShot = front9.filter(h => E.shotsOn(12, h.strokeIndex, 18) === 1).map(h => h.number);
  assert.deepEqual(withShot, [1, 2, 5, 7, 8, 9]);
  assert.equal(withShot.length, 6);
});
test("shotsOn edge cases", () => {
  assert.equal(E.shotsOn(20, 1), 2);
  assert.equal(E.shotsOn(20, 3), 1);
  assert.equal(E.shotsOn(-2, 17), -1);
  assert.ok(E.shotsOn(-2, 16) === 0); // may be -0, which is mathematically 0 but fails Object.is-based assert.equal
});

// ---------- course handicap (slope-adjusted) ----------
test("courseHandicap: Belle Dune Jaune (SSS 71.6, slope 125, par 72)", () => {
  // 19 * 125/113 + (71.6 - 72) = 20.6177 -> 21
  assert.equal(E.courseHandicap(19, belleDune, "jaune"), 21);
  assert.ok(E.courseHandicap(0, belleDune, "jaune") === 0); // may be -0 (mathematically 0)
});
test("courseHandicap falls back to the raw index without rating data or a tee", () => {
  assert.equal(E.courseHandicap(19, belleDune, "no-such-tee"), 19);
  assert.equal(E.courseHandicap(19, belleDune, null), 19);
});
test("shotsFor applies the course handicap for the round's tee", () => {
  const trip = makeTrip();
  const round = { ...makeRound([]), teeId: "jaune" };
  // James's index 19 -> course handicap 21 on Jaune. Hole 1 SI 12: shotsOn(21,12,18) = 1 + (12<=3?0) = 1... check below.
  const ch = E.courseHandicap(19, belleDune, "jaune");
  assert.equal(ch, 21);
  assert.equal(E.shotsFor(19, belleDune, 1, round), E.shotsOn(ch, 12, 18));
});

// ---------- 2 & 3. teambestn single-hole worked examples ----------
test("hole 1 (par 4, SI 12), best 1 of 3, Stableford: Bushy Boys win", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 5 }, luke: { h1: 4 }, will: { h1: 6 },
    alex: { h1: 4 }, chris: { h1: 5 }, ronak: { h1: 4 },
  };
  const r = E.teambestnResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.thru, 1);
  assert.equal(r.winsA, 0);
  assert.equal(r.winsB, 1);
  assert.equal(r.leaderTeam, "bb");
});
test("hole 7 (par 4, SI 5), best 2 of 3, Stableford: halved", () => {
  const trip = makeTrip();
  const seg = { id: "s2", from: 7, to: 12, format: "teambestn", count: 2, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h7: 5 }, luke: { h7: 4 }, will: { h7: 7 },
    alex: { h7: 5 }, chris: { h7: 4 }, ronak: { h7: "P" },
  };
  const r = E.teambestnResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.thru, 1);
  assert.equal(r.halves, 1);
  assert.equal(r.leader, null);
});

// ---------- 4. pick-ups ----------
test("teambestn pick-ups: all pick up both sides halves; one side's best beats an all pick-up side", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const allPickedUp = E.teambestnResult(ctxFor(trip, round, {
    james: { h1: "P" }, luke: { h1: "P" }, will: { h1: "P" },
    alex: { h1: "P" }, chris: { h1: "P" }, ronak: { h1: "P" },
  }), seg);
  assert.equal(allPickedUp.halves, 1);
  assert.equal(allPickedUp.leader, null);

  const oneSideScores = E.teambestnResult(ctxFor(trip, round, {
    james: { h1: "P" }, luke: { h1: "P" }, will: { h1: "P" },
    alex: { h1: 6 }, chris: { h1: "P" }, ronak: { h1: "P" }, // Alex 6 gross, 1 shot on SI12 -> 1 pt
  }), seg);
  assert.equal(oneSideScores.winsB, 1);
  assert.equal(oneSideScores.leaderTeam, "bb");
});

// ---------- 5. segment status after 4 of 6 holes ----------
test("teambestn segment: Anywhere But win 3&2 after 4 of 6 holes (1 halved)", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 4, h2: 8, h3: 1, h4: 7 },
    luke:  { h1: 2, h2: 8, h3: 5, h4: 3 },
    will:  { h1: 6, h2: 5, h3: 5, h4: 8 },
    alex:  { h1: 5, h2: 8, h3: 5, h4: 8 },
    chris: { h1: 4, h2: 8, h3: 3, h4: 8 },
    ronak: { h1: 6, h2: 5, h3: 5, h4: 6 },
  };
  const r = E.teambestnResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.thru, 4);
  assert.equal(r.winsA, 3);
  assert.equal(r.winsB, 0);
  assert.equal(r.halves, 1);
  assert.equal(r.status, "final");
  assert.equal(r.text, "Anywhere But win 3&2");
  assert.deepEqual(r.points, { ab: 1, bb: 0 });
});

// ---------- 6. waiting ----------
test("teambestn: a hole with only one group scored doesn't count and thru stays put", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 6, format: "teambestn", count: 1, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 4 }, luke: { h1: 4 }, will: { h1: 4 },
    alex: { h1: 4 }, chris: { h1: 4 }, // ronak hasn't scored yet
  };
  const r = E.teambestnResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.thru, 0);
  assert.equal(r.status, "notstarted");
  assert.equal(r.waiting, true); // one group is in on hole 1, the other isn't
});
test("teambestn: exposes a per-hole winner list for the Live squares", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 2, format: "teambestn", count: 1, basis: "stableford", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 4, h2: 4 }, luke: { h1: 4, h2: 4 }, will: { h1: 4, h2: 4 },
    alex: { h1: 5, h2: 5 }, chris: { h1: 5, h2: 5 }, ronak: { h1: 5, h2: 5 },
  };
  const r = E.teambestnResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.holeResults.length, 2);
  assert.equal(r.holeResults[0].winner, "a");
  assert.equal(r.waiting, false);
});

// ---------- 7. singles ----------
test("singles Stableford: Luke v Chris hole 7, both score 5, halved (both get a shot)", () => {
  const trip = makeTrip();
  const seg = { basis: "stableford", points: 1 };
  const round = makeRound([]);
  const scores = { luke: { h7: 5 }, chris: { h7: 5 } };
  const r = E.matchResult(ctxFor(trip, round, scores), { a: "luke", b: "chris" }, [7], seg);
  assert.equal(r.thru, 1);
  assert.equal(r.final, true);
  assert.equal(r.up, 0);
  assert.equal(r.text, "Halved");
});
test("singles: 3 up with 2 to play is final, 3&2", () => {
  const trip = makeTrip();
  const seg = { basis: "gross", points: 1 };
  const round = makeRound([]);
  const scores = { luke: { h1: 1, h2: 1, h3: 1 }, chris: { h1: 10, h2: 10, h3: 10 } };
  const r = E.matchResult(ctxFor(trip, round, scores), { a: "luke", b: "chris" }, [1, 2, 3, 4, 5], seg);
  assert.equal(r.final, true);
  assert.equal(r.thru, 3);
  assert.equal(r.up, 3);
  assert.equal(r.text, "Luke wins 3&2");
});

// ---------- 8. cup ----------
test("cup: 3 segments + 3 matches = 6 points available; halves give half", () => {
  const trip = makeTrip();
  const results = [
    { seg: { format: "teambestn", points: 1 }, points: { ab: 1, bb: 0 } },
    { seg: { format: "teambestn", points: 1 }, points: { ab: 0.5, bb: 0.5 } },
    { seg: { format: "teambestn", points: 1 }, points: null },
    { seg: { format: "singles", points: 1, matches: [{ points: 1 }, { points: 1 }, { points: 1 }] }, points: { ab: 2, bb: 1 } },
  ];
  const cup = E.cupTotals(trip, results);
  assert.equal(cup.available, 6);
  assert.equal(cup.played, 5);
  assert.equal(cup.tot.ab, 3.5);
  assert.equal(cup.tot.bb, 1.5);
});

// ---------- 9. migration ----------
test("migration: nines front/back become segments 1-9 and 10-18 with the same settings", () => {
  const round = {
    id: "r1",
    nines: [
      { id: "front", format: "stableford", points: 1, bestN: 2, allowance: "", matches: [] },
      { id: "back", format: "singles", points: 1, allowance: "100", matches: [{ a: "x", b: "y" }] },
    ],
  };
  const migrated = E.migrateRound(round, belleDune);
  assert.equal(migrated.nines, undefined);
  assert.equal(migrated.segments.length, 2);
  assert.deepEqual(
    [migrated.segments[0].from, migrated.segments[0].to, migrated.segments[0].format, migrated.segments[0].bestN],
    [1, 9, "stableford", 2]
  );
  assert.deepEqual(
    [migrated.segments[1].from, migrated.segments[1].to, migrated.segments[1].format, migrated.segments[1].matches],
    [10, 18, "singles", [{ a: "x", b: "y" }]]
  );
  // idempotent: a trip that already has segments is left alone
  assert.equal(E.migrateRound(migrated, belleDune), migrated);
});

// ---------- 10. existing formats still work ----------
test("team Stableford (best totals) over holes 1-2", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 2, format: "stableford", points: 1, bestN: 2 };
  const round = makeRound([seg]);
  // hole1 par4 SI12, hole2 par4 SI7
  const scores = {
    james: { h1: 4, h2: 4 }, luke: { h1: 4, h2: 4 }, will: { h1: 4, h2: 4 },
    alex: { h1: 5, h2: 5 }, chris: { h1: 5, h2: 5 }, ronak: { h1: 5, h2: 5 },
  };
  const r = E.segmentResult(ctxFor(trip, round, scores), seg);
  assert.equal(r.status, "final");
  assert.equal(r.teams.ab.score > r.teams.bb.score, true);
  assert.deepEqual(r.points, { ab: 1, bb: 0 });
});
test("better ball Stableford (best per hole)", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 1, format: "betterball", points: 1, bestN: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 6 }, luke: { h1: 3 }, will: { h1: 6 }, // Luke's the best AB score
    alex: { h1: 4 }, chris: { h1: 5 }, ronak: { h1: 5 },
  };
  const r = E.segmentResult(ctxFor(trip, round, scores), seg);
  // Luke: hcp9 SI12 -> 0 shots, gross3 par4 -> 3pts. Alex: hcp18 SI12 -> 1 shot, gross4 -> 3pts. Halved.
  assert.equal(r.teams.ab.score, 3);
  assert.equal(r.teams.bb.score, 3);
});
test("scramble team handicap from 20/15/10 defaults", () => {
  const trip = makeTrip();
  trip.players.james.hcp = 20; trip.players.luke.hcp = 15; trip.players.will.hcp = 10;
  const hcp = E.scrambleHcp(trip, ["james", "luke", "will"], "");
  // sorted 10,15,20 against defaults [20,15,10]: 10*.2 + 15*.15 + 20*.10 = 6.25 -> 6
  assert.equal(hcp, 6);
});
test("skins: single winner then a carry", () => {
  const trip = makeTrip();
  const seg = { id: "s1", from: 1, to: 2, format: "tbc", points: 1 };
  const round = makeRound([seg]);
  const scores = {
    james: { h1: 3, h2: 4 }, luke: { h1: 5, h2: 4 }, will: { h1: 5, h2: 4 },
    alex: { h1: 5, h2: 4 }, chris: { h1: 5, h2: 4 }, ronak: { h1: 5, h2: 4 },
  };
  round.groups = [
    { id: "g1", time: "09:40", playerIds: ["james", "luke"] },
    { id: "g2", time: "09:50", playerIds: ["alex", "chris"] },
  ];
  const r = E.skins(ctxFor(trip, round, scores), "gross");
  assert.equal(r.holes[0].winner, "james");
  assert.equal(r.holes[1].winner, null); // hole 2 all tie at 4 -> carries
  assert.equal(r.carry, 1);
});
test("individual board excludes scramble segments", () => {
  const trip = makeTrip();
  const segA = { id: "a", from: 1, to: 1, format: "stableford", points: 1 };
  const segB = { id: "b", from: 2, to: 2, format: "scramble", points: 1, allowance: "" };
  const round = makeRound([segA, segB]);
  const scores = {
    james: { h1: 4, h2: 4 }, luke: { h1: 4, h2: 4 }, will: { h1: 4, h2: 4 },
    alex: { h1: 5, h2: 5 }, chris: { h1: 5, h2: 5 }, ronak: { h1: 5, h2: 5 },
    T_ab: { h2: 3 }, T_bb: { h2: 3 },
  };
  const board = E.individualBoard(trip, [{ round, course: belleDune, scores }]);
  const james = board.find(r => r.id === "james");
  assert.equal(Object.keys(james.cols).length, 1);
  assert.ok(Object.keys(james.cols)[0].endsWith(":a"));
});
