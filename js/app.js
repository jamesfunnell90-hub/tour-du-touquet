import * as E from "./engine.js";
import * as S from "./store.js";
import { seedTrip } from "./seed.js";

const TRIP_ID = new URLSearchParams(location.search).get("trip") || "touquet-2026";
const COLOURS = ["blue", "claret", "green", "gold", "orange", "purple", "teal", "black"];
const $ = s => document.querySelector(s);
const view = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtPts = v => (v == null ? "–" : v % 1 ? (Math.floor(v) || "") + "½" : String(v));
const lsGet = (k, d) => { try { const v = localStorage.getItem("tdt:ui:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem("tdt:ui:" + k, JSON.stringify(v)); } catch (e) {} };

let CLUBS = [];
const ui = {
  tab: lsGet("tab", "live"), roundId: null, groupIdx: lsGet("group", 0), segId: null, hole: {},
  mode: "hole", board: "cup", cardsRound: null, more: null, draft: null, dirty: false,
  unit: lsGet("unit", null), scorer: lsGet("scorer", ""), pinOk: lsGet("pin:" + TRIP_ID, false),
};

// ---------- helpers ----------
const trip = () => S.state.trip;
const rounds = () => Object.values(trip()?.rounds || {}).sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.date).localeCompare(b.date));
const club = id => CLUBS.find(c => c.id === id);
const courseOf = r => club(r.clubId)?.courses.find(c => c.id === r.courseId);
const teeOf = r => courseOf(r)?.tees.find(t => t.id === r.teeId);
const teams = t => Object.entries((t || trip()).teams || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
const tcol = id => `var(--c-${trip().teams[id]?.colour || "black"})`;
const tname = id => trip().teams[id]?.name || "?";
const pname = id => trip().players[id]?.name || "?";
const unit = () => ui.unit || trip().unit || "m";
const scoresOf = rid => S.state.scores[rid] || {};
const ctxOf = r => ({ trip: trip(), course: courseOf(r), round: r, scores: scoresOf(r.id), players: trip().players });
const dayLabel = d => { if (!d) return ""; const x = new Date(d + "T12:00:00"); return x.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };
const hcpText = h => (h === null || h === undefined || h === "" ? "hcp not set" : "hcp " + h);
const sw = id => `<span class="sw" style="background:${tcol(id)}"></span>`;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800); }
function currentRound() {
  const rs = rounds(); if (!rs.length) return null;
  return trip().rounds[ui.roundId] || trip().rounds[trip().currentRound] || rs[0];
}
function segmentsOf(r) { return r.segments || []; }
function basisLabel(b) { return b === "net" ? "Net" : b === "gross" ? "Gross" : "Stableford"; }
function fmtLabel(seg) {
  const f = E.FORMATS[seg.format || "tbc"];
  if (seg.format === "teambestn") {
    const c = Number(seg.count || 1);
    const rule = c === 1 ? "Best score counts" : `Best ${c} added`;
    return `Team best-${c} · ${rule} · ${basisLabel(seg.basis)}`;
  }
  let s = f.label;
  if (seg.format === "stableford" && Number(seg.bestN)) s += ` · best ${seg.bestN}`;
  if (seg.format === "betterball") s = `Better ball Stableford · best ${Number(seg.bestN) || 1} per hole`;
  if (seg.format === "singles" && seg.basis && seg.basis !== "stableford") s += ` · ${seg.basis === "net" ? "net allowance" : "gross"}`;
  return s;
}
function worthText(seg) {
  if (!seg.format || seg.format === "tbc") return "points to be set";
  if (seg.format === "singles") { const t = (seg.matches || []).reduce((a, m) => a + Number(m.points ?? seg.points ?? 1), 0); return `${(seg.matches || []).length} matches · ${fmtPts(t)} pts`; }
  return `worth ${fmtPts(Number(seg.points ?? 1))} pt${Number(seg.points) === 1 ? "" : "s"}`;
}

// ---------- render loop ----------
let pendingRender = false;
function render(force) {
  if (!force && view.contains(document.activeElement) && document.activeElement.matches("input,select,textarea")) { pendingRender = true; return; }
  pendingRender = false;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
  const st = S.state;
  const pill = $("#modePill");
  if (st.mode === "demo") { pill.hidden = false; pill.textContent = "Demo · this phone only"; } else pill.hidden = true;
  if (st.error && !st.trip) { view.innerHTML = `<div class="banner">${esc(st.error)}</div>`; return; }
  if (!st.trip || !CLUBS.length) return;
  if (ui.tab === "more" && ui.more && ui.dirty) return; // don't clobber an open form
  if (ui.more && !ui.dirty && !ui.redrawing) ui.draft = structuredClone(st.trip);
  const t = trip();
  $("#brand").innerHTML = `${esc(t.name || "Tour du Touquet")}<small>${esc(t.subtitle || "")}</small>`;
  const r = currentRound();
  $("#ctx").textContent = r ? `${r.label} · ${dayLabel(r.date)} · ${club(r.clubId)?.name || "?"}${courseOf(r) && club(r.clubId).courses.length > 1 ? " · " + courseOf(r).name : ""} · ${teeOf(r)?.name || "?"} tees` : "No rounds yet";
  let html = "";
  if (st.error) html += `<div class="banner">${esc(st.error)}</div>`;
  if (!st.online) html += `<div class="banner">Offline. Scores are saved on this phone and will sync when you have signal.</div>`;
  else if (st.pending) html += `<div class="banner ok">Syncing…</div>`;
  html += ({ live: vLive, score: vScore, board: vBoard, more: vMore })[ui.tab]();
  if (ui.tab !== "live" && !(ui.tab === "more" && ui.more)) html += `<div class="footart" aria-hidden="true">${MOTTO}<div class="art"></div></div>`;
  view.innerHTML = html;
}
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender) render(); }, 0));
const MOTTO = `<div class="motto">LIBERTÉ<i>•</i>ÉGALITÉ<i>•</i>GOLF</div>`;

