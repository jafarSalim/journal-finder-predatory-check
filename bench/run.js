// Benchmark: (1) the journal finder on published papers whose venue is known, from recorded
// OpenAlex answers; (2) the list matcher (perturbed names, real journal names, hijacked hosts);
// (3) ISSN check digits. Writes results/summary.json and results/finder.json.
import fs from "node:fs";
import { buildQuery, urls, suggest } from "../src/finder.js";
import { indexLists, matchName, matchHost, normName, issnValid } from "../src/check.js";
import { replayFetch, missing } from "./replay.js";

const P = JSON.parse(fs.readFileSync(new URL("./papers.json", import.meta.url)));
const L = JSON.parse(fs.readFileSync(new URL("../lists/lists.json", import.meta.url)));
const I = indexLists(L);
fs.mkdirSync("results", { recursive: true });

// ---------------------------------------------------------------- 1. journal finder
const rows = [];
const allNames = new Map();
for (const p of P) {
  const q = buildQuery(p.title);
  const ans = await replayFetch(urls.similar(q));
  if (!ans.results?.length) { rows.push({ ...p, query: q, recorded: false }); continue; }
  const self = ans.results.find((w) => w.id.endsWith(p.id));
  const truth = self?.primary_location?.source?.id?.replace("https://openalex.org/", "") || p.venue || null;
  const truthName = self?.primary_location?.source?.display_name || p.venueName || null;
  for (const w of ans.results) { const s = w.primary_location?.source; if (s?.type === "journal") allNames.set(s.id, s.display_name); }
  const rank = (list) => { const i = list.findIndex((v) => v.id === truth); return i < 0 ? null : i + 1; };
  const v = {
    rank: suggest(ans.results, { exclude: [p.id], limit: 50 }),
    count: suggest(ans.results, { exclude: [p.id], weight: "count", limit: 50 }),
    past: suggest(ans.results, { exclude: [p.id], maxYear: p.year, limit: 50 }),
  };
  rows.push({ id: p.id, title: p.title, year: p.year, query: q, total: ans.meta.count, truth, truthName,
    selfRank: self ? ans.results.indexOf(self) + 1 : null,
    kept: { rank: ans.results.filter((w) => !w.id.endsWith(p.id)).length, past: ans.results.filter((w) => !w.id.endsWith(p.id) && (w.publication_year || 0) <= p.year).length },
    ranks: { rank: rank(v.rank), count: rank(v.count), past: rank(v.past) },
    top5: v.rank.slice(0, 5).map((x) => ({ id: x.id, name: x.name, share: +x.share.toFixed(3), papers: x.papers })),
    listed: v.rank.slice(0, 10).map((x) => ({ x, hit: matchName(x.name, I) })).filter((o) => o.hit).map((o) => ({ name: o.x.name, list: o.hit.name, how: o.hit.how })) });
}
const done = rows.filter((r) => r.truth);
// baseline: rank journals by how often they appear among the neighbours of the OTHER papers
const popRank = (r) => {
  const c = new Map();
  for (const o of done) if (o !== r) for (const t of o.top5) c.set(t.id, (c.get(t.id) || 0) + t.papers);
  const order = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const i = order.indexOf(r.truth);
  return i < 0 ? null : i + 1;
};
for (const r of done) r.ranks.popularity = popRank(r);
const metric = (key) => {
  const rs = done.map((r) => r.ranks[key]);
  const hit = (k) => rs.filter((x) => x && x <= k).length;
  return { n: rs.length, hit1: hit(1), hit3: hit(3), hit5: hit(5), hit10: hit(10),
    mrr: +(rs.reduce((s, x) => s + (x ? 1 / x : 0), 0) / rs.length).toFixed(3) };
};
const finder = { papers: P.length, recorded: done.length, methods: {
  "rank-weighted (default)": metric("rank"), "plain count": metric("count"),
  "only papers up to the same year": metric("past"), "baseline: most popular journal of the other queries": metric("popularity") } };

