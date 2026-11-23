import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { keywords, buildQuery, suggest, urls, findJournals, profile } from "../src/finder.js";
import { replayFetch, missing } from "../bench/replay.js";

test("keywords: title words weigh more, filler words are dropped, acronyms kept", () => {
  const k = keywords("Deep Learning Channel Estimation for OFDM", "We propose a novel approach. The channel is estimated with a network.");
  assert.deepEqual(k.slice(0, 3), ["channel", "deep", "learning"]);  // "channel" also appears in the abstract
  assert.ok(k.includes("ofdm") && !k.includes("propose") && !k.includes("novel"));
});

test("query keeps the order of the text and stays short", () => {
  const q = buildQuery("Energy and Spectral Efficiency of Very Large Multiuser MIMO Systems");
  assert.equal(q, "energy spectral efficiency multiuser mimo systems");
  assert.ok(buildQuery("x ".repeat(5) + "word ".repeat(200) + "a b c d e f g h i j k l m n o p").length <= 80);
});

test("votes: closer papers weigh more, repositories and the excluded paper do not vote", () => {
  const W = (id, s, type = "journal") => ({ id, publication_year: 2020, primary_location: { source: { id: s, display_name: s, type } } });
  const res = [W("W0", "Self"), W("W1", "A"), W("W2", "B"), W("W3", "B"), W("W4", "arXiv", "repository")];
  const v = suggest(res, { exclude: ["W0"] });
  assert.deepEqual(v.map((x) => x.id), ["B", "A"]);
  assert.ok(Math.abs(v.reduce((s, x) => s + x.share, 0) - 1) < 1e-12);
});

test("the example abstract end to end on recorded answers", async () => {
  const ex = JSON.parse(fs.readFileSync(new URL("../examples/abstract.json", import.meta.url)));
  const r = await findJournals(ex.title, ex.abstract, { fetchJson: replayFetch });
  assert.equal(missing.length, 0, missing.join("\n"));
  assert.equal(r.calls.length, 7);
  assert.equal(r.venues[0].name, "IEEE Access");
  assert.equal(r.venues[0].profile.inDoaj, true);
  assert.ok(urls.similar("a b").includes("search=a%20b"));
  assert.equal(profile({ error: "x" }), null);
});
