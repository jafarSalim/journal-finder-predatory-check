// Predatory check: list matching (names, publishers, web hosts, hijacked clones), ISSN
// validation, red flags in a journal's own web page and caution signals from its OpenAlex
// profile. Every finding carries the reason it was raised; nothing here says a journal is "safe".

// ---- names --------------------------------------------------------------------------------
const ABBR = [[/\bint(?:l|ern)?\b\.?/g, "international"], [/\bj\b\.?/g, "journal"], [/\btrans\b\.?/g, "transactions"],
  [/\bres\b\.?/g, "research"], [/\bsci\b\.?/g, "science"], [/\beng(?:g)?\b\.?/g, "engineering"], [/\btechnol?\b\.?/g, "technology"],
  [/\badv\b\.?/g, "advanced"], [/\bmgmt\b\.?/g, "management"], [/\bcomput\b\.?/g, "computer"], [/\bappl\b\.?/g, "applied"]];

// lower case, accents removed, common abbreviations expanded ("Int. J." → "international
// journal"), punctuation and the small words (of, the, and/&, for, in, on, a, an) dropped
export function normName(s, { keepSmall = false } = {}) {
  let t = String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&amp;/g, "&").replace(/&/g, " and ");
  for (const [re, w] of ABBR) t = t.replace(re, w);
  t = t.replace(/[^a-z0-9]+/g, " ");
  if (!keepSmall) t = t.replace(/\b(?:the|of|and|for|in|on|a|an)\b/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// optimal-string-alignment distance (Levenshtein + adjacent swaps), stops early above `cap`
function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    pp = prev;
    prev = cur;
  }
  return prev[b.length];
}

