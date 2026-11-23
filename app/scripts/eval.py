#!/usr/bin/env python3
"""
Live evaluation of the pre-visit summary on the five sample patients.

It drives the running app over HTTP (so it tests exactly what users get), then
checks each summary:

  1. traps     every planted trap in test-data/<slug>/patient.json appears in a
               summary line (and whether M1 wrote it or the app's check added it)
  2. citations M1 wrote zero lines without a valid source (the "dropped" list is
               empty) and every cited quote is found in its source
  3. grounding a second M1 call (the judge) reads each line next to the sources
               it cites and marks any line that is not supported, or that gives
               a diagnosis, advice or a new plan
  4. forbid    patterns that must not appear (e.g. gendered pronouns when the
               chart has no sex recorded)
  5. cost and latency per summary

Usage (app running with live keys in .env.local):
    pip install certifi
    python3 scripts/eval.py --base http://localhost:3000
    python3 scripts/eval.py --only diabetes-ckd
    python3 scripts/eval.py --record-demo   # also save extractions for demo mode

Writes eval/results.json and eval/RESULTS.md. Costs about $0.35 per patient.
"""
import argparse
import http.cookiejar
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
TEST_DATA = APP / "test-data"
OUT = APP / "eval"

M1_IN = 1.50 / 1_000_000
M1_OUT = 4.60 / 1_000_000
TEXT_TO_JSON = 0.05


def load_env():
    env = {}
    p = APP / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    env.update({k: v for k, v in os.environ.items() if k.startswith("SULLY_")})
    return env


class App:
    def __init__(self, base, email, password):
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call("POST", "/api/auth/login", {"email": email, "password": password})

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def m1_judge(env, chart):
    """One M1 call: is each summary line supported by the sources it cites?"""
    import certifi

    sources = {s["id"]: s for s in chart["sources"]}
    lines = []
    for sec in chart["summary"]["result"]["sections"]:
        for b in sec["bullets"]:
            if b["by"] != "m1":
                continue
            lines.append({"n": len(lines) + 1, "section": sec["title"], "text": b["text"], "cites": [c["sourceId"] for c in b["cites"]]})
    used = sorted({c for l in lines for c in l["cites"]}, key=lambda x: int(x[1:]))
    docs = "\n\n".join(f'<source id="{i}" date="{sources[i]["date"]}" title="{sources[i]["title"]}">\n{sources[i]["text"]}\n</source>' for i in used if i in sources)
    system = (
        "You check a pre-visit chart summary against its sources. For each numbered line, decide:\n"
        "- supported: true if every fact in the line (names, numbers, dates, doses, statuses) is stated in or directly computable from the cited sources "
        "(a value sequence across sources, saying a value went up or down, or a plain paraphrase of what a source says, counts as supported). Questions in 'Worth asking today' are supported if the fact they ask about is in the sources.\n"
        "- advice: true if the line makes a diagnosis the sources do not state, recommends a treatment, dose or order, or proposes a new plan. Restating a plan from a source is not advice. Asking the patient a question is not advice.\n"
        "- problem: one short sentence on what is unsupported or advisory, else empty.\n"
        'Return JSON only: {"lines":[{"n":1,"supported":true,"advice":false,"problem":""}]}'
    )
    pt = chart["patient"]
    visit = f"Patient: {pt['name']}. Visit date: {pt.get('visitDate') or 'not given'}. Scheduled reason: {pt.get('visitReason') or 'not given'}."
    user = f"## Visit details (from scheduling, also a valid source)\n{visit}\n\n## Sources\n{docs}\n\n## Summary lines\n" + "\n".join(f'{l["n"]}. [{l["section"]}] {l["text"]} (cites {", ".join(l["cites"])})' for l in lines)
    body = {
        "model": "sully-m1",
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_completion_tokens": 4000,
        "reasoning_effort": "none",
    }
    base = env.get("SULLY_API_BASE_URL") or "https://api.sully.ai"
    req = urllib.request.Request(
        base.rstrip("/") + "/openai/v1/chat/completions",
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Account-Id": env["SULLY_ACCOUNT_ID"],
            "X-Api-Key": env["SULLY_API_KEY"],
            "User-Agent": "curl/8.7.1",  # Sully's edge rejects Python's default user agent
        },
    )
    ctx = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
        res = json.loads(r.read())
    content = res["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", content, re.S)
    verdicts = json.loads(m.group(0))["lines"] if m else []
    by_n = {v.get("n"): v for v in verdicts}
    out = []
    for l in lines:
        v = by_n.get(l["n"], {})
        out.append({**l, "supported": v.get("supported", None), "advice": v.get("advice", None), "problem": v.get("problem", "")})
    usage = res.get("usage", {})
    return out, usage


def check(manifest, chart):
    r = chart["summary"]["result"]
    bullets = [(s["key"], b) for s in r["sections"] for b in s["bullets"]]
    traps = []
    for t in manifest["traps"]:
        pats = [re.compile(p, re.I) for p in t["all"]]
        hits = [(k, b) for k, b in bullets if all(p.search(b["text"]) for p in pats)]
        by_m1 = [h for h in hits if h[1]["by"] == "m1"]
        traps.append({
            "id": t["id"],
            "surfaced": bool(hits),
            "by_m1": bool(by_m1),
            "sections": sorted({k for k, _ in hits}),
        })
    forbid = []
    for p in manifest.get("forbid", []):
        rx = re.compile(p, re.I)
        forbid += [b["text"] for _, b in bullets if rx.search(b["text"])]
    cites = [c for _, b in bullets for c in b["cites"]]
    return {
        "traps": traps,
        "dropped": r["dropped"],
        "added_by_app": r["addedByApp"],
        "lines": len(bullets),
        "quotes_found": sum(1 for c in cites if c["found"]),
        "quotes_total": len(cites),
        "forbid_hits": forbid,
        "words": sum(len(b["text"].split()) for _, b in bullets),
    }


