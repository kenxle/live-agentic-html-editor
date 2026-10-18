# Review log: r7ce589aaa9c4

**Pages reviewed:** /05_cleanup_decisions-9485fee2d3c81c3d.html

**Items:** 6 total, 4 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **comment** · it's probably already in there, but you can do it again
2. **comment** · yes please
3. **comment** · not sure that goes in the claude file but its a good lesson for somewhere else
4. **comment** · do it
5. **comment** · leave it
6. **comment** · put them here. not another page

---

## 1. comment · li 2

`itm_7cdcf9cbad1bb759738845d2` · 

**Ken wrote:**

> it's probably already in there, but you can do it again

**Pointing at:**

> The no-deletion rule, spelled out for builders. Builders ran rm twice despite a one-line reminder, which blocked you. Proposed addition to "Never remove files while work is running": the rule covers temp specs, probes, screenshots, test-results folders, and .bak files that sed -i leaves; restore the bundle with git checkout -- dist/lahe-layer.js; builder prompts state the rule at the top. Default: yes.

**Reply (handled):**

> Noted: I'll add the spelled-out version to CLAUDE.md.

---

## 2. comment · li 3

`itm_d42a2bb7d6ce3dddd36a5dd8` · 

**Ken wrote:**

> yes please

**Pointing at:**

> A guardrails file so the ship skill can run here. st-ship stopped because this repo has no .claude/guardrails.md, so I opened the PR by hand. Proposed: add that file, naming the base branch (main), the check (npm run gate:all), and the PR conventions from CLAUDE.md. Default: yes.

**Reply (handled):**

> Noted: I'll add .claude/guardrails.md.

---

## 3. comment · li 1

`itm_5442ad6a44408dea6788ed43` · 

**Ken wrote:**

> not sure that goes in the claude file but its a good lesson for somewhere else

**Pointing at:**

> Tests never reach your real helper. Two browser tests with no helper running reached your installed helper on port 7817. They failed only because it ran an older version. Proposed line under "Running the gate": a test that needs "no helper" refuses connections to 7817, and every test helper runs on its own port and state folder. Default: yes.

**Reply (handled):**

> Agreed: it goes in as a lesson in docs/lessons, not in CLAUDE.md.

---

## 4. comment · h2 2

`itm_c6dd5b544278c093b4f2c6e9` · 

**Ken wrote:**

> do it

**Pointing at:**

> Deletions, one batch

**Reply (handled):**

> Doing the batch now. The preview helper stops and your notes folder stays.

---

## 5. comment · h2 4

`itm_96437ed569f31d555c09ae1f` · 

**Ken wrote:**

> leave it

**Pointing at:**

> 4. The draft's name in git hist

**No reply recorded.**

---

## 6. comment · h2 3

`itm_e6bbe1800e4d3fc115463ec0` · 

**Ken wrote:**

> put them here. not another page

**Pointing at:**

> 3. Lessons waiting for review

**No reply recorded.**

---
