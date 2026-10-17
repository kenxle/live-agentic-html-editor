#!/usr/bin/env python3
"""Rebuild the lesson queue with a choice group under every lesson (plan Task 4.3).

Reads a lesson-queue Markdown page of the shape the lessons skill writes: a
`### <lesson title>` heading, a paragraph or two, a line starting with
`**Recommend: promote.**` or `**Recommend: discard.**` (or merge), and a
`[The proposal](...)` link. After each lesson's recommendation line it inserts
one choice group named from the proposal file's slug, with the recommended
answer marked. Everything else in the page is left exactly as it was.

Usage:
  python3 add_choice_groups.py <in.md> <out.md>

It writes only <out.md>. Nothing is deleted. A group already present under a
lesson (a `data-choice` naming the same slug) is left alone, so the script can
run twice.
"""
import re
import sys

REC = re.compile(r"^\*\*Recommend: (promote|discard|merge)\.\*\*", re.I)
PROPOSAL = re.compile(r"^\[The proposal\]\(\.\./\.\./lessons/proposed/([a-z0-9-]+)\.md\)")
HEADING = re.compile(r"^### ")


def group(slug, recommended):
    name = ("lesson-" + slug)[:32].rstrip("-")
    answers = ["promote", "discard", "merge"]
    labels = {"promote": "Promote", "discard": "Discard", "merge": "Merge"}
    lines = ['<div class="choice" data-choice="%s">' % name,
             '  <p class="choice-q">What should happen to this lesson?</p>']
    for a in answers:
        rec = " data-recommended" if a == recommended else ""
        lines.append('  <button type="button" value="%s"%s>%s</button>' % (a, rec, labels[a]))
    lines.append("</div>")
    return "\n".join(lines)


def main(src, dst):
    text = open(src, encoding="utf-8").read()
    lines = text.split("\n")
    out = []
    i = 0
    n = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = HEADING.match(line)
        if m:
            # Walk this lesson's block: find its recommendation and its proposal slug,
            # and whether a group is already there.
            j = i + 1
            rec = None
            slug = None
            has_group = False
            end = j
            while end < len(lines) and not HEADING.match(lines[end]) and not lines[end].startswith("## "):
                r = REC.match(lines[end])
                if r and rec is None:
                    rec = r.group(1).lower()
                p = PROPOSAL.match(lines[end])
                if p:
                    slug = p.group(1)
                if 'data-choice="' in lines[end]:
                    has_group = True
                end += 1
            block = lines[j:end]
            if slug and not has_group:
                # Insert the group right after the proposal link line, which closes
                # each lesson, so the block reads: title, body, recommendation, link, buttons.
                new_block = []
                for b in block:
                    new_block.append(b)
                    if PROPOSAL.match(b):
                        new_block.append("")
                        new_block.append(group(slug, rec))
                        n += 1
                out.extend(new_block)
            else:
                out.extend(block)
            i = end
            continue
        i += 1
    open(dst, "w", encoding="utf-8").write("\n".join(out))
    print("groups added:", n, "->", dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
