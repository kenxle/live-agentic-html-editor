# Read-only: count reviews with an open agent question (ready item whose reply is a question).
import json, os, glob, datetime
base = os.path.expanduser("~/.local/state/lahe/reviews")
rows = []
for f in glob.glob(base + "/*/review.json"):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    q = 0; newest = None
    for p in d.get("pages", []):
        for it in p.get("items", []):
            r = it.get("reply") or {}
            if it.get("state") == "ready" and r.get("status") == "question":
                q += 1
                newest = max(newest or "", r.get("at") or "")
    if q:
        rows.append((newest, q, os.path.basename(os.path.dirname(f))))
rows.sort(reverse=True)
print("reviews with an open agent question:", len(rows))
print("open questions total:", sum(r[1] for r in rows))
now = datetime.datetime.now(datetime.timezone.utc)
for days in (1, 7, 30):
    cut = (now - datetime.timedelta(days=days)).isoformat()
    print(f"  with newest question in last {days} days:", sum(1 for r in rows if r[0] >= cut))
