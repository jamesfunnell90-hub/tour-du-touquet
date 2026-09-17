// Tour du Touquet scoring engine. Pure functions, no DOM or database.

export const FORMATS = {
  tbc:        { label: "Format to be confirmed", short: "TBC", team: false, perPlayer: true },
  stableford: { label: "Team Stableford (best totals)", short: "Stableford", team: true, perPlayer: true },
  betterball: { label: "Better ball Stableford (best per hole)", short: "Better ball", team: true, perPlayer: true },
  scramble:   { label: "Texas scramble (net strokes)", short: "Scramble", team: true, perPlayer: false },
  singles:    { label: "Singles match play", short: "Singles", team: true, perPlayer: true },
  teambestn:  { label: "Team best-N (hole by hole match play)", short: "Team best-N", team: true, perPlayer: true },
};

export const SCRAMBLE_DEFAULTS = { 1: [100], 2: [35, 15], 3: [20, 15, 10], 4: [25, 20, 15, 10] };

// ---------- course helpers ----------
export function hole(course, n) { return course.holes.find(h => h.number === n); }
export function parOf(course, round, n) {
  const h = hole(course, n);
  if (round && round.useAltPar && h.parAlt) return h.parAlt;
  return h.par;
}
export function holeLength(course, teeId, n, unit) {
  const tee = course.tees.find(t => t.id === teeId);
  if (!tee || !tee.lengths) return null;
  const u = tee.lengths[unit] || tee.lengths.m;
  return u && u.holes ? u.holes[n - 1] : null;
}

// A segment is { id, from, to, format, basis, points, bestN, count, allowance, matches }.
// from/to is any contiguous 1-based hole range within the course.
export function segmentHoles(course, seg) {
  const from = Math.max(1, Math.min(seg.from || 1, course.holesCount));
  const to = Math.max(from, Math.min(seg.to || course.holesCount, course.holesCount));
  const out = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}
export function segLabel(seg) {
  if (seg.from === 1 && seg.to === 9) return "Front 9";
  if (seg.from === 10 && seg.to === 18) return "Back 9";
  return `Holes ${seg.from}–${seg.to}`;
}
// Sorted, de-duplicated union of every hole any segment of the round covers.
export function playedHoles(round, course) {
  const set = new Set();
  for (const seg of round.segments || []) for (const n of segmentHoles(course, seg)) set.add(n);
  return [...set].sort((a, b) => a - b);
}
// If a trip still has old-style front/back `nines`, turn them into segments (1–9, 10–18),
// carrying over each nine's other fields. Run this when a trip loads; save the result back.
export function migrateRound(round, course) {
  if (round.segments || !round.nines) return round;
  const segs = [];
  for (const n of round.nines) {
    if (course && course.holesCount === 9 && n.id !== "front") continue;
    const from = n.id === "back" ? 10 : 1;
    const to = n.id === "back" ? 18 : 9;
    const seg = { id: "s_" + n.id, from, to, format: n.format || "tbc", points: n.points ?? 1, basis: "stableford" };
    if (n.bestN !== undefined) seg.bestN = n.bestN;
    if (n.allowance !== undefined) seg.allowance = n.allowance;
    if (n.matches !== undefined) seg.matches = n.matches;
    segs.push(seg);
  }
  const { nines, ...rest } = round;
  return { ...rest, segments: segs };
}