def cost(chart):
    calls = [c for c in chart["calls"] if not c.get("demo") and c.get("ok")]
    t2j = [c for c in calls if "text-to-json" in c["path"]]
    m1 = [c for c in calls if "chat/completions" in c["path"]]
    tin = sum((c.get("usage") or {}).get("promptTokens", 0) for c in m1)
    tout = sum((c.get("usage") or {}).get("completionTokens", 0) for c in m1)
    return {
        "text_to_json_calls": len(t2j),
        "m1_calls": len(m1),
        "m1_tokens_in": tin,
        "m1_tokens_out": tout,
        "usd": round(len(t2j) * TEXT_TO_JSON + tin * M1_IN + tout * M1_OUT, 4),
        "extract_ms": [c["latencyMs"] for c in t2j],
        "summary_ms": [c["latencyMs"] for c in m1],
    }


def run_one(app, env, slug, judge=True, record=False):
    manifest = json.loads((TEST_DATA / slug / "patient.json").read_text())
    chart_id = app.call("POST", "/api/charts", {"sample": slug})["id"]
    t0 = time.time()
    app.call("POST", f"/api/charts/{chart_id}/summarize", {})
    while True:
        time.sleep(2)
        chart = app.call("GET", f"/api/charts/{chart_id}")["chart"]
        if chart["summary"]["status"] in ("done", "error"):
            break
        if time.time() - t0 > 400:
            raise RuntimeError(f"{slug}: timed out")
    wall = time.time() - t0
    if chart["summary"]["status"] == "error":
        return {"slug": slug, "chart_id": chart_id, "error": chart["summary"]["error"]}
    res = {"slug": slug, "chart_id": chart_id, "wall_s": round(wall, 1), **check(manifest, chart), "cost": cost(chart)}
    if judge:
        lines, usage = m1_judge(env, chart)
        res["judge"] = {
            "lines": len(lines),
            "unsupported": [l for l in lines if l["supported"] is False],
            "advice": [l for l in lines if l["advice"] is True],
            "unjudged": sum(1 for l in lines if l["supported"] is None),
            "usage": usage,
        }
    if record:
        rec = {s["extraction"]["textHash"]: s["extraction"]["data"] for s in chart["sources"] if s.get("extraction")}
        (TEST_DATA / slug / "demo-extractions.json").write_text(json.dumps(rec, indent=2) + "\n")
    return res


def passed(r):
    if "error" in r:
        return False
    ok = all(t["surfaced"] for t in r["traps"]) and not r["dropped"] and not r["forbid_hits"]
    if "judge" in r:
        ok = ok and not r["judge"]["unsupported"] and not r["judge"]["advice"] and not r["judge"]["unjudged"]
    return ok


def report(results):
    rows = []
    for r in results:
        if "error" in r:
            rows.append(f"| {r['slug']} | error: {r['error'].get('title')} | | | | | | |")
            continue
        traps = f"{sum(t['surfaced'] for t in r['traps'])}/{len(r['traps'])} ({sum(t['by_m1'] for t in r['traps'])} by M1)"
        j = r.get("judge", {})
        rows.append(
            f"| {r['slug']} | {traps} | {r['lines']} | {len(r['dropped'])} | {r['quotes_found']}/{r['quotes_total']} | "
            f"{len(j.get('unsupported', []))} / {len(j.get('advice', []))} | ${r['cost']['usd']:.3f} | {r['wall_s']} s | {'PASS' if passed(r) else 'FAIL'} |"
        )
    ok = [r for r in results if "error" not in r]
    avg_cost = sum(r["cost"]["usd"] for r in ok) / max(1, len(ok))
    avg_wall = sum(r["wall_s"] for r in ok) / max(1, len(ok))
    md = [
        f"# Eval results ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})",
        "",
        "| Patient | Traps surfaced | Lines | Uncited (dropped) | Quotes found | Judge: unsupported / advice | Cost | Time | Result |",
        "|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        f"Average cost per summary: ${avg_cost:.3f}. Average time: {avg_wall:.1f} s.",
    ]
    for r in ok:
        for l in r.get("judge", {}).get("unsupported", []) + r.get("judge", {}).get("advice", []):
            md.append(f"- {r['slug']} line {l['n']}: {l['text']} -> {l['problem']}")
        for t in r["traps"]:
            if not t["surfaced"]:
                md.append(f"- {r['slug']}: trap {t['id']} not surfaced")
        for f in r["forbid_hits"]:
            md.append(f"- {r['slug']}: forbidden pattern in: {f}")
    return "\n".join(md) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--email", default="dr.chen@example.com")
    ap.add_argument("--password", default="change-me")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--record-demo", action="store_true")
    args = ap.parse_args()

    env = load_env()
    if not args.no_judge and not env.get("SULLY_API_KEY"):
        sys.exit("Set SULLY_ACCOUNT_ID and SULLY_API_KEY in app/.env.local (the judge calls M1 directly).")
    app = App(args.base, args.email, args.password)
    slugs = args.only or sorted(p.name for p in TEST_DATA.iterdir() if (p / "patient.json").exists())
    results = []
    for slug in slugs:
        print(f"... {slug}", flush=True)
        results.append(run_one(app, env, slug, judge=not args.no_judge, record=args.record_demo))
    OUT.mkdir(exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    md = report(results)
    (OUT / "RESULTS.md").write_text(md)
    print(md)
    sys.exit(0 if all(passed(r) for r in results) else 1)


if __name__ == "__main__":
    main()
