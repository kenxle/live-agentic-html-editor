"""Linked HTML pages under mounts, what they reference, and the src images.

Usage: python3 html_detail.py refs.csv [refs2.csv ...]
"""
import sys
import pandas as pd

df = pd.concat([pd.read_csv(p) for p in sys.argv[1:]], ignore_index=True)
df["exists"] = df["exists"].astype(str).str.lower() == "true"
packaged = df["rel"].astype(str).str.contains(r"(?:^|/)\.lahe-fonts/|lahe-doc-style|mermaid", regex=True)
real = df[~packaged]
print("linked HTML pages under mounts:")
print(real[real["kind"] == "html"][["site", "mount_dir", "rel", "exists", "from"]].to_string())
print("\nreferences made BY a linked HTML page or its CSS:")
by_html = real[real["from"].astype(str).str.contains(r"\.(?:html|css)$", regex=True)]
print(by_html[["site", "attr", "kind", "rel", "exists", "from"]].to_string() if len(by_html) else "(none)")
print("\nimages a rendered page shows (src) under a mount:")
print(real[real["attr"] == "src"][["site", "rel", "exists", "from"]].to_string())
print("\ndistinct existing files under mounts, both sites together:",
      real[real["exists"]].drop_duplicates(["mount_dir", "rel"]).shape[0])