// ---------- handicap ----------
// Shots received on a hole with stroke index `si` for handicap `h`, spread over `scale` holes.
export function shotsOn(h, si, scale = 18) {
  h = Math.round(h || 0);
  if (!si) return 0;
  if (h >= 0) return Math.floor(h / scale) + (si <= h % scale ? 1 : 0);
  const g = -h;
  return -(Math.floor(g / scale) + (si > scale - (g % scale) ? 1 : 0));
}
// A player's handicap is a Handicap Index. Converts it to a Course Handicap for a specific
// tee using that tee's slope and rating (standard formula: index * slope/113 + (rating - par)).
// Falls back to the raw index (rounded) if the tee has no rating data, or no tee is given.
export function courseHandicap(index, course, teeId) {
  const idx = index || 0;
  const tee = teeId && course.tees?.find(t => t.id === teeId);
  const r = tee?.ratings?.men || tee?.ratings?.women;
  if (!r || !r.slope) return Math.round(idx);
  const rating = r.courseRating ?? r.sss;
  const par = r.par ?? course.par;
  return Math.round(idx * (r.slope / 113) + (rating - par));
}
// Shots for a player on hole n of a course, using the full-course allocation.
export function shotsFor(hcp, course, n, round) {
  if (round && round.handicaps === false) return 0;
  const h = hole(course, n);
  const ch = round?.teeId ? courseHandicap(hcp, course, round.teeId) : Math.round(hcp || 0);
  if (course.holesCount === 9) return shotsOn(Math.round(ch / 2), h.strokeIndex, 9);
  return shotsOn(ch, h.strokeIndex, 18);
}

// ---------- scores ----------
// value: number (gross), "P" (picked up) or undefined
export const val = (scores, id, n) => (scores && scores[id] ? scores[id]["h" + n] : undefined);
export const has = v => v !== undefined && v !== null && v !== "";

export function stablefordPts(gross, par, shots) {
  if (!has(gross)) return null;
  if (gross === "P") return 0;
  return Math.max(0, par + shots - gross + 2);
}
export function netOf(gross, shots) { return gross === "P" || !has(gross) ? null : gross - shots; }

// A player's value on one hole under a scoring basis. Returns null if not scored yet,
// else { p: true } for a pick-up (net/gross only; Stableford folds a pick-up into v=0),
// or { p: false, v } where v is points (Stableford, higher better) or a stroke count (net/gross, lower better).
export function basisValue(basis, gross, par, shots) {
  if (!has(gross)) return null;
  if (basis === "stableford") return { p: false, v: stablefordPts(gross, par, shots) };
  if (gross === "P") return { p: true, v: null };
  return { p: false, v: basis === "gross" ? gross : gross - shots };
}
// Picks which `count` of a team's players count on a hole, and the resulting aggregate.
// `entries`: [{ id, value }] where value is a basisValue() result (or null if not scored).
// Stableford: plain total (a pick-up is already worth 0, so no special case is needed).
// Net/gross: a pick-up ranks worse than any number, so it's only used to fill a slot when
// there aren't enough real scores; the result carries how many pick-ups were needed (pCount)
// plus the sum of the real scores used, so two teams can be compared fairly (see compareAgg).
export function pickCounters(basis, entries, count) {
  const scored = entries.filter(e => e.value);
  let chosen;
  if (basis === "stableford") {
    chosen = [...scored].sort((a, b) => b.value.v - a.value.v).slice(0, count);
    return { basis, ids: new Set(chosen.map(e => e.id)), total: chosen.reduce((a, e) => a + e.value.v, 0) };
  }
  const real = scored.filter(e => !e.value.p).sort((a, b) => a.value.v - b.value.v);
  const picks = scored.filter(e => e.value.p);
  chosen = [...real, ...picks].slice(0, count);
  const pCount = chosen.filter(e => e.value.p).length;
  const sum = chosen.filter(e => !e.value.p).reduce((a, e) => a + e.value.v, 0);
  return { basis, ids: new Set(chosen.map(e => e.id)), pCount, sum };
}
// Compares two pickCounters() aggregates. Returns 1 if a wins, -1 if b wins, 0 if the hole halves.
export function compareAgg(a, b) {
  if (a.basis === "stableford") return a.total === b.total ? 0 : a.total > b.total ? 1 : -1;
  if (a.pCount !== b.pCount) return a.pCount < b.pCount ? 1 : -1;
  if (a.sum !== b.sum) return a.sum < b.sum ? 1 : -1;
  return 0;
}

// Number of holes completed in order from the start of the segment.
export function thruOf(scores, id, holes) {
  let t = 0;
  for (const n of holes) { if (has(val(scores, id, n))) t++; else break; }
  return t;
}

