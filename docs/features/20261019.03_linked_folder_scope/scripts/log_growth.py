"""Upper bound on sites.log growth if the linked-file list lived in sites.json.

A full crawl renders every page once, in the order measure_site.js did. Each
render that adds at least one new file appends the site's whole entry to
sites.log (sites.js record()). The entry is today's size plus the list so far.

Usage: python3 log_growth.py refs.csv base_entry_bytes
"""
import json
import sys
import pandas as pd

df = pd.read_csv(sys.argv[1])
base = int(sys.argv[2])
df["exists"] = df["exists"].astype(str).str.lower() == "true"
df = df[df["exists"]]
df["real"] = df["mount_dir"].astype(str) + "/" + df["rel"].astype(str)
seen = set()
list_bytes = 0
lines = 0
total = 0
for page, group in df.groupby("from", sort=False):
    new = [r for r in group["real"] if r not in seen]
    if not new:
        continue
    for r in new:
        seen.add(r)
        list_bytes += len(json.dumps(r)) + 1
    lines += 1
    total += base + list_bytes
print(json.dumps({
    "files_in_list": len(seen),
    "list_bytes": list_bytes,
    "renders_that_add": lines,
    "log_bytes_added_full_crawl": total,
}, indent=2))
