# Review log: rff27faca1192

**Pages reviewed:** /01_brief_lahe_library.html, /02_architecture_lahe_library.html, /wireframes/a-by-day/index.html, /wireframes/b-nested/index.html, /wireframes/c-projects/index.html

**Items:** 6 total, 6 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **note** · fine yes. board it and let's just finish this index feature
2. **comment** · why do they need me? i don't know what the need is here
3. **comment** · projects are a good potential grouping, but they might conflict with agent grouping, if...
4. **comment** · i think this is the preferred default
5. **comment** · oh i see. we've had the helper be persistent for awhile and it has a fixed port already...
6. **note** · accepted. cleared to proceed

---

## 1. note · (no anchor)

`itm_bc34ee51700950657bb93dfd` · 

**Ken wrote:**

> fine yes. board it and let's just finish this index feature

**Reply (handled):**

> Boarded as LAHE-render-forge-structure. Back to the Library.

---

## 2. comment · h2 1

`itm_b75610730441e98c900977c3` · 

**Ken wrote:**

> why do they need me? i don't know what the need is here

**Pointing at:**

> NEEDS YOU (12)

**Reply (handled):**

> Fair: the label was wrong. Those are documents with comments no agent has answered, plus starred ones, so the work is the agent's; your only move is to open one and put an agent back on it. Renamed it Unanswered comments, and starred, with that sentence under it. Reload to see.

---

## 3. comment · body 1

`itm_ed90d16de5cb1c74c60cf8b4` · 

**Ken wrote:**

> projects are a good potential grouping, but they might conflict with agent grouping, if an agent accidentally gets things from two different projects. usually that doesn't happen because that's not how i work, but it could happen

**Pointing at:**

> Hand-overs go to: Claude, "document index"
> (see it with no agent attached)
> live-agentic-html-editor (12)
> personal (12)
> [a real project folder] (5)
> text-affirmations-root (1)
> scratch (1)

**Reply (handled):**

> Agreed. The plan: sessions stay the grouping (B), each session card shows its project, and a project filter narrows the list. A session that touched two projects shows both labels instead of splitting in two.

---

## 4. comment · div 1

`itm_7f9661a0f73b849d222d94da` · 

**Ken wrote:**

> i think this is the preferred default

**Pointing at:**

> B. Nested: session, then reviews, then documents

**Reply (handled):**

> B is the default, with the project label and filter you asked for on the C page. The architecture is built around it.

---

## 5. comment · Summary, code 1

`itm_16e0deaf6ccaf3c610a21ebe` · 

**Ken wrote:**

> oh i see. we've had the helper be persistent for awhile and it has a fixed port already. the library is not a new server in the way that a new doc is, so it doesn't need a new port number?

**Pointing at:**

> 7817

**Reply (handled):**

> Right. The Library is one more page on the helper, which already sits at the fixed 7817, so it needs no port of its own. 127.0.0.1:7817/catalog stays.

---

## 6. note · (no anchor)

`itm_6b9717e85cd934f515447cf3` · 

**Ken wrote:**

> accepted. cleared to proceed

**Reply (handled):**

> Thanks. The plan's three reviews are being folded in now. When that lands I start the build and post the finished plan on the progress page, so you can read it there, not as a gate.

---