// ---------------------------------------------------------------- 2. list matcher
// a) recall under the small changes people make when they type a name
const variants = (n) => [
  ["upper case", n.toUpperCase()],
  ["'&' ↔ 'and'", / and /i.test(n) ? n.replace(/ and /i, " & ") : n.replace(/ & /, " and ")],
  ["abbreviated 'Int. J.'", n.replace(/^International Journal of/i, "Int. J.").replace(/^Journal of/i, "J.")],
  ["leading 'The'", /^the /i.test(n) ? n.replace(/^the /i, "") : `The ${n}`],
  ["one typo (letters swapped)", (() => { const i = Math.floor(n.length / 2); return n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2); })()],
  ["one letter dropped", (() => { const i = Math.floor(n.length / 3); return n.slice(0, i) + n.slice(i + 1); })()],
];
const pert = {};
let tested = 0;
for (const j of L.journals) {
  if (normName(j.name).length < 8) continue;
  tested++;
  for (const [k, v] of variants(j.name)) {
    pert[k] ||= { tried: 0, found: 0, wrong: 0 };
    pert[k].tried++;
    const m = matchName(v, I);
    if (m && normName(m.name) === normName(j.name)) pert[k].found++;
    else if (m) pert[k].wrong++;
  }
}
// b) the real journal names that came back from OpenAlex in part 1: how many hit the list?
const real = [...allNames.values()].map((name) => ({ name, hit: matchName(name, I) }));
const realHits = real.filter((r) => r.hit).map((r) => ({ name: r.name, list: r.hit.name, how: r.hit.how, distance: r.hit.distance }));
// c) hijacked clones: the clone's host must be flagged as hijacked, the authentic host must not
let hjFlag = 0, hjTotal = 0, authOk = 0, authTotal = 0;
const authWrong = [];
for (const h of L.hijacked) {
  if (h.hijackedurl && !/scholarlyoa\.com|wordpress\.com|worldcat\.org|archive\.org/.test(h.hijackedurl)) { hjTotal++; if (matchHost(h.hijackedurl, I)?.kind === "hijacked") hjFlag++; }
  if (h.authenticurl && /^https?:/.test(h.authenticurl)) {
    authTotal++;
    const m = matchHost(h.authenticurl, I);
    if (!m || m.kind !== "hijacked") authOk++; else authWrong.push({ authentic: h.authenticurl, matched: m.how });
  }
}
// d) speed
const t0 = performance.now();
for (const name of allNames.values()) matchName(name, I);
const msPerName = (performance.now() - t0) / allNames.size;

// ---------------------------------------------------------------- 3. ISSN check digits
const issns = ["1536-1276", "0090-6778", "0733-8716", "1053-587X", "2169-3536", "0163-6804", "2162-2337", "0018-9545", "1932-4553", "1536-1284", "0890-8044", "1424-8220", "0975-8887", "2047-7538"];
let single = 0, singleCaught = 0, swaps = 0, swapsCaught = 0;
for (const s of issns) {
  const d = s.replace("-", "");
  for (let i = 0; i < 8; i++) {
    for (const c of "0123456789X") {
      if (c === d[i] || (c === "X" && i < 7)) continue;
      single++;
      const t = d.slice(0, i) + c + d.slice(i + 1);
      if (!issnValid(t.slice(0, 4) + "-" + t.slice(4))) singleCaught++;
    }
    if (i < 7 && d[i] !== d[i + 1]) {
      swaps++;
      const t = d.slice(0, i) + d[i + 1] + d[i] + d.slice(i + 2);
      if (!issnValid(t.slice(0, 4) + "-" + t.slice(4))) swapsCaught++;
    }
  }
}

const summary = {
  finder,
  lists: { snapshot: L.meta, perturbations: { names: tested, ...pert },
    realNames: { distinct: allNames.size, onList: realHits.length, hits: realHits },
    hijacked: { clones: hjTotal, flagged: hjFlag, authentic: authTotal, notFlagged: authOk, wrong: authWrong }, msPerName: +msPerName.toFixed(2) },
  issn: { valid: issns.length, allValid: issns.every(issnValid), singleErrors: single, singleCaught, transpositions: swaps, transpositionsCaught: swapsCaught },
  missing: missing.length,
};
fs.writeFileSync("results/summary.json", JSON.stringify(summary, null, 1));
fs.writeFileSync("results/finder.json", JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ finder, perturb: pert, real: summary.lists.realNames.onList, distinct: allNames.size, hijacked: summary.lists.hijacked, issn: summary.issn, missing: missing.length }, null, 1));
for (const r of rows) console.log(r.id, r.recorded === false ? "NOT RECORDED" : `${r.ranks.rank ?? "-"} ${r.ranks.count ?? "-"} ${r.ranks.past ?? "-"} ${r.ranks.popularity ?? "-"} | ${r.truthName} | ${r.top5.map((t) => t.name).slice(0, 3).join(" ; ")}`);