export function playerSegment(ctx, pid, seg) {
  const { course, round, scores, players } = ctx;
  const holes = segmentHoles(course, seg);
  const p = players[pid];
  let pts = 0, gross = 0, anyP = false;
  const rows = holes.map(n => {
    const g = val(scores, pid, n);
    const par = parOf(course, round, n);
    const sh = shotsFor(p?.hcp, course, n, round);
    const s = stablefordPts(g, par, sh);
    if (s != null) pts += s;
    if (typeof g === "number") gross += g; else if (g === "P") anyP = true;
    return { n, g, par, sh, pts: s };
  });
  return { pid, holes: rows, pts, gross, anyP, thru: thruOf(scores, pid, holes) };
}

// ---------- round membership ----------
export function roundPlayers(round) {
  return (round.groups || []).flatMap(g => g.playerIds || []);
}
export function teamMembersInRound(trip, round, teamId) {
  const inRound = new Set(roundPlayers(round));
  return Object.entries(trip.players || {})
    .filter(([id, p]) => p.team === teamId && inRound.has(id))
    .map(([id]) => id);
}
export const teamKey = teamId => "T_" + teamId;

export function scrambleHcp(trip, ids, pctString) {
  const hs = ids.map(id => Math.round(trip.players[id]?.hcp || 0)).sort((a, b) => a - b);
  let pcts = (pctString || "").split(/[,/ ]+/).map(Number).filter(x => !isNaN(x) && x > 0);
  if (pcts.length < hs.length) pcts = SCRAMBLE_DEFAULTS[hs.length] || SCRAMBLE_DEFAULTS[4];
  return Math.round(hs.reduce((a, h, i) => a + h * (pcts[i] || 0) / 100, 0));
}

// ---------- segment results ----------
function splitPoints(teamIds, scoreOf, better, total) {
  // scoreOf: teamId -> number; better(a,b) true if a beats b. Returns points per team.
  const out = Object.fromEntries(teamIds.map(t => [t, 0]));
  if (!teamIds.length) return out;
  let best = [teamIds[0]];
  for (const t of teamIds.slice(1)) {
    if (better(scoreOf[t], scoreOf[best[0]])) best = [t];
    else if (!better(scoreOf[best[0]], scoreOf[t])) best.push(t);
  }
  best.forEach(t => (out[t] = total / best.length));
  return out;
}

