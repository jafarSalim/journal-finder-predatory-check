import { findJournals, buildQuery } from "./finder.js";
import { matchName, profileSignals } from "./check.js";
import { lists, fetchJson, esc, fmt } from "./lists.js";

const $ = (id) => document.getElementById(id);
const S = { result: null, ready: false };
window.__jf = S;

function card(v, i, I) {
  const p = v.profile;
  const hit = matchName(v.name, I) || (v.publisher || p?.publisher ? matchName(v.publisher || p.publisher, I) : null);
  const sig = p ? profileSignals(p) : [];
  const chips = [];
  if (p) {
    chips.push(`<span class="chip plum" title="h-index in OpenAlex">h ${fmt(p.h)}</span>`);
    chips.push(`<span class="chip sky" title="mean citations in the 2 years after publication">2-yr cites ${fmt(p.citedness2y, 2)}</span>`);
    chips.push(`<span class="chip grey" title="papers in OpenAlex">${fmt(p.works)} papers</span>`);
    chips.push(p.isOa ? `<span class="chip teal">open access</span>` : `<span class="chip grey">subscription / hybrid</span>`);
    if (p.inDoaj) chips.push(`<span class="chip teal">DOAJ</span>`);
    if (p.apcUsd) chips.push(`<span class="chip mustard" title="article processing charge listed in OpenAlex">APC $${fmt(p.apcUsd)}</span>`);
  }
  if (hit) chips.unshift(`<span class="chip red">⛔ on a predatory list</span>`);
  const ex = v.examples.filter((e) => e.title).map((e) => `<li>${esc(e.title)}${e.title.length >= 70 ? "…" : ""} <span class="muted">(${e.year})</span></li>`).join("");
  return `<article class="card j${hit ? " listed" : ""}" data-id="${v.id}">
    <div class="rank">${i + 1}</div>
    <div><h3>${esc(v.name)}</h3><div class="pub">${esc(p?.publisher || v.publisher || "publisher not recorded")}${p?.issnL ? ` · ISSN ${esc(p.issnL)}` : ""}</div>
      <div class="chips">${chips.join("")}</div>
      ${ex ? `<ul class="ex">${ex}</ul>` : ""}
      ${hit ? `<div class="warn">"${esc(hit.name)}" is on the Stop Predatory Journals ${hit.kind} list (${esc(hit.how)}). Check the journal's web address before trusting this match.</div>` : ""}
      ${sig.length ? `<div class="sig">⚠ ${sig.map((s) => esc(s.label)).join(" · ")}</div>` : ""}
    </div>
    <div class="side"><div class="n">${v.papers} of the similar papers · ${(v.share * 100).toFixed(0)} % of the vote</div>
      <div class="share"><i style="width:${Math.min(100, v.share * 250).toFixed(0)}%"></i></div>
      ${p?.homepage ? `<a href="${esc(p.homepage)}" target="_blank" rel="noopener">journal site</a> · ` : ""}<a href="https://openalex.org/${v.id}" target="_blank" rel="noopener">OpenAlex</a><br>
      <a class="check" href="check.html?source=${v.id}">Check ▸</a></div>
  </article>`;
}

async function run() {
  const title = $("title").value.trim(), abs = $("abs").value.trim();
  $("q").innerHTML = "";
  if (!title && !abs) { $("status").textContent = "Paste a title or an abstract first."; return; }
  $("go").disabled = true;
  $("status").textContent = "asking OpenAlex for similar papers…";
  try {
    const t0 = performance.now();
    const I = await lists();
    const r = await findJournals(title, abs, { fetchJson, onProgress: (s) => ($("status").textContent = s === "neighbours" ? "reading journal profiles…" : "") });
    S.result = r;
    $("q").innerHTML = `Search used: <code>${esc(r.query)}</code> · ${fmt(r.total)} matching papers in OpenAlex, the top ${r.neighbours} were read.`;
    $("out").innerHTML = r.venues.length ? r.venues.map((v, i) => card(v, i, I)).join("") : `<div class="card empty">No journal papers came back. Try a longer abstract.</div>`;
    $("status").textContent = `${r.venues.length} journals · ${r.calls.length} requests · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    S.ready = true;
  } catch (e) {
    $("status").textContent = String(e.message || e);
  } finally { $("go").disabled = false; }
}

$("go").onclick = run;
$("title").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
const k = new URLSearchParams(location.search).get("k");
if (k) {
  const got = (await chrome.storage.session.get(k))[k];
  if (got) $("abs").value = got;
}
const demo = new URLSearchParams(location.search).get("demo");
if (demo) { const d = await (await fetch("examples/abstract.json")).json(); $("title").value = d.title; $("abs").value = d.abstract; }
S.run = run;
S.buildQuery = buildQuery;
