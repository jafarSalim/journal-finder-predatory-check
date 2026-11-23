"""results/*.json → assets/fig_*.png (paper-and-ink palette)."""
import json, pathlib, subprocess
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = pathlib.Path(__file__).resolve().parents[1]
S = json.loads((R / "results" / "summary.json").read_text())
F = json.loads((R / "results" / "finder.json").read_text())
A = R / "assets"; A.mkdir(exist_ok=True)
PAPER, INK, MUTED, LINE = "#fff8ec", "#1d2433", "#6b7280", "#eadfca"
TEAL, CORAL, MUSTARD, PLUM, SKY, RED, GREEN = "#0f9d8a", "#ff6b4a", "#f2b705", "#7c3aed", "#2f80ed", "#e5383b", "#16a34a"
plt.rcParams.update({"figure.facecolor": PAPER, "axes.facecolor": "#fffdf8", "axes.edgecolor": LINE, "axes.labelcolor": INK,
                     "xtick.color": INK, "ytick.color": INK, "text.color": INK, "font.size": 11, "axes.titleweight": "bold",
                     "axes.titlesize": 13, "axes.spines.top": False, "axes.spines.right": False, "font.family": "DejaVu Sans"})

# 1. finder: hit@k per method + rank of the true journal per paper
M = S["finder"]["methods"]
names = list(M)
fig, ax = plt.subplots(1, 2, figsize=(13.5, 4.8), gridspec_kw={"width_ratios": [1.15, 1]})
ks = ["hit1", "hit3", "hit5", "hit10"]; lab = ["top 1", "top 3", "top 5", "top 10"]
cols = [TEAL, SKY, PLUM, MUTED]
w = 0.2
for i, (m, c) in enumerate(zip(names, cols)):
    vals = [M[m][k] for k in ks]
    b = ax[0].bar([x + (i - 1.5) * w for x in range(4)], vals, w, color=c, label=f"{m} (MRR {M[m]['mrr']:.2f})")
    for x, v in zip(range(4), vals):
        ax[0].text(x + (i - 1.5) * w, v + 0.3, str(v), ha="center", fontsize=8.5, color=c, fontweight="bold")
ax[0].set_xticks(range(4), lab); ax[0].set_ylim(0, 24.5); ax[0].set_ylabel(f"papers (of {M[names[0]]['n']}) whose journal is listed")
ax[0].axhline(M[names[0]]["n"], color=LINE, lw=1, ls="--")
ax[0].legend(frameon=False, fontsize=9, loc="upper left"); ax[0].set_title("Is the paper's real journal in the suggestions? (title only)")
rk = [(r["ranks"]["rank"] or 25, r["ranks"]["popularity"] or 25, r["title"]) for r in F]
order = sorted(range(len(rk)), key=lambda i: rk[i][0])
for j, i in enumerate(order):
    a, b, t = rk[i]
    ax[1].plot([b, a], [j, j], color=LINE, lw=2, zorder=1)
    ax[1].scatter([b], [j], color=MUTED, s=28, zorder=2)
    ax[1].scatter([a], [j], color=TEAL if a <= 5 else (MUSTARD if a <= 10 else CORAL), s=46, zorder=3, edgecolor="white")
ax[1].set_yticks(range(len(order)), [rk[i][2][:38] + ("…" if len(rk[i][2]) > 38 else "") for i in order], fontsize=7.5)
ax[1].invert_yaxis(); ax[1].set_xscale("log"); ax[1].set_xticks([1, 2, 3, 5, 10, 25], ["1", "2", "3", "5", "10", "not\nlisted"])
ax[1].set_xlabel("rank of the real journal (log scale)")
from matplotlib.lines import Line2D
ax[1].legend(handles=[Line2D([], [], marker="o", ls="", color=TEAL, label="finder: top 5"), Line2D([], [], marker="o", ls="", color=MUSTARD, label="finder: 6-10"),
  Line2D([], [], marker="o", ls="", color=CORAL, label="finder: below 10"), Line2D([], [], marker="o", ls="", color=MUTED, label="popularity baseline")],
  frameon=False, fontsize=8, loc="lower right")
ax[1].set_title("Per paper")
fig.tight_layout(); fig.savefig(A / "fig_finder.png", dpi=150); plt.close(fig)

# 2. lists: robustness, real names, hijacked
L = S["lists"]
P = {k: v for k, v in L["perturbations"].items() if isinstance(v, dict)}
fig, ax = plt.subplots(1, 3, figsize=(14.5, 4.6), gridspec_kw={"width_ratios": [1.5, 1, 1]})
ks = list(P); vals = [100 * P[k]["found"] / P[k]["tried"] for k in ks]
ax[0].barh(ks, vals, color=[TEAL if v > 99.5 else MUSTARD for v in vals])
for i, k in enumerate(ks):
    ax[0].text(vals[i] - 1, i, f"{P[k]['found']}/{P[k]['tried']}" + (f" · {P[k]['wrong']} wrong" if P[k]["wrong"] else " · 0 wrong"), va="center", ha="right", color="white", fontsize=9, fontweight="bold")