export function segmentResult(ctx, seg) {
  const { trip, course, round, scores } = ctx;
  const holes = segmentHoles(course, seg);
  const teamIds = Object.keys(trip.teams || {});
  const fmt = seg.format || "tbc";
  const res = { seg, fmt, holes, teams: {}, points: null, status: "notstarted", thru: 0, matches: [] };
  const everyone = roundPlayers(round);
  if (!everyone.length) return res;

  if (fmt === "teambestn") return teambestnResult(ctx, seg, holes, res);

  if (fmt === "singles") {
    let total = Object.fromEntries(teamIds.map(t => [t, 0]));
    let anyStarted = false, allDone = (seg.matches || []).length > 0;
    for (const m of seg.matches || []) {
      const r = matchResult(ctx, m, holes, seg);
      res.matches.push(r);
      if (r.thru > 0) anyStarted = true;
      if (!r.final) allDone = false;
      const ta = trip.players[m.a]?.team, tb = trip.players[m.b]?.team;
      const pts = Number(m.points ?? seg.points ?? 1);
      if (r.final || r.thru > 0) {
        if (r.leader === "a") total[ta] += pts; else if (r.leader === "b") total[tb] += pts;
        else { total[ta] += pts / 2; total[tb] += pts / 2; }
      }
    }
    res.projected = total;
    res.points = allDone ? total : null;
    res.status = allDone ? "final" : anyStarted ? "live" : "notstarted";
    res.thru = res.matches.length ? Math.min(...res.matches.map(m => m.thru)) : 0;
    return res;
  }

  if (fmt === "scramble") {
    const keys = teamIds.filter(t => teamMembersInRound(trip, round, t).length);
    const thru = keys.length ? Math.min(...keys.map(t => thruOf(scores, teamKey(t), holes))) : 0;
    res.thru = isFinite(thru) ? thru : 0;
    for (const t of keys) {
      const ids = teamMembersInRound(trip, round, t);
      const th = round.handicaps === false ? 0 : scrambleHcp(trip, ids, seg.allowance);
      let net = 0, netAll = 0, par = 0, parAll = 0, own = thruOf(scores, teamKey(t), holes);
      holes.forEach((n, i) => {
        const g = val(scores, teamKey(t), n);
        const sh = course.holesCount === 9 ? shotsOn(Math.round(th / 2), hole(course, n).strokeIndex, 9) : shotsOn(th, hole(course, n).strokeIndex, 18);
        const p = parOf(course, round, n);
        const nv = typeof g === "number" ? g - sh : g === "P" ? p + 3 - sh : null;
        if (nv != null && i < own) { netAll += nv; parAll += p; }
        if (nv != null && i < res.thru) { net += nv; par += p; }
      });
      res.teams[t] = { score: net - par, label: toPar(net - par), own: toPar(netAll - parAll), ownThru: own, hcp: th };
    }
    finishTeamResult(res, keys, (a, b) => a < b, seg, holes.length);
    return res;
  }

  // Stableford-based formats (stableford, betterball) and tbc, which shows team totals without points
  const keys = teamIds.filter(t => teamMembersInRound(trip, round, t).length);
  const thru = everyone.length ? Math.min(...everyone.map(id => thruOf(scores, id, holes))) : 0;
  res.thru = isFinite(thru) ? thru : 0;
  const bestN = Number(seg.bestN || 0);
  for (const t of keys) {
    const ids = teamMembersInRound(trip, round, t);
    const per = ids.map(id => playerSegment(ctx, id, seg));
    const score = upTo => {
      if (fmt === "betterball") {
        let s = 0;
        for (let i = 0; i < upTo; i++) {
          const v = per.map(p => p.holes[i].pts).filter(x => x != null).sort((a, b) => b - a);
          s += v.slice(0, bestN || 1).reduce((a, b) => a + b, 0);
        }
        return s;
      }
      const tots = per.map(p => p.holes.slice(0, upTo).reduce((a, h) => a + (h.pts ?? 0), 0)).sort((a, b) => b - a);
      return tots.slice(0, bestN || tots.length).reduce((a, b) => a + b, 0);
    };
    const own = per.length ? Math.min(...per.map(p => p.thru)) : 0;
    res.teams[t] = { score: score(res.thru), label: score(res.thru) + " pts", own: score(own) + " pts", ownThru: own };
  }
  if (fmt === "tbc") { res.status = res.thru > 0 || anyScore(scores, everyone, holes) ? "live" : "notstarted"; if (res.thru === holes.length) res.status = "final"; return res; }
  finishTeamResult(res, keys, (a, b) => a > b, seg, holes.length);
  return res;
}

function anyScore(scores, ids, holes) { return ids.some(id => holes.some(n => has(val(scores, id, n)))); }
export const toPar = v => (v === 0 ? "E" : v > 0 ? "+" + v : String(v));

function finishTeamResult(res, keys, better, seg, totalHoles) {
  const scoreOf = Object.fromEntries(keys.map(t => [t, res.teams[t].score]));
  const total = Number(seg.points ?? 1);
  const pts = splitPoints(keys, scoreOf, better, total);
  const anyOwn = keys.some(t => res.teams[t].ownThru > 0);
  res.projected = res.thru > 0 ? pts : null;
  if (res.thru === totalHoles) { res.status = "final"; res.points = pts; }
  else res.status = anyOwn ? "live" : "notstarted";
  if (keys.length === 2) {
    const [a, b] = keys, d = scoreOf[a] - scoreOf[b];
    res.leader = d === 0 ? null : (better(scoreOf[a], scoreOf[b]) ? a : b);
    res.margin = Math.abs(d);
  }
}