// ---------- LIVE ----------
function allResults() {
  const out = [];
  for (const r of rounds()) { const c = courseOf(r); if (!c) continue; for (const seg of segmentsOf(r)) out.push({ r, res: E.segmentResult(ctxOf(r), seg) }); }
  return out;
}
function vLive() {
  const t = trip(), res = allResults();
  const cup = E.cupTotals(t, res.map(x => x.res));
  const tm = teams();
  let h = `<section class="panel hero">${MOTTO}<div class="art"></div></section>`;
  if (tm.length === 2) {
    const [[a, A], [b, B]] = tm, sum = cup.tot[a] + cup.tot[b];
    h += `<section class="panel"><div class="cup">
      <div class="team"><span class="tname" style="color:${tcol(a)}">${esc(A.name)}</span><span class="pts num" style="color:${tcol(a)}">${fmtPts(cup.tot[a])}</span></div>
      <div class="mid">${cup.available ? `<b>${fmtPts(cup.played)} of ${fmtPts(cup.available)}</b>points decided` : `<b>Formats</b>to be agreed`}</div>
      <div class="team r"><span class="tname" style="color:${tcol(b)}">${esc(B.name)}</span><span class="pts num" style="color:${tcol(b)}">${fmtPts(cup.tot[b])}</span></div></div>
      <div class="bar" aria-hidden="true"><i style="width:${sum ? (cup.tot[a] / Math.max(cup.available, sum)) * 100 : 0}%;background:${tcol(a)}"></i><i style="flex:1"></i><i style="width:${sum ? (cup.tot[b] / Math.max(cup.available, sum)) * 100 : 0}%;background:${tcol(b)}"></i></div></section>`;
  } else {
    h += `<section class="panel list">${tm.map(([id, T]) => `<div class="item" style="cursor:default"><b>${sw(id)} ${esc(T.name)}</b><span class="tot">${fmtPts(cup.tot[id])}</span></div>`).join("")}</section>`;
  }
  const r = trip().rounds[t.currentRound] || rounds()[0];
  if (r) {
    const c = courseOf(r);
    h += `<h2>${esc(r.label)} · ${dayLabel(r.date)}</h2>`;
    if (!c) h += `<div class="banner">Course not found for this round. Check it under More → Rounds.</div>`;
    else {
      for (const seg of segmentsOf(r)) h += segmentCard(r, seg);
      h += `<section class="panel"><div class="card-head"><div><div class="title">Groups</div><div class="sub">${esc(club(r.clubId).name)} · ${esc(teeOf(r)?.name || "")} tees</div></div></div>
        <div class="groups" style="padding-top:12px">${(r.groups || []).map(g => groupCard(r, g)).join("")}</div></section>`;
      const top = E.individualBoard(t, [{ round: r, course: c, scores: scoresOf(r.id) }]).filter(x => Object.keys(x.cols).length).slice(0, 3);
      if (top.length) h += `<section class="panel"><div class="card-head"><div class="title">Top Stableford today</div></div><div class="body">${top.map((x, i) => `<div class="srow"><span>${i + 1}. ${sw(x.team)} <b>${esc(x.name)}</b></span><span class="num" style="font-size:20px;font-weight:700">${x.total} pts</span></div>`).join("")}</div></section>`;
    }
  }
  h += `<h2>Schedule</h2><section class="panel list">${rounds().map(x => {
    const times = (x.groups || []).map(g => g.time).filter(Boolean);
    const set = (x.groups || []).some(g => (g.playerIds || []).length);
    return `<div class="item" style="cursor:default"><div><div><b>${dayLabel(x.date)} · ${esc(x.label)}</b></div><div class="sub">${esc(club(x.clubId)?.name || "?")}${courseOf(x) && club(x.clubId).courses.length > 1 ? " · " + esc(courseOf(x).name) : ""} · ${set ? "groups set" : "groups to be confirmed"}</div></div><span class="chip ${x.id === t.currentRound ? "live" : ""}">${times[0] || "TBC"}</span></div>`;
  }).join("")}</section>`;
  return h;
}
function statusChip(res) { return res.status === "final" ? `<span class="chip final">Final</span>` : res.status === "live" ? `<span class="chip live">Live</span>` : `<span class="chip">Not started</span>`; }
function segmentCard(r, seg) {
  const res = E.segmentResult(ctxOf(r), seg);
  let body = "";
  const keys = Object.keys(res.teams);
  if (res.fmt === "singles") {
    body = (seg.matches || []).length ? res.matches.map(m => `<div class="srow"><span>${sw(trip().players[m.m.a]?.team)} ${esc(pname(m.m.a))} <span class="muted">v</span> ${sw(trip().players[m.m.b]?.team)} ${esc(pname(m.m.b))}</span><b class="small" style="text-align:right">${esc(m.text)}</b></div>`).join("") : `<p class="note">Add the singles pairings under More → Rounds.</p>`;
    if (res.projected && res.status === "live") body += `<div class="small muted">As it stands: ${teams().map(([id]) => `${esc(tname(id))} ${fmtPts(res.projected[id])}`).join(" · ")}</div>`;
  } else if (res.fmt === "teambestn") {
    if (keys.length === 2 && (res.thru > 0 || res.waiting)) {
      const [ta, tb] = keys;
      const lead = res.leaderTeam ? `<span style="color:${tcol(res.leaderTeam)}">${esc(res.text)}</span>` : `<span>${esc(res.text)}</span>`;
      body += `<div class="srow"><span class="big">${lead}</span></div>`;
      body += `<div class="squares">${res.holes.map((n, i) => {
        const hr = res.holeResults[i];
        if (!hr) return `<span class="hsq" title="Hole ${n}">${n}</span>`;
        if (!hr.winner) return `<span class="hsq half" title="Hole ${n} halved">${n}</span>`;
        return `<span class="hsq" style="background:${tcol(hr.winner === "a" ? ta : tb)};color:var(--fairway-ink)" title="Hole ${n}">${n}</span>`;
      }).join("")}</div>`;
      if (res.waiting) body += `<p class="note">Waiting for the other group on hole ${res.holes[res.thru]}.</p>`;
    } else if (keys.length !== 2) body += `<p class="note">Team best-N needs exactly two teams.</p>`;
  } else if (keys.length) {
    if (res.fmt !== "tbc" && res.thru > 0) {
      const lead = res.leader ? `<span style="color:${tcol(res.leader)}">${esc(tname(res.leader))} ${res.fmt === "scramble" ? "by " + res.margin : "+" + res.margin}</span>` : "All square";
      body += `<div class="srow"><span class="big">${lead}</span><span class="muted small">${res.status === "final" ? "final" : `on holes ${res.holes[0]}–${res.holes[res.thru - 1]}`}</span></div>`;
    }
    body += keys.map(k => `<div class="srow small"><span>${sw(k)} ${esc(tname(k))}${res.teams[k].hcp != null ? ` <span class="muted">(team hcp ${res.teams[k].hcp})</span>` : ""}</span><span><b class="num" style="font-size:18px">${esc(res.teams[k].own)}</b> <span class="muted">thru ${res.teams[k].ownThru}</span></span></div>`).join("");
    if (res.fmt === "tbc") body += `<p class="note">Format not set yet, so these are Stableford totals for each team.</p>`;
    if (res.points) body += `<div class="small"><b>Points:</b> ${keys.map(k => `${esc(tname(k))} ${fmtPts(res.points[k])}`).join(" · ")}</div>`;
  }
  return `<section class="panel"><div class="card-head"><div><div class="title">${esc(E.segLabel(seg))}</div><div class="sub">${esc(fmtLabel(seg))} · ${esc(worthText(seg))}</div></div>${statusChip(res)}</div><div class="body">${body || '<p class="note">No scores yet.</p>'}</div></section>`;
}
function groupCard(r, g) {
  const c = courseOf(r); const ids = g.playerIds || [];
  const holes = [...new Set(segmentsOf(r).flatMap(seg => E.segmentHoles(c, seg)))].sort((a, b) => a - b);
  const done = ids.length ? Math.min(...ids.map(id => holes.filter(n => E.has(E.val(scoresOf(r.id), id, n))).length)) : 0;
  const scr = segmentsOf(r).some(seg => seg.format === "scramble");
  const tdone = scr ? Math.max(0, ...[...new Set(ids.map(id => trip().players[id]?.team))].map(t => holes.filter(n => E.has(E.val(scoresOf(r.id), E.teamKey(t), n))).length)) : 0;
  return `<div class="gcard"><div><b>${esc(g.time || "TBC")}</b> <span class="muted">· ${Math.max(done, tdone)} holes in</span></div>${ids.length ? ids.map(id => `<div>${sw(trip().players[id]?.team)} ${esc(pname(id))}</div>`).join("") : '<div class="muted">To be confirmed</div>'}</div>`;
}

