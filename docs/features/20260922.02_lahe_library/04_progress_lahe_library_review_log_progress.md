# Review log: re32b5abb8196

**Pages reviewed:** /04_progress_lahe_library-fdf092f7193a770f.html

**Items:** 1 total, 1 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **comment** · i think this is fine

---

## 1. comment · li 1

`itm_3716b5ad2e4fa40bf72f82bb` · 

**Ken wrote:**

> i think this is fine

**Pointing at:**

> One change from the approved design, for your yes or no. The design said an agent attaches to the Library by running lahe library --session <its id>. But an agent you just asked to "open the lahe library" usually has no LAHE session yet, so it could not attach and Pick this up had nobody to go to. So now a bare lahe library starts a fresh session for that agent and attaches it; after that, the agent passes the session id it was given. The cost: every bare run attaches a new agent, which takes the hand-overs away from whichever agent had them before. You don't need to run it yourself: the Library stays at http://127.0.0.1:7817/catalog. Keep this?

**Reply (handled):**

> Thanks. I have the session back, and I'm setting up the Library on a copy of your records so you can see it before the merge.

---
