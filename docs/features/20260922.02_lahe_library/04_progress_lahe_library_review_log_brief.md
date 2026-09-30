# Review log: r2bb2097402e5

**Pages reviewed:** /01_brief_lahe_library-2c46b3ef7fe0f166.html

**Items:** 16 total, 16 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Hand edits

2. Changed "gets a new address, and that is fine" to "can have a different port, that's not a big deal. If you can also keep the same port, that would be fine too".
4. Changed "with one click" to "easily".
5. Changed "read it right away and know whether an agent will see my comments" to "get back to reading, writing, editing".
6. Changed "one agent isn't juggling ten documents" to "I can keep my agents' context focused and not poisoned by wildly different topics and tasks".
9. Removed ", with none deleted or hidden permanently".

## Everything, in order

1. **comment** · horizontal maps are not legible on a document like this.
2. **edit** · Changed "gets a new address, and that is fine" to "can have a different port, that's no...
3. **delete** · correct, i would like to consider launching agents from the UI, and what that looks like
4. **edit** · Changed "with one click" to "easily".
5. **edit** · Changed "read it right away and know whether an agent will see my comments" to "get bac...
6. **edit** · Changed "one agent isn't juggling ten documents" to "I can keep my agents' context focu...
7. **comment** · this feels like architecture. and it feels prescriptive. my response was that i'm flexi...
8. **comment** · docs should be readable without an agent, but the default 'open' should include an agen...
9. **edit** · Removed ", with none deleted or hidden permanently".
10. **comment** · open comments (waiting on an agent), total comments. 
11. **comment** · this isn't a requirement. it's a pointer at an open question
12. **comment** · we already ahve requirements for dealing with two tabs open. you don't need to do more...
13. **comment** · there's already an agent handover, don't duplicate work if that will work
14. **comment** · we already decided this was the wrong way to do things
15. **comment** · what's the difference between a review and an agent session?
16. **comment** · Okay, so a session can have many reviews and a review can have many documents. Which I...

---

## 1. comment · section 1

`itm_a0a47066c8432cea43e1e998` · 

**Ken wrote:**

> horizontal maps are not legible on a document like this.

**Pointing at:**

> roach B)
> this feature
>
> Agent writes a document
>
> lahe review serves it
> on a random port

**Reply (handled):**

> Turned it into a top-to-bottom flow.

---

## 2. edit · li 3

`itm_3ebb02f15ded73d81368e946` · 

**Hand edit:** Changed "gets a new address, and that is fine" to "can have a different port, that's not a big deal. If you can also keep the same port, that would be fine too".

**Before:**

> Keeping old addresses alive. A reopened document gets a new address, and that is fine.

**After:**

> Keeping old addresses alive. A reopened document can have a different port, that's not a big deal. If you can also keep the same port, that would be fine too.

**Reply (handled):**

> (no text)

---

## 3. delete · li 7

`itm_e131e8686adb6d01ccee6694` · 

**Ken wrote:**

> correct, i would like to consider launching agents from the UI, and what that looks like

**Hand edit:** Deleted this block.

**Reply (handled):**

> Added as Open Question 5: launching an agent straight from the page, and what that looks like. The architecture and its security review take it on.

---

## 4. edit · li 9

`itm_c0f6e897cb3d00b8b4800937` · 

**Hand edit:** Changed "with one click" to "easily".

**Before:**

> As Ken, I want to open a past document with one click and have the rail on it, so that I can read it right away and know whether an agent will see my comments.

**After:**

> As Ken, I want to open a past document easily and have the rail on it, so that I can read it right away and know whether an agent will see my comments.

**Reply (handled):**

> (no text)

---

## 5. edit · li 9

`itm_971002a1b42bf93ee851b446` · 

**Hand edit:** Changed "read it right away and know whether an agent will see my comments" to "get back to reading, writing, editing".

**Before:**

> As Ken, I want to open a past document easily and have the rail on it, so that I can read it right away and know whether an agent will see my comments.

**After:**

> As Ken, I want to open a past document easily and have the rail on it, so that I can get back to reading, writing, editing.

**Reply (handled):**

> (no text)

---

## 6. edit · li 13

`itm_3ca8371a40c2f4cfcf76dbcd` · 

**Hand edit:** Changed "one agent isn't juggling ten documents" to "I can keep my agents' context focused and not poisoned by wildly different topics and tasks".

**Before:**

> As Ken, I want to launch a fresh agent on a document, so that one agent isn't juggling ten documents.

**After:**

> As Ken, I want to launch a fresh agent on a document, so that I can keep my agents' context focused and not poisoned by wildly different topics and tasks.

**Reply (handled):**

> (no text)

---

## 7. comment · li 25