ax[0].set_xlim(0, 100); ax[0].invert_yaxis(); ax[0].set_xlabel("% of listed journal names still found")
ax[0].set_title(f"Typing the {P[ks[0]]['tried']:,} listed names differently")
rn = L["realNames"]
ax[1].bar(["not on\nthe list", "on the list\n(name match)"], [rn["distinct"] - rn["onList"], rn["onList"]], color=[GREEN, RED], width=0.6)
for x, v in enumerate([rn["distinct"] - rn["onList"], rn["onList"]]):
    ax[1].text(x, v + 2, str(v), ha="center", fontweight="bold")
ax[1].set_title(f"{rn['distinct']} real journal names\nreturned by OpenAlex in the benchmark"); ax[1].set_ylim(0, rn["distinct"] * 1.12)
hj = L["hijacked"]
ax[2].bar(["clone hosts\nflagged", "authentic hosts\nleft alone"], [100 * hj["flagged"] / hj["clones"], 100 * hj["notFlagged"] / hj["authentic"]], color=[CORAL, TEAL], width=0.6)
ax[2].text(0, 101, f"{hj['flagged']}/{hj['clones']}", ha="center", fontweight="bold"); ax[2].text(1, 101, f"{hj['notFlagged']}/{hj['authentic']}", ha="center", fontweight="bold")
ax[2].set_ylim(0, 112); ax[2].set_ylabel("%"); ax[2].set_title("Hijacked-journal list")
fig.tight_layout(); fig.savefig(A / "fig_lists.png", dpi=150); plt.close(fig)

# 3. the example abstract: vote shares and the six profiles
out = subprocess.run(["node", "-e", """
import('./src/finder.js').then(async m => { const {replayFetch} = await import('./bench/replay.js');
 const e = JSON.parse(require('fs').readFileSync('examples/abstract.json'));
 const r = await m.findJournals(e.title, e.abstract, {fetchJson: replayFetch});
 console.log(JSON.stringify(r.venues.map(v => ({n: v.name, s: v.share, k: v.papers, p: v.profile})))) })"""], cwd=R, capture_output=True, text=True, check=True)
V = json.loads(out.stdout)
fig, ax = plt.subplots(1, 2, figsize=(15, 5), gridspec_kw={"width_ratios": [1.15, 1]})
ax[0].barh([v["n"] for v in V], [100 * v["s"] for v in V], color=[TEAL if v.get("p") else LINE for v in V])
for i, v in enumerate(V):
    ax[0].text(100 * v["s"] + 0.4, i, f"{v['k']} paper{'s' if v['k'] > 1 else ''}", va="center", fontsize=9, color=MUTED)
ax[0].invert_yaxis(); ax[0].set_xlabel("% of the vote of the 50 most similar papers"); ax[0].set_title("Example abstract: suggested journals")
pp = [v for v in V if v.get("p")]
for v in pp:
    p = v["p"]
    c = TEAL if p["inDoaj"] else (SKY if not p["isOa"] else MUSTARD)
    ax[1].scatter(p["h"], p["citedness2y"], s=40 + p["works"] / 250, color=c, alpha=.85, edgecolor="white", lw=1.5)
    off = (6, -14) if v["n"].startswith("Annals") else (-8, 6) if p["h"] > 300 else (6, 4)
    ax[1].annotate(v["n"], (p["h"], p["citedness2y"]), xytext=off, textcoords="offset points", fontsize=8.5, ha="right" if p["h"] > 300 else "left")
ax[1].set_xlabel("h-index (OpenAlex)"); ax[1].set_ylabel("2-year mean citations")
ax[1].set_title("Their OpenAlex profiles\n(dot size = number of papers)")
from matplotlib.lines import Line2D as L2
ax[1].legend(handles=[L2([], [], marker="o", ls="", color=TEAL, label="open access, in DOAJ"), L2([], [], marker="o", ls="", color=SKY, label="subscription / hybrid"),
  L2([], [], marker="o", ls="", color=MUSTARD, label="open access, not in DOAJ (per OpenAlex)")], frameon=False, fontsize=8.5, loc="upper left")
ax[1].set_xlim(0, 430); ax[1].set_ylim(0, 9.6)
fig.tight_layout(); fig.savefig(A / "fig_example.png", dpi=150); plt.close(fig)

# 4. ISSN check digit
I = S["issn"]
fig, ax = plt.subplots(figsize=(6.2, 3.4))
ax.bar(["single wrong digit", "two neighbours swapped"], [I["singleErrors"], I["transpositions"]], color=LINE, width=.55, label="errors made")
ax.bar(["single wrong digit", "two neighbours swapped"], [I["singleCaught"], I["transpositionsCaught"]], color=CORAL, width=.35, label="caught by the check digit")
for x, (a, b) in enumerate([(I["singleCaught"], I["singleErrors"]), (I["transpositionsCaught"], I["transpositions"])]):
    ax.text(x, b * 1.02, f"{a}/{b}", ha="center", fontweight="bold")
ax.set_yscale("log"); ax.set_ylim(10, 3000); ax.legend(frameon=False, fontsize=9); ax.set_title(f"ISSN typos on {I['valid']} real ISSNs")
fig.tight_layout(); fig.savefig(A / "fig_issn.png", dpi=150); plt.close(fig)
print("figures written")
