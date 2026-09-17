# New agent playbook: seven questions before it replaces the old one

The rebuilt playbook is `docs/AGENTS.next.md`, on your outline. It is about 5,400 tokens, down from about 13,800. The old `AGENTS.md` is untouched. Every rule in the old file is accounted for in `docs/AGENTS.next.coverage.md` (217 rows: kept, merged, moved, or dropped with a reason). These are the calls the writer could not make alone. Answer on this page; one line each is plenty.

## 1. The size cut depends on one choice

Most of the cut came from not repeating the agent instructions that already ship inside every review's summary file. The new playbook says "read the instructions in the review file before you act" and points there, instead of restating them. That is the same rule you set for the install pointer. The risk: an agent that never opens the review file misses them.

Keep the pointer, or bring back a short checklist in the playbook?

**Ken decided (2026-09-16):** the rules for handling comments and writing replies are instructions, so they belong in the playbook and the skill, not in the drain. The drain carries as little as possible because it is repeated on every wake: the comments and what is needed to find their spot, nothing more. So the playbook gets a short checklist of the item and reply rules back, and the drain's own extra lines get trimmed in a follow-on.

## 2. The instructions inside every review file still say the old, broken thing for Claude Code

They still tell Claude Code agents to use a timer option that Claude Code removed on Sep 14. The new playbook gives the right instruction and says that one line in the review file is out of date. The instructions in the review file are locked on purpose and change only with care.

Ken folded this into the playbook swap: the locked text gets fixed in the same change, along with telling agents to read the review file once rather than on every wake. No answer needed here.

## 3. The keyboard shortcuts

Left out of the playbook. They are for you, not the agent, and `docs/CLI.md` already lists them. Fine to have none at all in the agent file?

## 4. Five statements about how handoff works were dropped

They described what the tool guarantees during a handoff, not anything the agent does. Gone, or keep them somewhere?

## 5. The end-of-review voice routine names your personal repo

The step where an agent looks at your hand edits and proposes voice rules points at a folder in your personal repo. This playbook ships to anyone who clones the tool. Move that part to a file only your setup reads, and leave a general rule here?

## 6. A few past incidents belong in the lessons folder

For example, why a page embedded inside another page gets no comment rail. The writer did not create lesson files. Write them, or let them go?

## 7. Swapping it in

When you approve, the new file replaces `AGENTS.md` at the repo root. The edits you made to the old file today are already in the new one (the writer started after them). Say go and I swap it, run the tests that check the docs, and push.
