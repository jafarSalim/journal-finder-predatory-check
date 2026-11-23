"""lists/*.csv (Stop Predatory Journals, MIT licence) → lists/lists.json for the extension."""
import csv, json, pathlib, html
D = pathlib.Path(__file__).resolve().parents[1] / "lists"
def rows(f):
    with open(D / f, newline="", encoding="utf-8") as fh:
        return [{k.strip(): html.unescape((v or "").strip()) for k, v in r.items() if k and k.strip()} for r in csv.DictReader(fh)]
J = [r for r in rows("journals.csv") if r.get("name")]
P = [r for r in rows("publishers.csv") if r.get("name")]
H = [r for r in rows("hijacked.csv") if r.get("hijacked")]
out = {"meta": {"source": "https://github.com/stop-predatory-journals/stop-predatory-journals.github.io (_data/*.csv, MIT licence)",
                "snapshot": "2026-11-23", "journals": len(J), "publishers": len(P), "hijacked": len(H)},
       "journals": J, "publishers": P, "hijacked": H}
(D / "lists.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(out["meta"])
