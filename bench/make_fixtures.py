"""bench/recorded/*.md → bench/fixtures/<sha1(url)[:16]>.json

similar.md : answers to /works?search=…&per_page=50&select=id,display_name,publication_year,primary_location
sources.md : answers to /sources/S… and /sources/issn:… (transcribed fields)
Only the transcribed fields are present; titles of the neighbours were not transcribed."""
import hashlib, json, pathlib, re
from urllib.parse import quote
B = pathlib.Path(__file__).resolve().parent
OA = "https://api.openalex.org"
SEL = "id,display_name,publication_year,primary_location"
FIX = B / "fixtures"; FIX.mkdir(exist_ok=True)

def save(url, body):
    (FIX / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json")).write_text(json.dumps({"url": url, "recorded": "2026-11-23", "body": body}, ensure_ascii=False, indent=1))

def similar_url(q, n=50):
    return f"{OA}/works?search={quote(q, safe='')}&per_page={n}&select={SEL}"

n = 0
txt = (B / "recorded" / "similar.md").read_text() + "\n" + (B / "recorded" / "example.md").read_text()
for blk in txt.split("\n## ")[1:]:
    head, *lines = blk.strip().split("\n")
    wid, q = [x.strip() for x in head.split("|", 1)]
    count = int(lines[0].split(":")[1])
    names = {}
    for l in lines:
        if l.startswith("sources:"):
            for part in l[len("sources:"):].split("; "):
                k, v = part.strip().split("=", 1)
                names[k] = v
    res = []
    for l in lines[1:]:
        if not re.match(r"^W\d+\|", l): continue
        w, y, s, t, *title = l.split("|")
        src = None if s == "-" else {"id": f"https://openalex.org/{s}", "display_name": names.get(s, s), "type": t}
        res.append({"id": f"https://openalex.org/{w}", "display_name": "|".join(title) or None, "publication_year": int(y) if y.isdigit() else None,
                    "primary_location": {"source": src}})
    save(similar_url(q), {"meta": {"count": count, "per_page": 50}, "results": res, "query_of": wid})
    n += 1

srcf = B / "recorded" / "sources.md"
if srcf.exists():
    for blk in srcf.read_text().split("\n## ")[1:]:
        head, *lines = blk.strip().split("\n")
        path = head.strip()
        f = {}
        for l in lines:
            if ":" in l and not l.startswith("#"):
                k, v = l.split(":", 1); f[k.strip()] = v.strip()
        if f.get("error"):
            save(OA + path, {"error": f["error"]}); n += 1; continue
        num = lambda k: None if f.get(k, "null") in ("null", "", "-") else float(f[k])
        boo = lambda k: {"true": True, "false": False}.get(f.get(k, "").lower())
        body = {"id": f"https://openalex.org/{f['id']}", "display_name": f["display_name"], "issn_l": f.get("issn_l") or None,
                "issn": [x.strip() for x in f.get("issn", "").split(",") if x.strip()], "type": f.get("type", "journal"),
                "host_organization_name": None if f.get("publisher") in (None, "null", "-", "") else f["publisher"],
                "homepage_url": None if f.get("homepage_url") in (None, "null", "-", "") else f["homepage_url"],
                "works_count": int(num("works_count") or 0), "cited_by_count": int(num("cited_by_count") or 0),
                "is_oa": boo("is_oa"), "is_in_doaj": boo("is_in_doaj"),
                "apc_usd": None if num("apc_usd") is None else int(num("apc_usd")), "country_code": f.get("country_code") or None,
                "summary_stats": {"h_index": num("h_index"), "i10_index": num("i10_index"), "2yr_mean_citedness": num("2yr_mean_citedness")},
                "counts_by_year": [{"year": int(f["first_year_in_counts"])}] if f.get("first_year_in_counts", "").isdigit() else []}
        save(OA + path, body); n += 1
print(n, "fixtures")
