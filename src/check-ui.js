import { matchHost, matchName, findIssns, pageFlags, profileSignals, verdict, issnValid, host } from "./check.js";
import { urls, profile as toProfile } from "./finder.js";
import { lists, fetchJson, esc, fmt } from "./lists.js";

const $ = (id) => document.getElementById(id);
const S = { ready: false, report: null };
window.__jc = S;
const LEVEL = {
  listed: ["⛔", "On a predatory-journal list", "Do not submit here before you have checked the evidence below yourself."],
  caution: ["⚠️", "Several warning signs", "These are signs to look closer, not proof. Read each reason below."],
  "look-closer": ["🔎", "A weak warning sign", "Probably fine, but read the reason below."],
  "no-signals": ["✅", "No warning signs found", "Nothing on the lists and nothing on this page that the checker knows to look for. That is not a guarantee."],
};

async function lookup(issns) {
  for (const i of issns.filter((x) => x.valid).slice(0, 2)) {
    const j = await fetchJson(urls.issn(i.issn));
    if (j && !j.error) return { issn: i.issn, profile: toProfile(j) };
  }
  return { issn: null, profile: null };
}

function render(R) {
  const v = R.verdict, [ico, head, sub] = LEVEL[v.level];
  const p = R.profile;
  $("report").innerHTML = `
  <div class="banner ${v.level}" id="banner"><div class="ico">${ico}</div><div><h2>${head}</h2><p>${esc(R.subject)} — ${sub}</p></div></div>
  <div class="grid2">
   <div class="card"><h3>Why</h3>${v.reasons.length ? `<ul class="reasons">${v.reasons.map((r) => `<li><span class="w w${r.w}">${r.w >= 9 ? "!!" : "+" + r.w}</span><div>${esc(r.label)}${r.evidence ? `<q>${esc(r.evidence)}</q>` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No reasons to report.</p>`}
    ${R.listHit?.kind === "hijacked" ? `<p>The authentic journal: <b>${esc(R.listHit.authentic)}</b>${R.listHit.authenticUrl ? ` — <a href="${esc(R.listHit.authenticUrl)}" target="_blank" rel="noopener">${esc(host(R.listHit.authenticUrl))}</a>` : ""}</p>` : ""}
    ${R.listHit && R.listHit.kind !== "hijacked" ? `<p class="muted">List entry: <a href="${esc(R.listHit.url)}" target="_blank" rel="noopener">${esc(R.listHit.url)}</a>. Lists are snapshots and can be wrong or out of date.</p>` : ""}
   </div>
   <div class="card"><h3>Facts</h3><table class="kv">
    ${R.url ? `<tr><td>Web site</td><td>${esc(host(R.url))}</td></tr>` : ""}
    <tr><td>ISSNs on the page</td><td>${R.issns.length ? R.issns.map((i) => `${esc(i.issn)} <span class="${i.valid ? "ok" : "bad"}">${i.valid ? "✓" : "✗ check digit"}</span>`).join("<br>") : "none found"}</td></tr>
    ${p ? `<tr><td>In OpenAlex as</td><td><a href="https://openalex.org/${p.id}" target="_blank" rel="noopener">${esc(p.name)}</a></td></tr>
    <tr><td>Publisher</td><td>${esc(p.publisher || "—")}</td></tr>
    <tr><td>Papers · h-index</td><td>${fmt(p.works)} · ${fmt(p.h)}</td></tr>
    <tr><td>2-year mean citations</td><td>${fmt(p.citedness2y, 2)}</td></tr>
    <tr><td>Open access · DOAJ</td><td>${p.isOa ? "yes" : "no"} · ${p.inDoaj ? "yes" : "no"}</td></tr>
    <tr><td>APC (OpenAlex)</td><td>${p.apcUsd ? "$" + fmt(p.apcUsd) : "—"}</td></tr>` : `<tr><td>OpenAlex</td><td>${R.looked ? "not found by ISSN" : "not looked up (no valid ISSN)"}</td></tr>`}
   </table></div>
  </div>`;
}

async function checkPage(info) {
  const I = await lists();
  const listHit = matchHost(info.url, I) || info.names.map((n) => matchName(n, I)).find(Boolean) || null;
  const issns = findIssns(info.text);
  const pageHits = pageFlags(info.text);
  let profile = null, looked = false;
  if (!listHit && issns.some((i) => i.valid)) { looked = true; ({ profile } = await lookup(issns)); }
  const profileHits = looked ? profileSignals(profile) : [];
  if (!issns.length) pageHits.push({ id: "no-issn", w: 1, label: "no ISSN found on this page (look on the journal's home or about page)" });
  return { subject: info.names[0] || host(info.url), url: info.url, listHit, issns, profile, looked, verdict: verdict({ listHit, pageHits, profileHits, issns }) };
}

async function checkText(q) {
  const I = await lists();
  const s = q.trim();
  if (/^\d{4}-?\d{3}[\dXx]$/.test(s)) {
    const issn = s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4) : s.toUpperCase();
    const issns = [{ issn, valid: issnValid(issn) }];
    const { profile } = issns[0].valid ? await lookup(issns) : { profile: null };
    const listHit = profile ? matchName(profile.name, I) || (profile.publisher && matchName(profile.publisher, I)) : null;
    return { subject: profile?.name || `ISSN ${issn}`, issns, profile, looked: issns[0].valid, listHit,
      verdict: verdict({ listHit, issns, profileHits: issns[0].valid ? profileSignals(profile) : [] }) };
  }
  if (/^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(s) && !/\s/.test(s)) {
    const listHit = matchHost(s, I);
    return { subject: host(s), url: s, issns: [], listHit, verdict: verdict({ listHit }) };
  }
  const listHit = matchName(s, I);
  return { subject: s, issns: [], listHit, verdict: verdict({ listHit }) };
}

async function checkSource(id) {
  const I = await lists();
  const p = toProfile(await fetchJson(urls.source(id)));
  const listHit = p ? matchName(p.name, I) || (p.publisher && matchName(p.publisher, I)) : null;
  return { subject: p?.name || id, issns: (p?.issn || []).map((i) => ({ issn: i, valid: issnValid(i) })), profile: p, looked: true, listHit,
    verdict: verdict({ listHit, profileHits: profileSignals(p) }) };
}

async function go(fn, label) {
  $("status").textContent = label;
  try { S.report = await fn(); render(S.report); $("status").textContent = ""; S.ready = true; }
  catch (e) { $("status").textContent = String(e.message || e); }
}

$("go").onclick = () => { const q = $("what").value; if (q.trim()) go(() => checkText(q), "checking…"); };
$("what").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
const P = new URLSearchParams(location.search);
if (P.get("k")) {
  const info = (await chrome.storage.session.get(P.get("k")))[P.get("k")];
  if (info) { $("what").value = info.url; go(() => checkPage(info), "reading the page…"); }
} else if (P.get("source")) go(() => checkSource(P.get("source")), "asking OpenAlex…");
S.checkText = (q) => go(() => checkText(q), "checking…");
