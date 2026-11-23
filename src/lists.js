// The bundled Stop Predatory Journals snapshot, indexed once per page
import { indexLists } from "./check.js";
let cache = null;
export async function lists() {
  if (!cache) cache = fetch(chrome.runtime.getURL("lists/lists.json")).then((r) => r.json()).then(indexLists);
  return cache;
}
export async function fetchJson(url) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url);
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 700 * (a + 1))); continue; }
    if (r.status === 404) return { error: "not found" };
    if (!r.ok) throw new Error(`OpenAlex answered HTTP ${r.status}`);
    return r.json();
  }
  throw new Error("OpenAlex is rate-limiting; try again in a minute");
}
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const fmt = (x, d = 0) => (x == null ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