// ---------- SCORE ----------
function vScore() {
  const rs = rounds(); if (!rs.length) return `<p class="note">No rounds yet. Add one under More → Rounds.</p>`;
  const r = currentRound();
  const c = courseOf(r); if (!c) return `<div class="banner">This round's course is missing. Fix it under More → Rounds.</div>`;
  const groups = r.groups || [];
  if (ui.groupIdx >= groups.length) ui.groupIdx = 0;
  const g = groups[ui.groupIdx];
  const segs = segmentsOf(r);
  if (!ui.segId || !segs.find(s => s.id === ui.segId)) ui.segId = segs[0]?.id;
  const seg = segs.find(s => s.id === ui.segId);
  let h = "";
  if (rs.length > 1) h += `<div class="seg" role="group" aria-label="Round">${rs.map(x => `<button data-act="round" data-id="${x.id}" aria-pressed="${x.id === r.id}">${esc(x.label)}</button>`).join("")}</div>`;
  h += `<div class="seg" role="group" aria-label="Group">${groups.map((x, i) => `<button data-act="group" data-i="${i}" aria-pressed="${i === ui.groupIdx}">${esc(x.time || "Group " + (i + 1))}</button>`).join("")}</div>`;
  if (!g || !(g.playerIds || []).length) return h + `<div class="banner">No players in this group yet. Set the groups under More → Rounds.</div>`;
  if (!seg) return h + `<div class="banner">No segments set for this round.</div>`;
  if (segs.length > 1) h += `<div class="seg" role="group" aria-label="Segment">${segs.map(s => `<button data-act="seg" data-id="${s.id}" aria-pressed="${s.id === seg.id}">${esc(E.segLabel(s))}</button>`).join("")}</div>`;
  h += `<div class="seg" role="group" aria-label="View"><button data-act="mode" data-id="hole" aria-pressed="${ui.mode === "hole"}">Hole by hole</button><button data-act="mode" data-id="grid" aria-pressed="${ui.mode === "grid"}">Scorecard</button></div>`;
  const holes = E.segmentHoles(c, seg);
  const rows = scoreRows(r, g, seg);
  if (ui.mode === "grid") return h + gridView(r, c, seg, holes, rows) + scorerPicker();
  const hk = `${r.id}:${ui.groupIdx}:${seg.id}`;
  if (!ui.hole[hk]) { const first = holes.find(n => rows.some(x => !E.has(E.val(scoresOf(r.id), x.key, n)))); ui.hole[hk] = first || holes[holes.length - 1]; }
  const n = ui.hole[hk], hi = holes.indexOf(n), ho = E.hole(c, n), par = E.parOf(c, r, n);
  const len = E.holeLength(c, r.teeId, n, unit());
  h += `<div class="strip">${holes.map(x => { const done = rows.every(rw => E.has(E.val(scoresOf(r.id), rw.key, x))); return `<button data-act="hole" data-n="${x}" class="${x === n ? "cur" : done ? "done" : ""}" aria-label="Hole ${x}">${x}</button>`; }).join("")}</div>`;
  h += `<section class="panel"><div class="hole">${ho.image ? `<img src="${esc(ho.image)}" alt="Hole ${n} layout">` : `<div class="noimg">No hole picture yet</div>`}
    <div><div class="hno">${n}</div><div class="hname">${esc(ho.name || "")}</div>
    <div class="facts"><div><span>Par</span><b>${par}</b></div><div><span>SI</span><b>${ho.strokeIndex}</b></div><div><span>${esc(teeOf(r)?.name || "")} <button class="unit" data-act="unit">${unit()}</button></span><b>${len ?? "–"}</b></div></div>
    ${ho.parAlt ? `<div class="small muted" style="margin-top:6px">Par ${ho.parAlt} option ${r.useAltPar ? "in use" : "available"}</div>` : ""}</div></div>`;
  const countIdsByTeam = {};
  if (seg.format === "teambestn") {
    for (const tid of new Set(rows.map(rw => rw.teamId))) {
      const ids = E.teamMembersInRound(trip(), r, tid);
      const entries = ids.map(id => ({ id, value: E.basisValue(seg.basis || "stableford", E.val(scoresOf(r.id), id, n), par, E.shotsFor(trip().players[id]?.hcp, c, n, r)) }));
      countIdsByTeam[tid] = E.pickCounters(seg.basis || "stableford", entries, Number(seg.count || 1)).ids;
    }
  }
  for (const rw of rows) {
    const v = E.val(scoresOf(r.id), rw.key, n);
    const sh = rw.shots(n);
    const pts = rw.team ? null : E.stablefordPts(v, par, sh);
    const shown = E.has(v) ? v : par;
    const cls = !E.has(v) ? "ghost" : v !== "P" && v < par ? "u" : "";
    const counters = countIdsByTeam[rw.teamId];
    const counts = counters ? counters.has(rw.key) : true;
    h += `<div class="prow${counters && !counts ? " faded" : ""}"><div><div class="pname">${sw(rw.teamId)} ${esc(rw.name)}${counters ? (counts ? ` <span class="countTag">✓ counts</span>` : "") : ""}</div>
      <div class="pmeta">${esc(rw.meta)} <span class="dots" title="${sh} shot(s)">${sh > 0 ? "●".repeat(sh) : sh < 0 ? "give " + -sh : '<span class="muted">no shot</span>'}</span>${pts != null ? `<span class="ptsTag">${pts} pt${pts === 1 ? "" : "s"}</span>` : ""}</div></div>
      <div class="step"><button data-act="minus" data-k="${esc(rw.key)}" data-n="${n}" aria-label="One fewer for ${esc(rw.name)}">−</button><span class="val ${cls}">${v === "P" ? "P" : shown}</span><button data-act="plus" data-k="${esc(rw.key)}" data-n="${n}" aria-label="One more for ${esc(rw.name)}">+</button><button class="pu" data-act="pu" data-k="${esc(rw.key)}" data-n="${n}" aria-pressed="${v === "P"}" aria-label="Picked up">P</button></div></div>`;
  }
  h += `<div class="matchbar">${segmentSummary(r, seg)}</div></section>`;
  h += `<div class="nav"><button class="btn" data-act="prev" ${hi === 0 ? "disabled" : ""}>‹ Hole ${hi > 0 ? holes[hi - 1] : ""}</button><button class="btn primary" data-act="next">${hi === holes.length - 1 ? (segs[segs.indexOf(seg) + 1] ? "Next segment ›" : "Save round") : `Hole ${holes[hi + 1]} ›`}</button></div>`;
  h += `<p class="note">Tap + or − to set a score. Grey numbers are par and aren't saved until you tap. ${trip().fillPar ? "Moving to the next hole saves par for anyone left untouched." : ""} P = picked up (0 points).</p>`;
  return h + scorerPicker();
}
function scorerPicker() {
  return `<section class="panel form"><div class="field"><label for="scorer">Scoring on this phone</label><select id="scorer" data-act="scorer"><option value="">Choose your name</option>${Object.entries(trip().players).map(([id, p]) => `<option value="${id}" ${ui.scorer === id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></section>`;
}
function scoreRows(r, g, seg) {
  const c = courseOf(r);
  if (seg.format === "scramble") {
    const tids = [...new Set((g.playerIds || []).map(id => trip().players[id]?.team).filter(Boolean))];
    return tids.map(t => {
      const ids = E.teamMembersInRound(trip(), r, t);
      const th = r.handicaps === false ? 0 : E.scrambleHcp(trip(), ids, seg.allowance);
      return { key: E.teamKey(t), team: true, teamId: t, name: tname(t), meta: `Team hcp ${th}`, shots: n => c.holesCount === 9 ? E.shotsOn(Math.round(th / 2), E.hole(c, n).strokeIndex, 9) : E.shotsOn(th, E.hole(c, n).strokeIndex, 18) };
    });
  }
  return (g.playerIds || []).map(id => { const p = trip().players[id] || {}; return { key: id, team: false, teamId: p.team, name: p.name, meta: hcpText(p.hcp), shots: n => E.shotsFor(p.hcp, c, n, r) }; });
}
function segmentSummary(r, seg) {
  const res = E.segmentResult(ctxOf(r), seg);
  if (res.fmt === "singles") return res.matches.length ? res.matches.map(m => `<div class="srow"><span>${esc(pname(m.m.a))} v ${esc(pname(m.m.b))}</span><b>${esc(m.text)}</b></div>`).join("") : "Singles pairings not set yet";
  if (res.fmt === "teambestn") {
    const keys = Object.keys(res.teams);
    if (keys.length !== 2) return "Team best-N needs exactly two teams";
    let s = `<div class="srow"><b>${esc(E.segLabel(seg))} · Team best-N</b><span>${esc(res.text)}</span></div>`;
    if (res.waiting) s += `<div class="small muted">Waiting for the other group on hole ${res.holes[res.thru]}.</div>`;
    return s;
  }
  const keys = Object.keys(res.teams);
  return `<div class="srow"><b>${esc(E.segLabel(seg))} · ${esc(E.FORMATS[res.fmt].short)}</b><span>${keys.map(k => `<span style="color:${tcol(k)}">${esc(tname(k))} ${esc(res.teams[k].own)}</span> <span class="muted">(${res.teams[k].ownThru})</span>`).join(" · ")}</span></div>`;
}
function gridView(r, c, seg, holes, rows) {
  const sc = scoresOf(r.id);
  let h = `<section class="panel tw"><table><tr><th class="l">Hole</th>${holes.map(n => `<th>${n}</th>`).join("")}<th>Tot</th><th>${seg.format === "scramble" ? "Net" : "Pts"}</th></tr>
    <tr class="par"><td class="l">Par · SI</td>${holes.map(n => `<td>${E.parOf(c, r, n)}·${E.hole(c, n).strokeIndex}</td>`).join("")}<td>${holes.reduce((a, n) => a + E.parOf(c, r, n), 0)}</td><td></td></tr>
    <tr class="par"><td class="l">${esc(teeOf(r)?.name || "")} (${unit()})</td>${holes.map(n => `<td>${E.holeLength(c, r.teeId, n, unit()) ?? "–"}</td>`).join("")}<td></td><td></td></tr>`;
  for (const rw of rows) {
    let tot = 0, pts = 0, net = 0;
    const cells = holes.map(n => {
      const v = E.val(sc, rw.key, n), par = E.parOf(c, r, n), sh = rw.shots(n);
      if (typeof v === "number") { tot += v; net += v - sh - par; }
      const p = E.stablefordPts(v, par, sh); if (p != null) pts += p;
      return `<td><input class="cell" inputmode="numeric" aria-label="${esc(rw.name)} hole ${n}" data-act="cell" data-k="${esc(rw.key)}" data-n="${n}" value="${E.has(v) ? v : ""}" style="${typeof v === "number" && v < par ? "color:var(--under);font-weight:700" : ""}"></td>`;
    }).join("");
    h += `<tr><td class="l">${sw(rw.teamId)} <b>${esc(rw.name)}</b><div class="small muted">${esc(rw.meta)}</div></td>${cells}<td><b>${tot || "–"}</b></td><td class="tot">${seg.format === "scramble" ? E.toPar(net) : pts}</td></tr>`;
  }
  return h + `</table></section><p class="note">Type a number, or P for picked up. Clear a box to remove a score.</p>`;
}

// score writes + debounced change log
const logTimers = {};
async function writeScore(rid, key, n, value) {
  const before = E.val(scoresOf(rid), key, n);
  if (before === value) return;
  await S.setScore(rid, key, n, value);
  const lk = `${rid}|${key}|${n}`;
  if (!logTimers[lk]) logTimers[lk] = { from: before };
  clearTimeout(logTimers[lk].t);
  logTimers[lk].t = setTimeout(() => {
    const from = logTimers[lk].from; delete logTimers[lk];
    const to = E.val(scoresOf(rid), key, n);
    if (from === to) return;
    const who = key.startsWith("T_") ? tname(key.slice(2)) : pname(key);
    S.addLog({ text: `${trip().rounds[rid]?.label || ""} hole ${n}: ${who} ${E.has(from) ? from : "–"} → ${E.has(to) ? to : "cleared"}`, by: ui.scorer ? pname(ui.scorer) : "Unknown phone" });
  }, 4000);
}

// ---------- LEADERBOARD ----------
function vBoard() {
  const segs = [["cup", "Team cup"], ["ind", "Players"], ["cards", "Cards"], ["bets", "Side bets"]];
  let h = `<div class="seg" role="group" aria-label="Leaderboard">${segs.map(([k, l]) => `<button data-act="board" data-id="${k}" aria-pressed="${ui.board === k}">${l}</button>`).join("")}</div>`;
  const tm = teams();
  if (ui.board === "cup") {
    const res = allResults(); const cup = E.cupTotals(trip(), res.map(x => x.res));
    h += `<section class="panel tw"><table><tr><th class="l">Segment</th><th>Format</th>${tm.map(([id, T]) => `<th style="color:${tcol(id)}">${esc(T.name)}</th>`).join("")}</tr>
      ${res.map(({ r, res: x }) => `<tr><td class="l"><b>${esc(r.label)} ${esc(E.segLabel(x.seg))}</b><div class="small muted">${esc(courseOf(r)?.name || "")}</div></td><td class="small">${esc(E.FORMATS[x.fmt].short)}${x.status === "live" ? ' <span class="chip live">Live</span>' : ""}</td>
        ${tm.map(([id]) => `<td class="${x.points ? "tot" : "small muted"}" style="${x.points ? `color:${tcol(id)}` : ""}">${x.points ? fmtPts(x.points[id]) : x.projected && x.status === "live" ? "(" + fmtPts(x.projected[id]) + ")" : "–"}</td>`).join("")}</tr>`).join("")}
      <tr><td class="l"><b>Total</b></td><td></td>${tm.map(([id]) => `<td class="tot" style="font-size:30px;color:${tcol(id)}">${fmtPts(cup.tot[id])}</td>`).join("")}</tr></table></section>
      <p class="note">Brackets show how a live segment stands right now. Points count once a segment is finished. A tie splits the points.</p>`;
  } else if (ui.board === "ind") {
    const data = rounds().map(r => ({ round: r, course: courseOf(r), scores: scoresOf(r.id) }));
    const cols = data.flatMap(d => d.course ? segmentsOf(d.round).filter(seg => seg.format !== "scramble").map(seg => ({ key: d.round.id + ":" + seg.id, label: `R${d.round.order || ""} ${E.segLabel(seg)}` })) : []);
    const rows = E.individualBoard(trip(), data);
    h += `<section class="panel tw"><table><tr><th></th><th class="l">Player</th>${cols.map(c => `<th>${c.label}</th>`).join("")}<th>Total</th></tr>
      ${rows.map((x, i) => `<tr><td class="rank">${i + 1}</td><td class="l">${sw(x.team)} <b>${esc(x.name)}</b> <span class="small muted">${esc(hcpText(trip().players[x.id]?.hcp))}</span></td>${cols.map(c => { const v = x.cols[c.key]; return `<td>${v ? v.pts + (v.thru < 9 ? ` <span class="small muted">(${v.thru})</span>` : "") : "–"}</td>`; }).join("")}<td class="tot">${x.total}</td></tr>`).join("")}</table></section>
      <p class="note">Individual Stableford order of merit. Scramble segments are left out. Brackets show holes played when a segment isn't finished.</p>`;
  } else if (ui.board === "cards") {
    const rs = rounds(); const r = trip().rounds[ui.cardsRound] || currentRound();
    h += `<div class="seg">${rs.map(x => `<button data-act="cardsRound" data-id="${x.id}" aria-pressed="${x.id === r.id}">${esc(x.label)}</button>`).join("")}</div>`;
    const c = courseOf(r);
    if (c) for (const seg of segmentsOf(r)) {
      const holes = E.segmentHoles(c, seg);
      const g = { playerIds: E.roundPlayers(r) };
      const rws = scoreRows(r, g, seg);
      h += `<h2>${esc(E.segLabel(seg))} · ${esc(E.FORMATS[seg.format || "tbc"].short)}</h2><section class="panel tw"><table><tr><th class="l">Hole</th>${holes.map(x => `<th>${x}</th>`).join("")}<th>Tot</th><th>${seg.format === "scramble" ? "Net" : "Pts"}</th></tr>
        <tr class="par"><td class="l">Par</td>${holes.map(x => `<td>${E.parOf(c, r, x)}</td>`).join("")}<td>${holes.reduce((a, x) => a + E.parOf(c, r, x), 0)}</td><td></td></tr>
        ${rws.map(rw => { let tot = 0, pts = 0, net = 0; const cells = holes.map(x => { const v = E.val(scoresOf(r.id), rw.key, x), par = E.parOf(c, r, x), sh = rw.shots(x); if (typeof v === "number") { tot += v; net += v - sh - par; } const p = E.stablefordPts(v, par, sh); if (p != null) pts += p; return `<td class="${typeof v === "number" && v < par ? "u" : ""}">${E.has(v) ? v : "·"}${sh > 0 ? `<sup class="muted">${"•".repeat(sh)}</sup>` : ""}</td>`; }).join("");
          return `<tr><td class="l">${sw(rw.teamId)} <b>${esc(rw.name)}</b></td>${cells}<td><b>${tot || "–"}</b></td><td class="tot">${seg.format === "scramble" ? E.toPar(net) : pts}</td></tr>`; }).join("")}</table></section>`;
    }
  } else {
    h += betsView();
  }
  return h;
}
function betsView() {
  const t = trip(); let h = "";
  for (const r of rounds()) {
    const c = courseOf(r); if (!c || !E.roundPlayers(r).length) continue;
    const ctx = ctxOf(r);
    const sk = E.skins(ctx, t.skinsMode || "net");
    const tw = E.twos(ctx);
    const won = Object.entries(sk.won).sort((a, b) => b[1] - a[1]);
    const bets = (t.bets || []).filter(b => b.roundId === r.id);
    h += `<h2>${esc(r.label)} · ${esc(club(r.clubId)?.name || "")}</h2><section class="panel list">
      <div class="item" style="cursor:default"><div><b>Skins (${t.skinsMode === "gross" ? "gross" : "net"})</b><div class="sub">${sk.holes.length ? `${sk.holes.length} holes decided${sk.carry ? ` · ${sk.carry} carried` : ""}` : "Waiting for all scores on hole 1"}</div></div><div style="text-align:right">${won.length ? won.map(([id, v]) => `<b>${esc(pname(id))}</b> ${v}`).join(" · ") : '<span class="muted">None yet</span>'}</div></div>
      <div class="item" style="cursor:default"><div><b>2s club</b><div class="sub">Gross two on any hole</div></div><div style="text-align:right">${tw.length ? tw.map(x => `<b>${esc(pname(x.id))}</b> (${x.n})`).join(" · ") : '<span class="muted">None yet</span>'}</div></div>
      ${bets.map(b => `<div class="item" style="cursor:default"><div><b>${esc(b.type)}</b><div class="sub">Hole ${esc(b.hole || "?")}${b.note ? " · " + esc(b.note) : ""}</div></div><div style="display:flex;gap:8px;align-items:center"><b>${b.winner ? esc(pname(b.winner)) : '<span class="muted">Open</span>'}</b><button class="btn sm" data-act="betDel" data-id="${b.id}" aria-label="Remove">✕</button></div></div>`).join("")}
    </section>
    <section class="panel form"><div class="field"><span class="lbl">Add nearest the pin or longest drive</span>
      <div class="row2"><select class="in" id="bt-${r.id}"><option>Nearest the pin</option><option>Longest drive</option><option>Other</option></select><select class="in" id="bh-${r.id}">${c.holes.map(x => `<option value="${x.number}">Hole ${x.number} · par ${x.par}</option>`).join("")}</select></div>
      <div class="row2"><select class="in" id="bw-${r.id}"><option value="">Winner (or leave open)</option>${E.roundPlayers(r).map(id => `<option value="${id}">${esc(pname(id))}</option>`).join("")}</select><input class="in" id="bn-${r.id}" placeholder="Note, e.g. 2.1 m"></div>
      <button class="btn" data-act="betAdd" data-id="${r.id}">Add</button></div></section>`;
  }
  return h || `<p class="note">Side bets appear once a round has players.</p>`;
}

