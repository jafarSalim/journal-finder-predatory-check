// Journal finder: turn a title + abstract into an OpenAlex search, take the most similar
// published papers (OpenAlex relevance ranking) and vote for the journals they appeared in.
// Pure functions; the network is injected (fetchJson) so the extension, the tests and the
// benchmark (recorded answers) run the same code.

export const OA = "https://api.openalex.org";

const STOP = new Set(`a about above across after again against all almost along also although am among an and another any are
around as at be because been before being below between both but by can could did do does doing done down due during each
either enough especially etc even ever every few for from further had has have having here how however i if in into is it its
itself just least less like made make many may me might more most much must my near nearly neither no nor not now of off often
on once one only or other others our ours out over own per perhaps rather same several shall she should since so some such than
that the their theirs them then there therefore these they this those though through thus to too toward towards under until
up upon us very via was we well were what when where whether which while who whom whose why will with within without would yet
you your paper article work study propose proposed proposes present presents presented show shows shown demonstrate approach
approaches method methods novel new results result based using use used uses first second third two three four five also
achieve achieves achieved obtain obtained provide provides provided consider considered existing compared comparison
significant significantly respectively high low large small better best good effective efficient efficiently various
different several further thus main key important problem problems issue issues scheme schemes technique techniques
framework frameworks towards toward investigate investigated analyze analyzed analysis evaluate evaluated performance
improve improved improvement improves extensive experiments experimental simulation simulations simulated numerical
demonstrates outperforms outperform state art conventional traditional proposed `.split(/\s+/));

const tokens = (s) => (String(s || "").match(/[A-Za-z][A-Za-z0-9À-ɏ-]*[A-Za-z0-9]|[0-9]+[A-Za-z]+[A-Za-z0-9]*/g) || []);

// keep acronyms (MIMO, OFDM, 6G) and content words; drop stop words and filler
function clean(tok) {
  const low = tok.toLowerCase().replace(/^-+|-+$/g, "");
  if (STOP.has(low)) return null;
  if (low.length < 3 && !/\d/.test(low)) return null;
  if (/^\d+$/.test(low)) return null;
  return low;
}

// Rank the words of a title + abstract: title words count three times, abstract words once
// per occurrence; ties keep the order of first appearance (titles read naturally).
export function keywords(title, abstract = "", max = 8) {
  const score = new Map(), first = new Map();
  let pos = 0;
  const add = (text, w) => {
    for (const t of tokens(text)) {
      const k = clean(t);
      pos++;
      if (!k) continue;
      score.set(k, (score.get(k) || 0) + w);
      if (!first.has(k)) first.set(k, pos);
    }
  };
  add(title, 3);
  add(abstract, 1);
  return [...score.keys()].sort((a, b) => score.get(b) - score.get(a) || first.get(a) - first.get(b)).slice(0, max);
}

// OpenAlex search string: the best keywords, in order of first appearance, up to maxLen chars
export function buildQuery(title, abstract = "", { maxWords = 8, maxLen = 80 } = {}) {
  const kw = keywords(title, abstract, maxWords);
  const order = tokens(`${title} ${abstract}`).map((t) => t.toLowerCase());
  kw.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const out = [];
  for (const k of kw) {
    if ([...out, k].join(" ").length > maxLen) break;
    out.push(k);
  }
  return out.join(" ");
}

export const urls = {
  similar: (q, n = 50) => `${OA}/works?search=${encodeURIComponent(q)}&per_page=${n}&select=id,display_name,publication_year,primary_location`,
  source: (id) => `${OA}/sources/${id}`,
  issn: (issn) => `${OA}/sources/issn:${issn}`,
};

const short = (u) => String(u || "").replace("https://openalex.org/", "");

// Vote for venues among the ranked neighbours. weight "rank" = 1/log2(rank+1) (like DCG),
// "count" = 1 per paper. Only journals are suggested unless `types` says otherwise.
export function suggest(results, { exclude = [], maxYear = Infinity, weight = "rank", types = ["journal"], limit = 10 } = {}) {
  const ex = new Set(exclude.map(short));
  const v = new Map();
  let r = 0;
  for (const w of results || []) {
    const src = w.primary_location?.source;
    if (ex.has(short(w.id))) continue;
    if ((w.publication_year || 0) > maxYear) continue;
    r++;                                     // rank among the papers that are kept
    if (!src?.id || !types.includes(src.type || "journal")) continue;
    const id = short(src.id);
    const cur = v.get(id) || { id, name: src.display_name, publisher: src.host_organization_name || null,
      issn: src.issn_l || null, isOa: src.is_oa ?? null, inDoaj: src.is_in_doaj ?? null, score: 0, papers: 0, examples: [] };
    cur.score += weight === "count" ? 1 : 1 / Math.log2(r + 1);
    cur.papers++;
    if (cur.examples.length < 3) cur.examples.push({ id: short(w.id), title: w.display_name, year: w.publication_year });
    v.set(id, cur);
  }
  const list = [...v.values()].sort((a, b) => b.score - a.score || b.papers - a.papers || a.name.localeCompare(b.name));
  const tot = list.reduce((s, x) => s + x.score, 0) || 1;
  for (const x of list) x.share = x.score / tot;
  return list.slice(0, limit);
}

// The journal's profile from an OpenAlex source record, as plain signals
export function profile(src) {
  if (!src || src.error || !src.id) return null;
  const s = src.summary_stats || {};
  return {
    id: short(src.id), name: src.display_name, publisher: src.host_organization_name || null,
    issn: src.issn || [], issnL: src.issn_l || null, type: src.type, homepage: src.homepage_url || null,
    works: src.works_count ?? null, cited: src.cited_by_count ?? null,
    h: s.h_index ?? null, i10: s.i10_index ?? null, citedness2y: s["2yr_mean_citedness"] ?? null,
    isOa: src.is_oa ?? null, inDoaj: src.is_in_doaj ?? null, apcUsd: src.apc_usd ?? null,
    country: src.country_code || null, firstYear: (src.counts_by_year || []).reduce((m, c) => Math.min(m, c.year), 9999),
  };
}

// The whole finder in one call: 1 search + up to `profiles` source lookups
export async function findJournals(title, abstract, { fetchJson, profiles = 6, n = 50, onProgress = () => {} } = {}) {
  const q = buildQuery(title, abstract);
  if (!q) throw new Error("Give a title or an abstract with a few content words.");
  const calls = [];
  const get = async (u) => { calls.push(u); return fetchJson(u); };
  const sim = await get(urls.similar(q, n));
  onProgress("neighbours");
  const venues = suggest(sim.results || []);
  await Promise.all(venues.slice(0, profiles).map(async (v) => { v.profile = profile(await get(urls.source(v.id))); }));
  onProgress("profiles");
  return { query: q, neighbours: (sim.results || []).length, total: sim.meta?.count ?? null, venues, calls };
}
