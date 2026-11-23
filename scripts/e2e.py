"""End-to-end test in real Chromium with the unpacked extension.

* The journal finder runs on the example abstract (examples/abstract.json).
* The predatory check reads three test pages written for this repository (test/fixtures): a
  plain journal-information page, an invented journal full of warning signs, and a page served
  under a web host that the Stop Predatory Journals list records as a hijacked clone.
* Every request to api.openalex.org is answered by Playwright from bench/fixtures (the recorded
  answers); an unrecorded request fails the test. The hijacked host is answered by Playwright too,
  so no real site is contacted.
* The test copy of the extension adds host permissions for the test hosts, because activeTab
  needs a real click on the toolbar button.

    xvfb-run -a python3 scripts/e2e.py
"""
import functools
import hashlib
import http.server
import json
import pathlib
import shutil
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
FRAMES = OUT / "frames"
shutil.rmtree(FRAMES, ignore_errors=True)
FRAMES.mkdir(parents=True)
FIX = ROOT / "bench" / "fixtures"
CHECKS, SERVED, UNKNOWN = [], [], []
HIJACKED_HOST = "actabioethica.org"


def check(name, ok, detail=""):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def handle(route):
    url = route.request.url
    f = FIX / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json")
    if not f.exists():
        UNKNOWN.append(url)
        route.fulfill(status=500, body="not recorded")
        return
    SERVED.append(url)
    body = json.loads(f.read_text())["body"]
    route.fulfill(status=404 if body.get("error") else 200, content_type="application/json", body=json.dumps(body))


n = 0


def frame(page, name=None, hold=1, full=False):
    global n
    page.wait_for_timeout(150)
    png = page.screenshot()
    for _ in range(hold):
        (FRAMES / f"f{n:03d}.png").write_bytes(png)
        n += 1
    if name:
        (OUT / f"shot_{name}.png").write_bytes(page.screenshot(full_page=full) if full else png)


def wait(page, expr, tries=100):
    for _ in range(tries):
        if page.evaluate(expr):
            return True
        page.wait_for_timeout(100)
    return False


def open_check(ctx, sw, url_prefix):
    with ctx.expect_page() as info:
        sw.evaluate("""async (u) => { const [tab] = await chrome.tabs.query({ url: u + '*' });
                       await globalThis.__openCheck(tab.id); }""", url_prefix)
    pg = info.value
    wait(pg, "!!(window.__jc && window.__jc.ready)")
    return pg