export function host(url) {
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`).hostname.toLowerCase().replace(/^www\d?\./, ""); }
  catch { return ""; }
}

// Some list rows point at a page *about* a journal (Beall's blog, WorldCat, the Web Archive)
// instead of the journal's own site; those hosts must never be flagged themselves.
const REFERENCE_HOSTS = /(^|\.)(scholarlyoa\.com|wordpress\.com|worldcat\.org|archive\.org|doaj\.org|google\.com)$/;

// Build the lookup tables once from the bundled lists ({journals, publishers, hijacked})
export function indexLists(L) {
  const names = new Map();                    // normalised name → entry
  const light = new Map();                    // same, small words kept (for typos inside them)
  const hosts = new Map();                    // web host → entry
  const add = (kind, name, url, extra = {}) => {
    const e = { kind, name, url, ...extra };
    const n = normName(name);
    if (n.length >= 8 && !names.has(n)) names.set(n, e);
    const l = normName(name, { keepSmall: true });
    if (n.length >= 8 && !light.has(l)) light.set(l, e);
    const h = host(url);
    if (h && !REFERENCE_HOSTS.test(h) && !hosts.has(h)) hosts.set(h, e);
  };
  for (const j of L.journals || []) add("journal", j.name, j.url, { abbr: j.abbr || null });
  for (const p of L.publishers || []) add("publisher", p.name, p.url, { abbr: p.abbr || null });
  const hijacked = new Map();
  for (const h of L.hijacked || []) {
    const e = { kind: "hijacked", name: h.hijacked, url: h.hijackedurl, authentic: h.authentic, authenticUrl: h.authenticurl };
    for (const u of [h.hijackedurl, h.althijackedurl]) if (host(u) && !REFERENCE_HOSTS.test(host(u))) hijacked.set(host(u), e);
  }
  return { names, light, hosts, hijacked, meta: L.meta || {} };
}

// Does a journal / publisher name match a list entry? exact after normalisation, or within a
// small edit distance (1 for names up to 25 characters, 2 above) — typos and abbreviations,
// never a different subject ("Journal of Advanced Research" ≠ "Journal of Applied Research").
export function matchName(name, I) {
  const n = normName(name);
  if (n.length < 8) return null;
  if (I.names.has(n)) return { ...I.names.get(n), how: "exact name", distance: 0 };
  return near(n, I.names) || near(normName(name, { keepSmall: true }), I.light);
}

function near(n, table) {
  const cap = n.length > 25 ? 2 : 1;
  let best = null, bestKey = null;
  for (const k of table.keys()) {
    if (Math.abs(k.length - n.length) > cap) continue;
    const d = lev(n, k, cap);
    if (d <= cap && (!best || d < best.distance)) { best = { ...table.get(k), how: "near-identical name", distance: d }; bestKey = k; }
  }
  // one edit that turns a word into a different real word ("physics" ↔ "physical") is not a typo
  if (best && best.distance > 0) {
    const a = n.split(" "), b = bestKey.split(" ");
    if (a.length === b.length) {
      const i = a.findIndex((w, j) => w !== b[j]);
      const rest = a.every((w, j) => j === i || w === b[j]);
      if (rest && Math.min(a[i].length, b[i].length) > 3 && lev(a[i], b[i], 2) > 1) return null;
    }
  }
  return best;
}

// Is this web host a listed journal, a listed publisher or a known hijacked clone?
export function matchHost(url, I) {
  const h = host(url);
  if (!h) return null;
  for (let cur = h; cur.includes("."); cur = cur.slice(cur.indexOf(".") + 1)) {
    if (I.hijacked.has(cur)) return { ...I.hijacked.get(cur), how: `web host ${cur}` };
    if (I.hosts.has(cur)) return { ...I.hosts.get(cur), how: `web host ${cur}` };
  }
  return null;
}

// ---- ISSN ----------------------------------------------------------------------------------
export function issnValid(s) {
  const m = String(s).toUpperCase().match(/^(\d{4})-?(\d{3})([\dX])$/);
  if (!m) return false;
  const d = (m[1] + m[2]).split("").map(Number);
  const sum = d.reduce((acc, x, i) => acc + x * (8 - i), 0);
  const c = (11 - (sum % 11)) % 11;
  return (c === 10 ? "X" : String(c)) === m[3];
}

export function findIssns(text) {
  const out = [];
  const re = /\b(?:e-?|p-?|online\s*|print\s*)?ISSN[^0-9A-Za-z]{0,12}(?:\(?(?:online|print|electronic)\)?\s*[:\-–]?\s*)?(\d{4}\s?[-–]\s?\d{3}[\dXx])/gi;
  for (const m of String(text).matchAll(re)) {
    const v = m[1].replace(/\s/g, "").replace("–", "-").toUpperCase();
    if (!out.some((o) => o.issn === v)) out.push({ issn: v, valid: issnValid(v) });
  }
  return out;
}

// ---- red flags in the journal's own page ----------------------------------------------------
// weight 3 = strong, 2 = moderate, 1 = weak. The phrases come from the published "warning
// signs" checklists (Think.Check.Submit., COPE/DOAJ/OASPA principles) and from Beall's
// criteria; they are signs to look closer, not proof.
export const FLAGS = [
  { id: "fake-metric", w: 3, label: "advertises a metric that is not the Journal Impact Factor or CiteScore",
    re: /\b(global impact factor|universal impact factor|scientific journal impact factor|sjif|index copernicus value|icv\s*[:=]|i2or|cosmos impact factor|citefactor|international impact factor|ijif|journal impact factor\s*\(jif\)\s*[:=]\s*\d|research ?bib|isi impact factor|general impact factor|innospace|infobase index|eurasian scientific journal index|scientific indexing services|international scientific indexing|sindex)\b/i },
  { id: "fast-publication", w: 3, label: "promises acceptance or publication within days",
    re: /\b(publi(?:sh|cation)|accept(?:ed|ance)|review(?:ed)?|decision)\b[^.]{0,40}\bwithin\s+(?:\d{1,2}|one|two|three|five|seven|ten)\s*(?:-|to)?\s*\d{0,2}\s*(?:hours?|days?)\b|\b(?:24|48|72)\s*(?:hrs|hours)\s+(?:publication|review|acceptance)|\brapid publication in \d+ days\b/i },
  { id: "free-mail", w: 2, label: "uses a free web-mail address as the editorial contact",
    re: /\b[\w.+-]+@(?:gmail|yahoo|hotmail|outlook|rediffmail|aol|163|126|qq|yandex|mail)\.(?:com|in|co\.in|ru|cn)\b/i },
  { id: "scholar-indexing", w: 1, label: "lists Google Scholar or similar crawlers as 'indexing'",
    re: /\bindex(?:ed|ing)\s+(?:in|by|with)\b[^.]{0,80}\b(google scholar|academia\.edu|researchgate|scribd|crossref member)\b/i },
  { id: "certificate", w: 1, label: "sells or advertises publication certificates",
    re: /\b(e-?certificate|certificate of publication|publication certificate|hard ?copy certificate)\b/i },
  { id: "all-subjects", w: 1, label: "claims to cover all subjects",
    re: /\b(all (?:areas|fields|subjects|disciplines) of (?:science|engineering|research|knowledge)|multidisciplinary (?:international )?journal for all)\b/i },
  { id: "pay-first", w: 2, label: "asks for payment before or at submission",
    re: /\b(submission fee|pay(?:ment)? (?:before|at the time of) (?:review|submission)|processing fee must be paid before (?:review|acceptance)|western union|moneygram)\b/i },
  { id: "call-for-papers", w: 1, label: "monthly 'call for papers' banner with a deadline",
    re: /\bcall for papers?\b[^.]{0,60}\b(?:volume|vol\.?|issue)\b/i },
];

export function pageFlags(text) {
  const out = [];
  for (const f of FLAGS) {
    const m = String(text).match(f.re);
    if (m) out.push({ id: f.id, w: f.w, label: f.label, evidence: m[0].slice(0, 90) });
  }
  return out;
}

// ---- caution signals from the OpenAlex profile -------------------------------------------
export function profileSignals(p, year = new Date().getFullYear()) {
  if (!p) return [{ id: "not-indexed", w: 2, label: "not found in OpenAlex by its ISSN" }];
  const s = [];
  if (p.isOa && p.inDoaj === false && p.apcUsd > 0) s.push({ id: "oa-not-doaj", w: 2, label: "charges an APC but is not in DOAJ" });
  if (p.works > 2000 && p.citedness2y != null && p.citedness2y < 0.3) s.push({ id: "volume", w: 2, label: `many papers (${p.works.toLocaleString()}) but cited rarely (2-yr mean ${p.citedness2y.toFixed(2)})` });
  else if (p.citedness2y != null && p.citedness2y < 0.15 && p.works > 100) s.push({ id: "uncited", w: 1, label: `papers are rarely cited (2-yr mean ${p.citedness2y.toFixed(2)})` });
  if (!p.publisher) s.push({ id: "no-publisher", w: 1, label: "no publisher recorded in OpenAlex" });
  if (p.h != null && p.h < 5 && p.firstYear < year - 8) s.push({ id: "low-h", w: 1, label: `h-index ${p.h} after ${year - p.firstYear}+ years` });
  return s;
}

// The verdict combines everything. Being on a list or a hijacked host wins outright; otherwise
// the weights of the flags decide between "caution" and "no signals found".
export function verdict({ listHit, pageHits = [], profileHits = [], issns = [] }) {
  const reasons = [];
  if (listHit) reasons.push({ w: 9, label: listHit.kind === "hijacked"
    ? `this web site is listed as a HIJACKED copy of "${listHit.authentic}"`
    : `${listHit.kind === "publisher" ? "publisher" : "journal"} "${listHit.name}" is on the Stop Predatory Journals list (${listHit.how})` });
  for (const i of issns) if (!i.valid) reasons.push({ w: 2, label: `ISSN ${i.issn} fails its check digit` });
  for (const f of pageHits) reasons.push({ w: f.w, label: f.label, evidence: f.evidence });
  for (const f of profileHits) reasons.push({ w: f.w, label: f.label });
  const score = reasons.reduce((s, r) => s + r.w, 0);
  const level = listHit ? "listed" : score >= 5 ? "caution" : score >= 2 ? "look-closer" : "no-signals";
  return { level, score, reasons: reasons.sort((a, b) => b.w - a.w) };
}
