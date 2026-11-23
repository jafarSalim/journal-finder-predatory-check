import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normName, indexLists, matchName, matchHost, issnValid, findIssns, pageFlags, profileSignals, verdict } from "../src/check.js";

const I = indexLists(JSON.parse(fs.readFileSync(new URL("../lists/lists.json", import.meta.url))));

test("names are normalised: case, &/and, abbreviations, small words", () => {
  assert.equal(normName("The Int. J. of Advanced Research & Reviews"), normName("International Journal Advanced Research and Reviews"));
  assert.equal(normName("Académie"), "academie");
});

test("list matching: exact, one typo, and no match for real journals", () => {
  assert.equal(matchName("Academic Exchange Quarterly", I)?.how, "exact name");
  assert.equal(matchName("Academic Exchange Quaterly", I)?.name, "Academic Exchange Quarterly");
  for (const n of ["IEEE Access", "IEEE Transactions on Wireless Communications", "Sensors", "Nature Communications", "Physical Review Letters"])
    assert.equal(matchName(n, I), null, n);
});

test("hijacked clones are caught by host and the authentic site is not", () => {
  const h = matchHost("http://actabioethica.org/index.php/submit", I);
  assert.equal(h?.kind, "hijacked");
  assert.match(h.authenticUrl, /uchile\.cl/);
  assert.equal(matchHost("http://www.actabioethica.uchile.cl/index.php/AB/index", I), null);
});

test("ISSN check digit and extraction", () => {
  for (const s of ["2169-3536", "1536-1276", "1053-587X", "0378-5955"]) assert.ok(issnValid(s), s);
  assert.ok(!issnValid("2169-3537") && !issnValid("1536-1267"));
  assert.deepEqual(findIssns("Print ISSN: 1536-1276 · e-ISSN 2169-3536 · ISSN (Online): 2349-5163").map((x) => [x.issn, x.valid]),
    [["1536-1276", true], ["2169-3536", true], ["2349-5163", false]]);
});

test("page red flags on the synthetic fixture, none on the plain one", () => {
  const strip = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  const bad = pageFlags(strip("journal-flags.html")).map((f) => f.id).sort();
  assert.deepEqual(bad, ["all-subjects", "call-for-papers", "certificate", "fake-metric", "fast-publication", "free-mail", "pay-first", "scholar-indexing"]);
  assert.deepEqual(pageFlags(strip("journal-ok.html")), []);
});

test("profile signals and the verdict", () => {
  const good = { isOa: true, inDoaj: true, apcUsd: 2075, works: 114222, citedness2y: 8.1, publisher: "IEEE", h: 400, firstYear: 2012 };
  assert.deepEqual(profileSignals(good, 2026), []);
  const weak = { isOa: true, inDoaj: false, apcUsd: 150, works: 9000, citedness2y: 0.1, publisher: null, h: 3, firstYear: 2010 };
  assert.deepEqual(profileSignals(weak, 2026).map((s) => s.id), ["oa-not-doaj", "volume", "no-publisher", "low-h"]);
  assert.equal(verdict({}).level, "no-signals");
  assert.equal(verdict({ pageHits: [{ w: 3, label: "x" }, { w: 2, label: "y" }] }).level, "caution");
  assert.equal(verdict({ listHit: { kind: "journal", name: "X", how: "exact name" } }).level, "listed");
});