// "Team 6-6-6" and similar: a segment played as a hole-by-hole mini match between two teams.
// On each hole, each team's score is the best `count` of its players' values (see bestOfTeam);
// the higher/better score wins the hole and a halve needs both teams' scores in for that hole
// (the groups can be minutes apart, so a hole only counts once everyone has posted).
export function teambestnResult(ctx, seg, holesArg, resArg) {
  const { trip, course, round, scores } = ctx;
  const holes = holesArg || segmentHoles(course, seg);
  const basis = seg.basis || "stableford";
  const count = Math.max(1, Number(seg.count || 1));
  const teamIds = Object.keys(trip.teams || {}).filter(t => teamMembersInRound(trip, round, t).length);
  const res = resArg || { seg, fmt: "teambestn", holes, teams: {}, points: null, status: "notstarted", thru: 0, matches: [] };
  res.fmt = "teambestn"; res.holes = holes;
  if (teamIds.length !== 2) { res.status = "notstarted"; res.text = "Needs two teams"; return res; }
  const [ta, tb] = teamIds;
  const idsA = teamMembersInRound(trip, round, ta), idsB = teamMembersInRound(trip, round, tb);
  const readyOn = (ids, n) => ids.length > 0 && ids.every(id => has(val(scores, id, n)));
  let up = 0, played = 0, winsA = 0, winsB = 0, halves = 0;
  const holeResults = [];
  for (let i = 0; i < holes.length; i++) {
    const n = holes[i];
    const par = parOf(course, round, n);
    if (!readyOn(idsA, n) || !readyOn(idsB, n)) break;
    const entriesFor = ids => ids.map(id => ({ id, value: basisValue(basis, val(scores, id, n), par, shotsFor(trip.players[id]?.hcp, course, n, round)) }));
    const aggA = pickCounters(basis, entriesFor(idsA), count);
    const aggB = pickCounters(basis, entriesFor(idsB), count);
    const c = compareAgg(aggA, aggB);
    const winner = c > 0 ? "a" : c < 0 ? "b" : null;
    if (winner === "a") { up++; winsA++; } else if (winner === "b") { up--; winsB++; } else halves++;
    played++;
    holeResults.push({ n, winner });
    const leftNow = holes.length - played;
    if (Math.abs(up) > leftNow) break;
  }
  const left = holes.length - played;
  res.thru = played;
  res.holeResults = holeResults;
  res.leader = up > 0 ? "a" : up < 0 ? "b" : null;
  res.leaderTeam = up > 0 ? ta : up < 0 ? tb : null;
  res.margin = Math.abs(up);
  res.winsA = winsA; res.winsB = winsB; res.halves = halves;
  const final = played === holes.length || Math.abs(up) > left;
  res.waiting = false;
  if (!final && played < holes.length) {
    const nextN = holes[played];
    const rA = readyOn(idsA, nextN), rB = readyOn(idsB, nextN);
    res.waiting = (rA || rB) && !(rA && rB);
  }
  const nm = side => trip.teams[side === "a" ? ta : tb]?.name || "?";
  if (played === 0) res.text = "Not started";
  else if (final) res.text = up === 0 ? "Halved" : `${nm(res.leader)} win ${left ? `${Math.abs(up)}&${left}` : `${Math.abs(up)} up`}`;
  else {
    res.text = up === 0 ? `All square thru ${played}` : `${nm(res.leader)} ${Math.abs(up)} up thru ${played}`;
    if (Math.abs(up) === left && left > 0) res.text = `${nm(res.leader)} dormie ${Math.abs(up)}`;
  }
  res.status = final ? "final" : played > 0 ? "live" : "notstarted";
  const pts = Number(seg.points ?? 1);
  const split = up === 0 ? { [ta]: pts / 2, [tb]: pts / 2 } : up > 0 ? { [ta]: pts, [tb]: 0 } : { [ta]: 0, [tb]: pts };
  if (final) res.points = split; else if (played > 0) res.projected = split;
  res.teams[ta] = { holesWon: winsA, ownThru: played };
  res.teams[tb] = { holesWon: winsB, ownThru: played };
  return res;
}