// ---------- MORE / SETUP ----------
function vMore() {
  if (ui.more) return setupView();
  const t = trip();
  const stats = E.tripStats(t, rounds().map(r => ({ round: r, course: courseOf(r), scores: scoresOf(r.id) })));
  let h = `<h2>Setup <span class="small muted" style="text-transform:none;letter-spacing:0">(needs the trip PIN)</span></h2><section class="panel list">
    ${[["trip", "Trip settings", `${t.name} · PIN · skins ${t.skinsMode} · distances ${t.unit}`],
       ["teams", "Teams", teams().map(([id, T]) => `${T.name}: ${Object.values(t.players).filter(p => p.team === id).map(p => p.name).join(", ")}`).join(" · ")],
       ["players", "Players & handicaps", Object.values(t.players).map(p => `${p.name} ${p.hcp ?? "?"}`).join(" · ")],
       ["rounds", "Rounds, groups & formats", rounds().map(r => `${r.label} ${club(r.clubId)?.name || "?"} (${teeOf(r)?.name || "?"})`).join(" · ")]]
      .map(([k, a, b]) => `<button class="item" data-act="open" data-id="${k}"><div><b>${a}</b><div class="sub">${esc(b)}</div></div><span class="go">›</span></button>`).join("")}
  </section>
  <h2>This phone</h2><section class="panel list">
    <button class="item" data-act="unit"><div><b>Distances</b><div class="sub">Showing ${unit() === "m" ? "metres" : "yards"} · tap to switch</div></div><span class="go">›</span></button>
    <div class="item" style="cursor:default"><div><b>Data</b><div class="sub">${S.state.mode === "live" ? "Live: shared with everyone who has the link" : "Demo mode: saved on this phone only. Add the Firebase config to share scores."}</div></div></div>
    ${S.state.mode === "demo" ? `<button class="item" data-act="resetDemo"><div><b>Reset demo data</b><div class="sub">Clears scores and setup on this phone</div></div><span class="go">›</span></button>` : ""}
  </section>
  <h2>Trip summary</h2><section class="panel tw"><table><tr><th class="l">Player</th><th>Eagles</th><th>Birdies</th><th>Pars</th><th>Pick-ups</th><th>Best 9</th></tr>
    ${stats.map(s => `<tr><td class="l">${sw(t.players[s.id]?.team)} <b>${esc(s.name)}</b></td><td>${s.eagles}</td><td>${s.birdies}</td><td>${s.pars}</td><td>${s.pickups}</td><td>${s.bestNine ? s.bestNine.pts : "–"}</td></tr>`).join("")}</table></section>
  <h2>Change log</h2><section class="panel pad log">${S.state.log.length ? S.state.log.slice(0, 40).map(l => `<div><b>${esc(l.text)}</b> <span class="muted">· ${esc(l.by || "")} · ${new Date(l.at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></div>`).join("") : '<span class="muted">No changes yet.</span>'}</section>
  <p class="note">Courses available: ${CLUBS.map(c => `${esc(c.name)} (${c.courses.map(x => esc(x.name)).join(", ")})`).join(" · ")}.</p>`;
  return h;
}

function setupView() {
  if (!ui.pinOk) {
    return `<div class="backbar"><button class="btn sm" data-act="close">‹ Back</button></div>
      <section class="panel form"><div class="field"><label for="pin">Trip PIN</label><input id="pin" inputmode="numeric" autocomplete="off" placeholder="Enter PIN"></div><div class="field"><button class="btn primary" data-act="pin">Unlock setup</button></div></section>`;
  }
  const d = ui.draft;
  const head = (title) => `<div class="backbar"><button class="btn sm" data-act="close">‹ ${ui.dirty ? "Discard" : "Back"}</button><b>${title}</b><button class="btn sm primary" data-act="save" ${ui.dirty ? "" : "disabled"}>Save</button></div>`;
  if (ui.more === "trip") return head("Trip settings") + `<section class="panel form">
    ${fld("Trip name", `<input data-f="name" value="${esc(d.name)}">`)}
    ${fld("Subtitle", `<input data-f="subtitle" value="${esc(d.subtitle || "")}">`)}
    ${fld("Setup PIN", `<input data-f="pin" inputmode="numeric" value="${esc(d.pin)}">`)}
    <div class="field"><div class="row2">
      <div><span class="lbl">Default distances</span><select class="in" data-f="unit"><option value="m" ${d.unit === "m" ? "selected" : ""}>Metres</option><option value="yd" ${d.unit === "yd" ? "selected" : ""}>Yards</option></select></div>
      <div><span class="lbl">Skins</span><select class="in" data-f="skinsMode"><option value="net" ${d.skinsMode !== "gross" ? "selected" : ""}>Net</option><option value="gross" ${d.skinsMode === "gross" ? "selected" : ""}>Gross</option></select></div></div></div>
    <div class="field"><label class="check"><input type="checkbox" data-f="fillPar" ${d.fillPar ? "checked" : ""}> Save par for untouched players when moving to the next hole</label></div>
  </section>`;
  if (ui.more === "teams") return head("Teams") + teams(d).map(([id, T]) => `<section class="panel form">
    ${fld("Team name", `<input data-team="${id}" data-tf="name" value="${esc(T.name)}">`)}
    <div class="field"><span class="lbl">Colour</span><div class="chips">${COLOURS.map(c => `<button class="chipbtn" data-act="teamColour" data-team="${id}" data-id="${c}" aria-pressed="${T.colour === c}"><span class="sw" style="background:var(--c-${c})"></span>${c}</button>`).join("")}</div></div>
    <div class="field"><span class="lbl">Players</span><div>${Object.values(d.players).filter(p => p.team === id).map(p => esc(p.name)).join(", ") || '<span class="muted">None. Assign players under Players.</span>'}</div>
    ${Object.values(d.players).some(p => p.team === id) ? "" : `<button class="btn sm danger" data-act="teamDel" data-team="${id}">Remove team</button>`}</div></section>`).join("") + `<button class="btn" data-act="teamAdd">+ Add team</button>`;
  if (ui.more === "players") return head("Players & handicaps") + `<section class="panel pad" style="display:flex;flex-direction:column;gap:8px">
    <div class="row3 lbl"><span>Name</span><span>Hcp</span><span>Team</span><span></span></div>
    ${Object.entries(d.players).map(([id, p]) => `<div class="row3"><input class="in" data-player="${id}" data-pf="name" value="${esc(p.name)}" aria-label="Name"><input class="in" data-player="${id}" data-pf="hcp" inputmode="decimal" value="${p.hcp ?? ""}" placeholder="?" aria-label="Handicap for ${esc(p.name)}">
      <select class="in" data-player="${id}" data-pf="team" aria-label="Team">${teams(d).map(([tid, T]) => `<option value="${tid}" ${p.team === tid ? "selected" : ""}>${esc(T.name)}</option>`).join("")}</select>
      <button class="btn sm" data-act="playerDel" data-id="${id}" aria-label="Remove ${esc(p.name)}">✕</button></div>`).join("")}
    <button class="btn" data-act="playerAdd">+ Add player</button></section>
    <p class="note">Use playing handicaps (whole numbers). Shots are spread over all 18 holes by stroke index, then each segment uses the shots on its own holes. Plus handicaps: enter as negative, e.g. -2.</p>`;
  if (ui.more === "rounds") return head("Rounds") + `<section class="panel list">${Object.values(d.rounds).sort((a, b) => (a.order || 0) - (b.order || 0)).map(r => `<button class="item" data-act="openRound" data-id="${r.id}"><div><b>${esc(r.label)} · ${dayLabel(r.date)}${d.currentRound === r.id ? ' <span class="chip live">Current</span>' : ""}</b><div class="sub">${esc(club(r.clubId)?.name || "?")} · ${esc(courseOf(r)?.name || "?")} · ${esc(teeOf(r)?.name || "?")} · ${(r.segments || []).map(seg => E.segLabel(seg) + " " + E.FORMATS[seg.format || "tbc"].short).join(", ")}</div></div><span class="go">›</span></button>`).join("")}</section>
    <button class="btn" data-act="roundAdd">+ Add round</button>`;
  if (ui.more.startsWith("round:")) return roundEditor(d.rounds[ui.more.slice(6)]);
  return "";
}
const fld = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;

function defaultSegments(holesCount) {
  return holesCount === 9
    ? [{ id: "sg" + Date.now().toString(36), from: 1, to: 9, format: "tbc", points: 1, basis: "stableford", matches: [] }]
    : [{ id: "sg" + Date.now().toString(36) + "a", from: 1, to: 9, format: "tbc", points: 1, basis: "stableford", matches: [] },
       { id: "sg" + Date.now().toString(36) + "b", from: 10, to: 18, format: "tbc", points: 1, basis: "stableford", matches: [] }];
}
function segPresetOf(segs, holesCount) {
  if (segs.length === 2 && segs[0].from === 1 && segs[0].to === 9 && segs[1].from === 10 && segs[1].to === 18) return "9+9";
  if (segs.length === 3 && segs.every(s => s.to - s.from === 5)) return "6+6+6";
  if (segs.length === 1 && segs[0].from === 1 && segs[0].to === holesCount) return "18";
  return "custom";
}
function roundEditor(r) {
  const d = ui.draft;
  const cl = club(r.clubId), c = courseOf(r);
  const assigned = {}; (r.groups || []).forEach((g, gi) => (g.playerIds || []).forEach(id => (assigned[id] = gi)));
  let h = `<div class="backbar"><button class="btn sm" data-act="closeRound">‹ Rounds</button><b>${esc(r.label)}</b><button class="btn sm primary" data-act="save" ${ui.dirty ? "" : "disabled"}>Save</button></div>
  <section class="panel form">
    <div class="field"><div class="row2"><div><span class="lbl">Name</span><input class="in" data-rf="label" value="${esc(r.label)}"></div><div><span class="lbl">Date</span><input class="in" type="date" data-rf="date" value="${esc(r.date || "")}"></div></div></div>
    ${fld("Club", `<select data-rf="clubId">${CLUBS.map(x => `<option value="${x.id}" ${x.id === r.clubId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`)}
    <div class="field"><div class="row2">
      <div><span class="lbl">Course</span><select class="in" data-rf="courseId">${(cl?.courses || []).map(x => `<option value="${x.id}" ${x.id === r.courseId ? "selected" : ""}>${esc(x.name)} (${x.holesCount})</option>`).join("")}</select></div>
      <div><span class="lbl">Tee</span><select class="in" data-rf="teeId">${(c?.tees || []).map(x => { const L = x.lengths?.[unit()] || x.lengths?.m; return `<option value="${x.id}" ${x.id === r.teeId ? "selected" : ""}>${esc(x.name)}${L?.total ? ` · ${L.total.toLocaleString("en-GB")} ${unit()}` : ""}</option>`; }).join("")}</select></div></div></div>
    <div class="field"><label class="check"><input type="checkbox" data-rf="handicaps" ${r.handicaps !== false ? "checked" : ""}> Use handicaps (off = gross)</label>
      ${c?.holes.some(x => x.parAlt) ? `<label class="check"><input type="checkbox" data-rf="useAltPar" ${r.useAltPar ? "checked" : ""}> Use alternative par (${c.holes.filter(x => x.parAlt).map(x => `hole ${x.number} par ${x.parAlt}`).join(", ")})</label>` : ""}
      <label class="check"><input type="checkbox" data-act="makeCurrent" ${d.currentRound === r.id ? "checked" : ""}> This is the current round</label></div>
  </section>
  <h2>Groups</h2>`;
  (r.groups || []).forEach((g, gi) => {
    h += `<section class="panel pad sub-panel" style="background:var(--surface)"><div class="row2"><div><span class="lbl">Tee time</span><input class="in" type="time" data-gi="${gi}" data-gf="time" value="${esc(g.time || "")}"></div><div style="display:flex;align-items:flex-end;justify-content:flex-end"><button class="btn sm danger" data-act="groupDel" data-gi="${gi}">Remove group</button></div></div>
      <div class="chips">${Object.entries(d.players).map(([id, p]) => `<button class="chipbtn ${assigned[id] !== undefined && assigned[id] !== gi ? "taken" : ""}" data-act="groupToggle" data-gi="${gi}" data-id="${id}" aria-pressed="${(g.playerIds || []).includes(id)}"><span class="sw" style="background:var(--c-${d.teams[p.team]?.colour || "black"})"></span>${esc(p.name)}</button>`).join("")}</div></section>`;
  });
  h += `<button class="btn" data-act="groupAdd">+ Add group</button><p class="note">Tapping a player who's in another group moves them here.</p><h2>Segments</h2>`;
  const holesCount = c?.holesCount || 18;
  const segs = r.segments || [];
  const preset = segPresetOf(segs, holesCount);
  h += `<section class="panel form"><div class="field"><span class="lbl">Layout</span><div class="seg" role="group" aria-label="Segment layout">
    ${[["9+9", "9 + 9"], ["6+6+6", "6 + 6 + 6"], ["18", "18"], ["custom", "Custom"]].filter(([k]) => holesCount === 9 ? k !== "9+9" && k !== "6+6+6" : true).map(([k, l]) => `<button data-act="segPreset" data-id="${k}" aria-pressed="${preset === k}">${l}</button>`).join("")}
  </div></div></section>`;
  segs.forEach(seg => {
    h += `<section class="panel form sub-panel" style="background:var(--surface)">
      <div class="field"><div class="row2">
        ${preset === "custom"
          ? `<div><span class="lbl">From hole</span><input class="in" type="number" min="1" max="${holesCount}" data-seg="${seg.id}" data-sf="from" value="${seg.from}"></div><div><span class="lbl">To hole</span><input class="in" type="number" min="1" max="${holesCount}" data-seg="${seg.id}" data-sf="to" value="${seg.to}"></div>`
          : `<div><span class="lbl">Holes</span><div style="padding-top:9px;font-weight:700">${esc(E.segLabel(seg))}</div></div><div></div>`}
      </div></div>
      <div class="field"><div class="row2">
        <div><span class="lbl">Format</span><select class="in" data-seg="${seg.id}" data-sf="format">${Object.entries(E.FORMATS).map(([k, f]) => `<option value="${k}" ${seg.format === k ? "selected" : ""}>${f.label}</option>`).join("")}</select></div>
        <div><span class="lbl">${seg.format === "singles" ? "Points per match" : "Points"}</span><input class="in" data-seg="${seg.id}" data-sf="points" inputmode="decimal" value="${seg.points ?? 1}"></div>
      </div></div>`;
    if (["teambestn", "singles", "betterball"].includes(seg.format)) {
      h += fld("Scoring basis", `<select class="in" data-seg="${seg.id}" data-sf="basis"><option value="stableford" ${!seg.basis || seg.basis === "stableford" ? "selected" : ""}>Stableford</option><option value="net" ${seg.basis === "net" ? "selected" : ""}>Net strokes</option><option value="gross" ${seg.basis === "gross" ? "selected" : ""}>Gross strokes</option></select>`);
    }
    if (seg.format === "teambestn") h += fld("Best of team's scores counts", `<input data-seg="${seg.id}" data-sf="count" inputmode="numeric" value="${seg.count ?? 1}">`);
    if (seg.format === "stableford") h += fld("Count best (0 = all players)", `<input data-seg="${seg.id}" data-sf="bestN" inputmode="numeric" value="${seg.bestN ?? 0}">`);
    if (seg.format === "betterball") h += fld("Scores that count per hole", `<input data-seg="${seg.id}" data-sf="bestN" inputmode="numeric" value="${seg.bestN || 1}">`);
    if (seg.format === "scramble") h += fld("Team handicap % (lowest handicap first)", `<input data-seg="${seg.id}" data-sf="allowance" value="${esc(seg.allowance || "20,15,10")}">`);
    if (seg.format === "singles" && seg.basis && seg.basis !== "stableford") h += fld("Handicap allowance %", `<input data-seg="${seg.id}" data-sf="allowance" inputmode="numeric" value="${esc(seg.allowance || "100")}">`);
    if (seg.format === "singles") {
      const tm = teams(d);
      const opts = (tid, sel) => `<option value="">Player</option>` + Object.entries(d.players).filter(([, p]) => !tid || p.team === tid).map(([id, p]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
      h += `<div class="field"><span class="lbl">Matches</span>${(seg.matches || []).map((m, mi) => `<div class="row3" style="grid-template-columns:1fr auto 1fr auto"><select class="in" data-seg="${seg.id}" data-mi="${mi}" data-mf="a">${opts(tm[0]?.[0], m.a)}</select><span class="muted">v</span><select class="in" data-seg="${seg.id}" data-mi="${mi}" data-mf="b">${opts(tm[1]?.[0], m.b)}</select><button class="btn sm" data-act="matchDel" data-seg="${seg.id}" data-mi="${mi}" aria-label="Remove match">✕</button></div>`).join("")}
        <div class="row2"><button class="btn sm" data-act="matchAdd" data-seg="${seg.id}">+ Add match</button><button class="btn sm" data-act="matchAuto" data-seg="${seg.id}">Pair by handicap</button></div></div>`;
    }
    if (preset === "custom") h += `<button class="btn sm danger" data-act="segDel" data-id="${seg.id}">Remove segment</button>`;
    h += `</section>`;
  });
  if (preset === "custom") h += `<button class="btn" data-act="segAdd">+ Add segment</button>`;
  h += `<p class="note">Segments are flexible: 9 + 9, 6 + 6 + 6, or a full 18. Every format is available for any segment.</p>`;
  h += `<button class="btn danger" data-act="roundDel" data-id="${r.id}">Delete this round</button>`;
  return h;
}

// ---------- events ----------
function markDirty() { if (!ui.dirty) { ui.dirty = true; const b = view.querySelector('[data-act="save"]'); if (b) b.disabled = false; const c = view.querySelector('[data-act="close"]'); if (c) c.textContent = "‹ Discard"; } }
function redrawForm() { const was = ui.dirty; ui.dirty = false; ui.redrawing = true; render(true); ui.redrawing = false; ui.dirty = was; if (was) { ui.dirty = false; markDirty(); } }
const curRoundDraft = () => ui.draft.rounds[ui.more.slice(6)];

view.addEventListener("input", e => {
  const el = e.target; const d = ui.draft;
  if (!d) return;
  const v = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.f) { d[el.dataset.f] = v; markDirty(); }
  else if (el.dataset.tf) { d.teams[el.dataset.team][el.dataset.tf] = v; markDirty(); }
  else if (el.dataset.pf) {
    const p = d.players[el.dataset.player];
    if (el.dataset.pf === "hcp") p.hcp = v === "" ? null : Number(v); else p[el.dataset.pf] = v;
    markDirty();
  }
  else if (el.dataset.gf) { curRoundDraft().groups[+el.dataset.gi][el.dataset.gf] = v; markDirty(); }
  else if (el.dataset.seg && el.dataset.sf) {
    const seg = curRoundDraft().segments.find(x => x.id === el.dataset.seg);
    const f = el.dataset.sf;
    const numeric = ["points", "bestN", "count", "from", "to"].includes(f);
    seg[f] = numeric ? (v === "" ? (f === "from" || f === "to" ? 1 : 0) : Number(v)) : v;
    markDirty();
    if (f === "format") {
      if (seg.format === "scramble" && !seg.allowance) seg.allowance = "20,15,10";
      if (seg.format === "singles" && (!seg.allowance || seg.allowance.includes(","))) seg.allowance = "100";
      if (!seg.matches) seg.matches = [];
      redrawForm();
    }
    if (f === "basis") redrawForm();
    if (f === "from" || f === "to") redrawForm();
  }
  else if (el.dataset.mf) { curRoundDraft().segments.find(x => x.id === el.dataset.seg).matches[+el.dataset.mi][el.dataset.mf] = v; markDirty(); }
  else if (el.dataset.rf) {
    const r = curRoundDraft(); r[el.dataset.rf] = v; markDirty();
    if (el.dataset.rf === "clubId") { const cl = club(v); r.courseId = cl.courses[0].id; }
    if (["clubId", "courseId"].includes(el.dataset.rf)) {
      const c = courseOf(r); if (!c.tees.find(t => t.id === r.teeId)) r.teeId = (c.tees.find(t => /jaune|yellow/i.test(t.id)) || c.tees[0]).id;
      if (c.holesCount === 9) r.segments = (r.segments || []).slice(0, 1).map(s => ({ ...s, from: 1, to: 9 }));
      if (!r.segments || !r.segments.length) r.segments = defaultSegments(c.holesCount);
      redrawForm();
    }
  }
});
view.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "scorer") { ui.scorer = el.value; lsSet("scorer", el.value); toast("Thanks, " + (pname(el.value) || "")); }
  if (el.dataset.act === "cell") {
    const r = currentRound(); const raw = el.value.trim().toUpperCase();
    const v = raw === "" ? null : raw === "P" || raw === "X" ? "P" : Number(raw);
    if (v !== null && v !== "P" && (!Number.isInteger(v) || v < 1 || v > 20)) { toast("Enter a score from 1 to 20, or P"); el.value = ""; return; }
    writeScore(r.id, el.dataset.k, +el.dataset.n, v);
  }
});

