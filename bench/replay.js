// Recorded API responses: bench/fixtures/<sha1 of URL>.json = {url, recorded, body}.
// replayFetch(url) returns the recorded body; a URL that was never recorded is listed in
// `missing` and answered with an empty result, so a run can show which calls are still needed.
import fs from "node:fs";
import crypto from "node:crypto";
const DIR = new URL("./fixtures/", import.meta.url);
export const keyOf = (url) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
export const missing = [];
export async function replayFetch(url) {
  const f = new URL(keyOf(url) + ".json", DIR);
  if (!fs.existsSync(f)) { missing.push(url); return url.includes("crossref") ? { message: { items: [] } } : { results: [] }; }
  return JSON.parse(fs.readFileSync(f)).body;
}
export function record(url, body, recorded = "2026-11-23") {
  fs.writeFileSync(new URL(keyOf(url) + ".json", DIR), JSON.stringify({ url, recorded, body }, null, 1));
}