// Singles match play over `holes`. `seg.basis`: "stableford" (default; each player plays their
// own full handicap, more points wins the hole) | "net" (handicap-difference allowance, spread
// by stroke index) | "gross" (raw strokes, no shots at all).
export function matchResult(ctx, m, holes, seg) {
  const { trip, course, round, scores } = ctx;
  const pa = trip.players[m.a], pb = trip.players[m.b];
  const out = { m, thru: 0, up: 0, leader: null, final: false, text: "Not started", holes: [] };
  if (!pa || !pb) { out.text = "Pick two players"; return out; }
  const basis = seg.basis || "stableford";
  const pct = Number(seg.allowance || 100) / 100;
  const cha = round.teeId ? courseHandicap(pa.hcp, course, round.teeId) : Math.round(pa.hcp || 0);
  const chb = round.teeId ? courseHandicap(pb.hcp, course, round.teeId) : Math.round(pb.hcp || 0);
  const ha = Math.round(cha * pct), hb = Math.round(chb * pct);
  const diff = round.handicaps === false ? 0 : Math.abs(ha - hb);
  const receiver = ha > hb ? "a" : hb > ha ? "b" : null;
  let up = 0, played = 0;
  for (let i = 0; i < holes.length; i++) {
    const n = holes[i];
    const ga = val(scores, m.a, n), gb = val(scores, m.b, n);
    if (!has(ga) || !has(gb)) break;
    const par = parOf(course, round, n);
    let w, sh = 0;
    if (basis === "stableford") {
      const sha = shotsFor(pa.hcp, course, n, round), shb = shotsFor(pb.hcp, course, n, round);
      const pta = stablefordPts(ga, par, sha), ptb = stablefordPts(gb, par, shb);
      w = pta > ptb ? "a" : ptb > pta ? "b" : null;
    } else {
      const si = hole(course, n).strokeIndex;
      sh = course.holesCount === 9 ? shotsOn(Math.round(diff / 2), si, 9) : shotsOn(diff, si, 18);
      const useShots = basis === "net";
      const na = ga === "P" ? Infinity : ga - (useShots && receiver === "a" ? sh : 0);
      const nb = gb === "P" ? Infinity : gb - (useShots && receiver === "b" ? sh : 0);
      w = na < nb ? "a" : nb < na ? "b" : null;
    }
    if (w === "a") up++; else if (w === "b") up--;
    played++;
    out.holes.push({ n, w, shots: sh, receiver });
    const left = holes.length - played;
    if (Math.abs(up) > left) { out.final = true; break; }
  }
  out.thru = played; out.up = up;
  out.leader = up > 0 ? "a" : up < 0 ? "b" : null;
  const left = holes.length - played;
  if (played === holes.length) out.final = true;
  const nm = x => (x === "a" ? pa.name : pb.name);
  if (played === 0) out.text = "Not started";
  else if (out.final) {
    if (up === 0) out.text = "Halved";
    else out.text = `${nm(out.leader)} wins ${left ? `${Math.abs(up)}&${left}` : `${Math.abs(up)} up`}`;
  } else {
    out.text = up === 0 ? `All square thru ${played}` : `${nm(out.leader)} ${Math.abs(up)} up thru ${played}`;
    if (Math.abs(up) === left && left > 0) out.text = `${nm(out.leader)} dormie ${Math.abs(up)}`;
  }
  out.shotsText = basis === "stableford" ? "Full handicap, Stableford" : receiver ? `${receiver === "a" ? pa.name : pb.name} gets ${course.holesCount === 9 ? Math.round(diff / 2) : diff} over 18` : "Level";
  return out;
}

