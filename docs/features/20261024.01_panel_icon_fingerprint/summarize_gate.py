"""Read a gate log and save one classified row per browser test."""
from collections import Counter
import csv
import json
from pathlib import Path
import re
import sys

source = Path(sys.argv[1])
output = Path(sys.argv[2])
text = re.sub(r'\x1b\[[0-9;]*m', '', source.read_text())
rows = []
for line in text.splitlines():
    match = re.match(r'^\s*([✓✘×-])\s+\d+\s+\[(chromium|firefox|webkit)\] › (.*)', line)
    if match:
        symbol, browser, name = match.groups()
        status = {'✓': 'passed', '✘': 'failed', '×': 'failed', '-': 'skipped'}[symbol]
        rows.append({'browser': browser, 'status': status, 'test': name})
with output.open('w') as stream:
    writer = csv.DictWriter(stream, fieldnames=['browser', 'status', 'test'], delimiter='\t')
    writer.writeheader()
    writer.writerows(rows)
summary = {
    'source': str(source),
    'rows': str(output),
    'by_status': dict(Counter(row['status'] for row in rows)),
    'by_browser': dict(Counter(row['browser'] for row in rows)),
    'reported_summaries': re.findall(r'^\s*\d+ (?:passed|failed|skipped).*$', text, re.MULTILINE),
}
print(json.dumps(summary, indent=2))