view.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, d = ui.draft;
  const r = currentRound();
  switch (a) {
    case "round": ui.roundId = b.dataset.id; ui.groupIdx = 0; ui.segId = null; break;
    case "group": ui.groupIdx = +b.dataset.i; lsSet("group", ui.groupIdx); break;
    case "seg": ui.segId = b.dataset.id; break;
    case "mode": ui.mode = b.dataset.id; break;
    case "hole": ui.hole[`${r.id}:${ui.groupIdx}:${ui.segId}`] = +b.dataset.n; break;
    case "unit": ui.unit = unit() === "m" ? "yd" : "m"; lsSet("unit", ui.unit); break;
    case "plus": case "minus": {
      const n = +b.dataset.n, par = E.parOf(courseOf(r), r, n); let v = E.val(scoresOf(r.id), b.dataset.k, n);
      v = !E.has(v) || v === "P" ? par : v; v = Math.min(20, Math.max(1, v + (a === "plus" ? 1 : -1)));
      await writeScore(r.id, b.dataset.k, n, v); break;
    }
    case "pu": { const n = +b.dataset.n; const v = E.val(scoresOf(r.id), b.dataset.k, n); await writeScore(r.id, b.dataset.k, n, v === "P" ? null : "P"); break; }
    case "prev": case "next": {
      const c = courseOf(r), segs = segmentsOf(r), segIdx = segs.findIndex(s => s.id === ui.segId), seg = segs[segIdx];
      const holes = E.segmentHoles(c, seg), hk = `${r.id}:${ui.groupIdx}:${ui.segId}`, n = ui.hole[hk], i = holes.indexOf(n);
      if (a === "next") {
        if (trip().fillPar) {
          const g = r.groups[ui.groupIdx];
          for (const rw of scoreRows(r, g, seg)) if (!E.has(E.val(scoresOf(r.id), rw.key, n))) await writeScore(r.id, rw.key, n, E.parOf(c, r, n));
        }
        if (i < holes.length - 1) ui.hole[hk] = holes[i + 1];
        else if (segs[segIdx + 1]) { ui.segId = segs[segIdx + 1].id; toast("Next segment"); }
        else toast("Round saved");
      } else if (i > 0) ui.hole[hk] = holes[i - 1];
      window.scrollTo({ top: 0 }); break;
    }
    case "board": ui.board = b.dataset.id; break;
    case "cardsRound": ui.cardsRound = b.dataset.id; break;
    case "betAdd": {
      const rid = b.dataset.id; const t = structuredClone(trip());
      t.bets = t.bets || []; t.bets.push({ id: "b" + Date.now(), roundId: rid, type: $(`#bt-${rid}`).value, hole: $(`#bh-${rid}`).value, winner: $(`#bw-${rid}`).value, note: $(`#bn-${rid}`).value.trim() });
      await S.saveTrip(t); toast("Added"); break;
    }
    case "betDel": { const t = structuredClone(trip()); t.bets = (t.bets || []).filter(x => x.id !== b.dataset.id); await S.saveTrip(t); break; }
    case "resetDemo": if (confirm("Clear all demo data on this phone?")) S.resetDemo(); return;
    case "open": ui.more = b.dataset.id; ui.draft = structuredClone(trip()); ui.dirty = false; window.scrollTo({ top: 0 }); break;
    case "close": if (ui.dirty && !confirm("Discard your changes?")) return; ui.more = null; ui.draft = null; ui.dirty = false; break;
    case "pin": { const v = $("#pin").value.trim(); if (v === String(trip().pin)) { ui.pinOk = true; lsSet("pin:" + TRIP_ID, true); } else { toast("Wrong PIN"); return; } break; }
    case "save": {
      await S.saveTrip(ui.draft); await S.addLog({ text: `Setup changed (${ui.more.startsWith("round:") ? d.rounds[ui.more.slice(6)]?.label : ui.more})`, by: ui.scorer ? pname(ui.scorer) : "Unknown phone" });
      ui.dirty = false; ui.draft = structuredClone(ui.draft); toast("Saved"); break;
    }
    case "teamColour": d.teams[b.dataset.team].colour = b.dataset.id; markDirty(); redrawForm(); return;
    case "teamAdd": { const id = "t" + Date.now().toString(36); d.teams[id] = { name: "New team", colour: COLOURS.find(c => !Object.values(d.teams).some(t => t.colour === c)) || "black", order: Object.keys(d.teams).length + 1 }; markDirty(); redrawForm(); return; }
    case "teamDel": delete d.teams[b.dataset.team]; markDirty(); redrawForm(); return;
    case "playerAdd": { const id = "p" + Date.now().toString(36); d.players[id] = { name: "New player", hcp: null, team: teams(d)[0]?.[0] }; markDirty(); redrawForm(); return; }
    case "playerDel": {
      const id = b.dataset.id; if (!confirm(`Remove ${d.players[id].name}? Their scores stay stored but won't show.`)) return;
      delete d.players[id]; Object.values(d.rounds).forEach(rr => { rr.groups.forEach(g => (g.playerIds = g.playerIds.filter(x => x !== id))); (rr.segments || []).forEach(seg => (seg.matches = (seg.matches || []).filter(m => m.a !== id && m.b !== id))); });
      markDirty(); redrawForm(); return;
    }
    case "roundAdd": {
      const rs = Object.values(d.rounds); const last = rs.sort((x, y) => (x.order || 0) - (y.order || 0)).at(-1);
      const id = "r" + Date.now().toString(36);
      const lastCourse = last ? club(last.clubId)?.courses.find(c => c.id === last.courseId) : CLUBS[0].courses[0];
      d.rounds[id] = { id, label: `Round ${rs.length + 1}`, date: "", order: (last?.order || 0) + 1, clubId: last?.clubId || CLUBS[0].id, courseId: last?.courseId || CLUBS[0].courses[0].id, teeId: last?.teeId || CLUBS[0].courses[0].tees[0].id, handicaps: true, useAltPar: false, groups: [{ id: "g1", time: "", playerIds: [] }], segments: defaultSegments(lastCourse?.holesCount || 18) };
      ui.more = "round:" + id; markDirty(); redrawForm(); return;
    }
    case "openRound": ui.more = "round:" + b.dataset.id; window.scrollTo({ top: 0 }); redrawForm(); return;
    case "closeRound": ui.more = "rounds"; redrawForm(); return;
    case "roundDel": if (!confirm("Delete this round? Its scores stay stored but won't show.")) return; delete d.rounds[b.dataset.id]; if (d.currentRound === b.dataset.id) d.currentRound = Object.keys(d.rounds)[0] || null; ui.more = "rounds"; markDirty(); redrawForm(); return;
    case "makeCurrent": d.currentRound = curRoundDraft().id; markDirty(); return;
    case "groupAdd": { const rr = curRoundDraft(); rr.groups.push({ id: "g" + Date.now().toString(36), time: "", playerIds: [] }); markDirty(); redrawForm(); return; }
    case "groupDel": curRoundDraft().groups.splice(+b.dataset.gi, 1); markDirty(); redrawForm(); return;
    case "groupToggle": {
      const rr = curRoundDraft(), gi = +b.dataset.gi, id = b.dataset.id, g = rr.groups[gi];
      if (g.playerIds.includes(id)) g.playerIds = g.playerIds.filter(x => x !== id);
      else { rr.groups.forEach(x => (x.playerIds = x.playerIds.filter(y => y !== id))); g.playerIds.push(id); }
      markDirty(); redrawForm(); return;
    }
    case "segPreset": {
      const rr = curRoundDraft(); const c = courseOf(rr); const hc = c?.holesCount || 18;
      const old = rr.segments || [];
      const mk = (from, to, i) => { const prev = old[i]; return prev ? { ...prev, from, to } : { id: "sg" + Date.now().toString(36) + i, from, to, format: "tbc", points: 1, basis: "stableford", matches: [] }; };
      if (b.dataset.id === "9+9") rr.segments = hc === 9 ? [mk(1, 9, 0)] : [mk(1, 9, 0), mk(10, 18, 1)];
      else if (b.dataset.id === "6+6+6") rr.segments = hc >= 18 ? [mk(1, 6, 0), mk(7, 12, 1), mk(13, 18, 2)] : [mk(1, 9, 0)];
      else if (b.dataset.id === "18") rr.segments = [mk(1, hc, 0)];
      else if (b.dataset.id === "custom" && !old.length) rr.segments = [mk(1, hc, 0)];
      markDirty(); redrawForm(); return;
    }
    case "segAdd": { const rr = curRoundDraft(); const c = courseOf(rr); rr.segments.push({ id: "sg" + Date.now().toString(36), from: 1, to: c?.holesCount || 18, format: "tbc", points: 1, basis: "stableford", matches: [] }); markDirty(); redrawForm(); return; }
    case "segDel": { const rr = curRoundDraft(); rr.segments = rr.segments.filter(s => s.id !== b.dataset.id); markDirty(); redrawForm(); return; }
    case "matchAdd": { const seg = curRoundDraft().segments.find(x => x.id === b.dataset.seg); seg.matches = seg.matches || []; seg.matches.push({ a: "", b: "" }); markDirty(); redrawForm(); return; }
    case "matchDel": curRoundDraft().segments.find(x => x.id === b.dataset.seg).matches.splice(+b.dataset.mi, 1); markDirty(); redrawForm(); return;
    case "matchAuto": {
      const rr = curRoundDraft(), seg = rr.segments.find(x => x.id === b.dataset.seg), tm = teams(d);
      if (tm.length < 2) return;
      const inRound = new Set(rr.groups.flatMap(g => g.playerIds));
      const side = tid => Object.entries(d.players).filter(([id, p]) => p.team === tid && inRound.has(id)).sort((x, y) => (x[1].hcp ?? 99) - (y[1].hcp ?? 99)).map(([id]) => id);
      const A = side(tm[0][0]), B = side(tm[1][0]);
      seg.matches = A.slice(0, Math.min(A.length, B.length)).map((id, i) => ({ a: id, b: B[i] }));
      if (!seg.matches.length) toast("Put players in groups first");
      markDirty(); redrawForm(); return;
    }
    default: return;
  }
  render(true);
});
document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => {
  if (ui.dirty && !confirm("Discard unsaved setup changes?")) return;
  if (ui.tab === "more" && b.dataset.tab !== "more") { ui.more = null; ui.draft = null; ui.dirty = false; }
  ui.tab = b.dataset.tab; lsSet("tab", ui.tab); render(true); window.scrollTo({ top: 0 });
}));

// ---------- boot ----------
function ensureMigrated() {
  const t = trip(); if (!t) return false;
  let changed = false;
  for (const rid in t.rounds) {
    const r = t.rounds[rid];
    if (!r.segments && r.nines) { t.rounds[rid] = E.migrateRound(r, courseOf(r)); changed = true; }
  }
  return changed;
}
async function boot() {
  try {
    const lib = await (await fetch("courses/library.json", { cache: "no-cache" })).json();
    const files = await Promise.all(lib.clubs.map(p => fetch("courses/" + p, { cache: "no-cache" }).then(r => r.json())));
    CLUBS = files;
  } catch (e) { view.innerHTML = `<div class="banner">Couldn't load the course library. If you opened the file directly, it needs to be served from GitHub Pages or a local web server.</div>`; return; }
  S.subscribe(() => {
    if (S.state.trip && CLUBS.length && ensureMigrated()) { S.saveTrip(S.state.trip); return; }
    render();
  });
  try { await S.start(TRIP_ID, seedTrip); }
  catch (e) { view.innerHTML = `<div class="banner">Couldn't start: ${esc(e.message)}</div>`; }
}
boot();