// ---------- trip level ----------
export function cupTotals(trip, results) {
  const tot = Object.fromEntries(Object.keys(trip.teams || {}).map(t => [t, 0]));
  let played = 0, inPlay = 0;
  for (const r of results) {
    const fmt = r.seg.format || "tbc";
    const pts = fmt === "singles" ? (r.seg.matches || []).reduce((a, m) => a + Number(m.points ?? r.seg.points ?? 1), 0) : fmt === "tbc" ? 0 : Number(r.seg.points ?? 1);
    if (r.points) { for (const t in r.points) tot[t] = (tot[t] || 0) + r.points[t]; played += pts; }
    else inPlay += pts;
  }
  return { tot, played, available: played + inPlay };
}

export function individualBoard(trip, rounds) {
  // rounds: [{round, course, scores}]
  const rows = {};
  for (const [id, p] of Object.entries(trip.players || {})) rows[id] = { id, name: p.name, team: p.team, total: 0, cols: {} };
  for (const { round, course, scores } of rounds) {
    if (!course) continue;
    const ctx = { trip, course, round, scores, players: trip.players };
    for (const seg of round.segments || []) {
      if (seg.format === "scramble") continue;
      for (const id of roundPlayers(round)) {
        if (!rows[id]) continue;
        const r = playerSegment(ctx, id, seg);
        if (r.thru === 0 && !r.holes.some(h => has(h.g))) continue;
        rows[id].cols[round.id + ":" + seg.id] = { pts: r.pts, thru: r.thru };
        rows[id].total += r.pts;
      }
    }
  }
  return Object.values(rows).sort((a, b) => b.total - a.total);
}

export function skins(ctx, mode = "net") {
  const { course, round, scores, trip } = ctx;
  const ids = roundPlayers(round);
  const res = { holes: [], won: {}, carry: 0 };
  let carry = 0;
  const all = playedHoles(round, course);
  for (const n of all) {
    const vals = ids.map(id => {
      const g = val(scores, id, n);
      if (!has(g)) return null;
      if (g === "P") return { id, v: Infinity };
      return { id, v: mode === "gross" ? g : g - shotsFor(trip.players[id]?.hcp, course, n, round) };
    });
    if (!ids.length || vals.some(v => v == null)) break;
    const min = Math.min(...vals.map(v => v.v));
    const winners = vals.filter(v => v.v === min);
    carry++;
    if (winners.length === 1 && isFinite(min)) {
      res.holes.push({ n, winner: winners[0].id, value: carry });
      res.won[winners[0].id] = (res.won[winners[0].id] || 0) + carry;
      carry = 0;
    } else res.holes.push({ n, winner: null, value: 0 });
  }
  res.carry = carry;
  return res;
}

export function twos(ctx) {
  const { course, round, scores } = ctx;
  const out = [];
  for (const id of roundPlayers(round))
    for (const h of course.holes) if (val(scores, id, h.number) === 2) out.push({ id, n: h.number });
  return out;
}

export function tripStats(trip, rounds) {
  const st = {};
  for (const [id, p] of Object.entries(trip.players || {})) st[id] = { id, name: p.name, birdies: 0, eagles: 0, pars: 0, pickups: 0, bestNine: null };
  for (const { round, course, scores } of rounds) {
    if (!course) continue;
    for (const id of roundPlayers(round)) {
      if (!st[id]) continue;
      for (const h of course.holes) {
        const g = val(scores, id, h.number); const par = parOf(course, round, h.number);
        if (g === "P") st[id].pickups++;
        else if (typeof g === "number") { if (g <= par - 2) st[id].eagles++; else if (g === par - 1) st[id].birdies++; else if (g === par) st[id].pars++; }
      }
      for (const seg of round.segments || []) {
        if (seg.format === "scramble") continue;
        const r = playerSegment({ trip, course, round, scores, players: trip.players }, id, seg);
        if (r.thru === r.holes.length && (!st[id].bestNine || r.pts > st[id].bestNine.pts)) st[id].bestNine = { pts: r.pts, label: `${round.label || ""} ${segLabel(seg)}` };
      }
    }
  }
  return Object.values(st);
}
