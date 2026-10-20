"""Split the per-reference rows from measure_site.js into counts.

Usage: python3 summarize.py refs.csv
Prints counts by attribute, kind and existence, and samples of missing rows.
"""
import sys
import pandas as pd

df = pd.read_csv(sys.argv[1])
df["exists"] = df["exists"].astype(str).str.lower() == "true"
packaged = df["rel"].str.contains(r"(?:^|/)\.lahe-fonts/|lahe-doc-style|mermaid", regex=True)
df["packaged"] = packaged
print("rows:", len(df))
print("\nby attr x exists (packaged files excluded):")
print(df[~packaged].groupby(["attr", "exists"]).size())
print("\npackaged (served by Lahe itself, not the mount):", int(packaged.sum()))
print("\nexisting by kind:")
print(df[df["exists"]].groupby("kind").size())
miss = df[(~df["exists"]) & (~packaged)]
print("\nmissing, not packaged:", len(miss))
print(miss[["attr", "rel", "from"]].head(25).to_string())
print("\nexisting images/assets/other:")
print(df[df["exists"] & df["kind"].isin(["image", "asset", "other", "html"])][["attr", "kind", "rel", "from"]].to_string())