`itm_1c32436eb8a6ac3bd5acb07e` · 

**Ken wrote:**

> this feels like architecture. and it feels prescriptive. my response was that i'm flexible. it doesn't have to be a new address. it can be the old one. since ports are randomly chosen it's unlikely the port used would be in use again, and we could just opt to use the old port.

**Pointing at:**

> new address

**Reply (handled):**

> Agreed. Step 4 now just says Open brings it back with the rail. Old port or new is left to the architecture, and your non-goal line already says either is fine.

---

## 8. comment · li 25

`itm_8ee269e65c53782d9d89d46a` · 

**Ken wrote:**

> docs should be readable without an agent, but the default 'open' should include an agent watching. i'm expecting an agent to be there, so i don't want to come back and ask again.

**Pointing at:**

> No agent is needed to read it.

**Reply (handled):**

> Changed: Open now includes the hand-over, so an agent is watching when the document opens. With no agent available it still opens and reads fine, and the rail says so. Solution step 4 and the Open requirement (R8) say this.

---

## 9. edit · Listing, p 1

`itm_fc8cd669b33f26b5471bbba9` · 

**Hand edit:** Removed ", with none deleted or hidden permanently".

**Before:**

> R1. The Library lists every review on disk, with none deleted or hidden permanently.

**After:**

> R1. The Library lists every review on disk.

**Reply (handled):**

> (no text)

---

## 10. comment · Listing, li 3

`itm_afd9861daa85c4bd6b0e5a05` · 

**Ken wrote:**

> open comments (waiting on an agent), total comments. 
>
> whether the review was ended/completed with the complete review button

**Pointing at:**

> how many comments are waiting on an agent

**Reply (handled):**

> Added to what each row shows: waiting and total comments, and whether the review was ended. Solution step 3 matches.

---

## 11. comment · Listing, p 6

`itm_b642fd9df6d6b039369859d6` · 

**Ken wrote:**

> this isn't a requirement. it's a pointer at an open question

**Pointing at:**

> R5. Before Sep 16, LAHE gave each page in a folder its own review. The Library groups those old reviews by folder, the way LAHE records them today. How that shows as rows is settled with Open Question 1 (what one row is).

**Reply (handled):**

> Removed R5 and folded the old per-page reviews into Open Question 1.

---

## 12. comment · Acting on a row, p 3

`itm_94520d736cfa78d8c18a4a5c` · 

**Ken wrote:**

> we already ahve requirements for dealing with two tabs open. you don't need to do more than what we already ahve for this

**Pointing at:**

> The page says so, and warns that a second tab on the same document splits the comments

**Reply (handled):**

> Cut the warning. R10 now defers to how LAHE already handles two tabs.

---

## 13. comment · Acting on a row, p 7

`itm_ccd3b8dd8d02e1c20add6d7f` · 

**Ken wrote:**

> there's already an agent handover, don't duplicate work if that will work

**Pointing at:**

> R12. Pick this up sends a request to the agent attached to the Library, which handles it like any other task. That agent takes over the document's session, so Ken's comments on it reach that agent.

**Reply (handled):**

> R12 now uses the existing takeover, and R14 reuses the hand-off message the rail already copies. Nothing new for either.

---

## 14. comment · p 11

`itm_503d9a926120c41975147027` · 

**Ken wrote:**

> we already decided this was the wrong way to do things

**Pointing at:**

> before Sep 16, LAHE gave each page in a folder its own review, so the answer decides whether those old reviews show as one row or many.

**Reply (handled):**

> Settled, not open: R5 now says those old per-page reviews show together, the way a folder is recorded today. Taken out of Open Question 1.

---

## 15. comment · p 11

`itm_e5b56433edf04e63427290c9` · 

**Ken wrote:**

> what's the difference between a review and an agent session?

**Pointing at:**

> one row: a document, a review, or an agent session? Settled in the wireframe, on real data.

**Reply (handled):**

> (no text)

---

## 16. comment · p 11

`itm_862b20566eaaa7a54e5107b6` · 

**Ken wrote:**

> Okay, so a session can have many reviews and a review can have many documents. Which I think means that we want to show them nested. So we'll have an agent session as the larger row and then nested within that you will see the list of reviews and less nested within that you will see the list of documents. I haven't looked at the wireframes yet, I'll do that too, but That would be how I'm thinking about this

**Pointing at:**

> What is one row: a document, a review, or an agent session? Settled in the wireframe, on real data.

**Reply (handled):**

> That is now wireframe B: each agent session is a card, its reviews inside, and a review with several pages lists them. The old wireframes had been wiped from a temp folder, so all three are rebuilt: http://127.0.0.1:54222/index.html

---