def main():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "test" / "fixtures"))
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    ext = pathlib.Path(tempfile.mkdtemp(prefix="jf-"))
    for item in ["manifest.json", "background.js", "popup.html", "finder.html", "check.html", "src", "icons", "lists", "examples"]:
        s = ROOT / item
        (shutil.copytree if s.is_dir() else shutil.copy)(s, ext / item)
    m = json.loads((ext / "manifest.json").read_text())
    m["host_permissions"] += ["http://127.0.0.1/*", f"http://{HIJACKED_HOST}/*"]
    (ext / "manifest.json").write_text(json.dumps(m))
    hijacked_html = (ROOT / "test" / "fixtures" / "hijacked.html").read_text()
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=False, viewport={"width": 1280, "height": 860},
                                                   args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"])
        ctx.route("https://api.openalex.org/**", handle)
        ctx.route(f"http://{HIJACKED_HOST}/**", lambda r: r.fulfill(status=200, content_type="text/html", body=hijacked_html))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        check("service worker started", sw.url.startswith("chrome-extension://"))
        eid = sw.url.split("/")[2]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # ---- popup (opened as a page for the picture)
        page.set_viewport_size({"width": 372, "height": 330})
        page.goto(f"chrome-extension://{eid}/popup.html")
        frame(page, "popup")
        page.set_viewport_size({"width": 1280, "height": 860})

        # ---- journal finder
        page.goto(f"chrome-extension://{eid}/finder.html?demo=1")
        wait(page, "document.getElementById('abs').value.length > 100")
        frame(page, hold=5)
        page.click("#go")
        ok = wait(page, "!!(window.__jf && window.__jf.ready)")
        frame(page, hold=2)
        r = page.evaluate("({q: __jf.result.query, calls: __jf.result.calls.length, v: __jf.result.venues.map(v => [v.name, !!v.profile])})")
        check("the finder builds its search from the abstract", ok and r["q"] == "deep learning channel estimation ofdm systems impulsive noise", r["q"])
        check("one search + six journal profiles = 7 requests", r["calls"] == 7, str(r["calls"]))
        check("IEEE Access comes first for the example abstract", r["v"][0][0] == "IEEE Access", " ; ".join(v[0] for v in r["v"][:4]))
        check("the top six journals carry an OpenAlex profile", all(v[1] for v in r["v"][:6]))
        check("journal cards are drawn with metrics", page.locator(".j").count() == len(r["v"]) and page.locator(".j .chip.plum").count() >= 6,
              f"{page.locator('.j').count()} cards")
        frame(page, "finder", hold=4)
        for y in (300, 600, 900):
            page.mouse.wheel(0, 300)
            frame(page, hold=2)
        page.screenshot(path=str(OUT / "shot_finder_full.png"), full_page=True)
        page.mouse.wheel(0, -2000)

        # ---- check a suggested journal (from its card)
        page.click(".j >> nth=0 >> a.check")
        wait(page, "!!(window.__jc && window.__jc.ready)")
        lvl = page.evaluate("__jc.report.verdict.level")
        check("checking IEEE Access from the finder: no warning signs", lvl == "no-signals", lvl)
        frame(page, "check_source", hold=4)

        # ---- the plain journal page
        jp = ctx.new_page()
        jp.goto(base + "journal-ok.html")
        frame(jp, hold=2)
        rep = open_check(ctx, sw, base + "journal-ok.html")
        R = rep.evaluate("({l: __jc.report.verdict.level, i: __jc.report.issns, p: __jc.report.profile && __jc.report.profile.name})")
        check("plain journal page: ISSN found, valid, looked up in OpenAlex", R["i"] == [{"issn": "2169-3536", "valid": True}] and R["p"] == "IEEE Access", str(R["i"]))
        check("plain journal page: no warning signs", R["l"] == "no-signals", R["l"])
        frame(rep, "check_ok", hold=4)

        # ---- the invented journal with warning signs
        fp = ctx.new_page()
        fp.goto(base + "journal-flags.html")
        frame(fp, hold=3)
        rep2 = open_check(ctx, sw, base + "journal-flags.html")
        R2 = rep2.evaluate("({l: __jc.report.verdict.level, s: __jc.report.verdict.score, r: __jc.report.verdict.reasons.map(r => r.label), i: __jc.report.issns})")
        check("invented journal: 'several warning signs'", R2["l"] == "caution", f"score {R2['s']}")
        check("invented journal: all 8 page red flags and the bad ISSN check digit reported",
              len(R2["r"]) == 9 and any("check digit" in x for x in R2["r"]), f"{len(R2['r'])} reasons")
        check("invented journal: the invalid ISSN is not sent to OpenAlex", not any("2349-5163" in u for u in SERVED + UNKNOWN))
        frame(rep2, "check_flags", hold=5)
        rep2.screenshot(path=str(OUT / "shot_check_flags_full.png"), full_page=True)

        # ---- a hijacked clone's web host
        hp = ctx.new_page()
        hp.goto(f"http://{HIJACKED_HOST}/")
        frame(hp, hold=2)
        rep3 = open_check(ctx, sw, f"http://{HIJACKED_HOST}/")
        R3 = rep3.evaluate("({l: __jc.report.verdict.level, k: __jc.report.listHit && __jc.report.listHit.kind, a: __jc.report.listHit && __jc.report.listHit.authenticUrl})")
        check("hijacked host: flagged as a hijacked copy, with the authentic site", R3["l"] == "listed" and R3["k"] == "hijacked" and "uchile.cl" in (R3["a"] or ""), str(R3))
        frame(rep3, "check_hijacked", hold=5)

        # ---- typed checks: a listed name with a typo, an ISSN
        rep3.fill("#what", "Academic Exchange Quaterly")
        rep3.click("#go")
        rep3.wait_for_timeout(300)
        R4 = rep3.evaluate("({l: __jc.report.verdict.level, h: __jc.report.listHit && __jc.report.listHit.how})")
        check("a listed journal name typed with a typo is still found", R4["l"] == "listed" and R4["h"] == "near-identical name", str(R4))
        frame(rep3, "check_name", hold=4)
        rep3.fill("#what", "2169-3536")
        rep3.click("#go")
        rep3.wait_for_timeout(400)
        check("a typed ISSN is looked up in OpenAlex", rep3.evaluate("__jc.report.profile && __jc.report.profile.name") == "IEEE Access")

        # ---- right-click → finder with the selected text
        with ctx.expect_page() as info:
            sw.evaluate("globalThis.__openFinder('Free-space optical links under atmospheric turbulence and pointing errors')")
        fpage = info.value
        wait(fpage, "document.getElementById('abs').value.length > 10")
        check("selected text arrives in the finder", "turbulence" in fpage.evaluate("document.getElementById('abs').value"))
        check("every OpenAlex request was answered from the recordings", not UNKNOWN, f"{len(SERVED)} served, {len(UNKNOWN)} unknown")
        ctx.close()
    srv.shutdown()
    (OUT / "e2e.json").write_text(json.dumps(CHECKS, indent=1))
    print(f"{sum(c['ok'] for c in CHECKS)}/{len(CHECKS)} checks passed")


if __name__ == "__main__":
    main()
