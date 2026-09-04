# How a Live Agentic HTML Editor (Lahe) Identifies the Correct DOM Elements for Editing, aka Fingerprinting

**Status: living document.**

Agentic editing means that what you edit in your browser does **not** make direct
edits to the file on disk. An agent must take the DOM element that you
highlighted, and find that same element in the source, then make the edit in the
source and refresh your page. For the editor to be a quality-of-life tool, it needs to satisfy
additional requirements like undo, and showing you where in the document edits
were made, which bring additional complexities to bear.

---

## Key Use Cases

### 1. Identify the correct element to be edited

Find the correct text in the source. You want to make an edit by hand, or you've
given rewrite steering for a paragraph. Find that paragraph and edit it.

<div style="border:1px dashed rgba(17,17,17,0.22);border-radius:10px;padding:10px 14px 14px;margin:12px 0;background:rgba(17,17,17,0.015)">
<div style="font:11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:rgba(17,17,17,0.42);margin-bottom:10px">Example</div>

<div style="border:1px solid rgba(17,17,17,0.10);border-radius:6px;padding:18px 22px;background:#fff;font:15px/1.65 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#111">
Runners come back too fast after a layoff, and <span style="background-color:rgba(60,86,165,0.26)">the third week is where it shows</span>. Most plans are written for the athlete who does not miss a session, which is nobody.
</div>

<div style="width:288px;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;border:1px solid rgba(17,17,17,0.12);background:#ffffff;box-shadow:0 8px 28px rgba(17,17,17,0.16),0 1px 2px rgba(17,17,17,0.08);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#111111;margin:-10px 0 0 34px;position:relative;z-index:1">
  <div style="height:10px;margin:-4px -4px 0 -4px;border-radius:6px;background-image:radial-gradient(rgba(17,17,17,0.28) 1px,transparent 1px);background-size:5px 5px;background-position:center;background-repeat:repeat-x"></div>
  <p style="margin:0;padding-left:8px;border-left:2px solid rgba(60,86,165,0.75);color:rgba(17,17,17,0.62);font-size:12px">the third week is where it shows</p>
  <div style="width:100%;box-sizing:border-box;min-height:66px;border:1px solid rgba(17,17,17,0.16);border-radius:6px;padding:7px 8px;font:inherit;color:inherit;background:#fff">Say which week plainly. And cut the second sentence down, it is doing two jobs.</div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;color:rgba(17,17,17,0.5);font-size:11px">
    <span>Cmd-Enter when done with this comment</span>
    <span>Draft</span>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
    <button style="font:inherit;font-size:11.5px;font-weight:550;color:rgba(17,17,17,0.62);border:1px solid transparent;border-radius:7px;padding:3px 5px;background:none">Delete</button>
    <button style="font:inherit;font-size:11.5px;font-weight:550;color:rgba(17,17,17,0.62);border:1px solid rgba(17,17,17,0.12);border-radius:7px;padding:3px 9px;background:#fff">Send</button>
  </div>
</div>

</div>

This is the simplest case, and while text matching sounds easy, there can be
matching text elsewhere on the page, so we need to use other methods for
identifying the element.

### 2. Show where edits were made

Trust but verify, right? After steering an agent to make an update, you'll move
on while it works. Later you want to see what it wrote, so you use the review
panel and click on the card that shows the edit, and it scrolls the page to where
it made those changes.

Because the document has now been changed according to your request, the
fingerprint that was taken before the edit may no longer be accurate.

<div style="border:1px dashed rgba(17,17,17,0.22);border-radius:10px;padding:10px 14px 14px;margin:12px 0;background:rgba(17,17,17,0.015)">
<div style="font:11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:rgba(17,17,17,0.42);margin-bottom:10px">Example: the card, and the passage it points to</div>
<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">

<div style="flex:1 1 300px;min-width:280px;border:1px solid rgba(17,17,17,0.10);border-radius:6px;padding:18px 20px;background:#fff;font:15px/1.65 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#111">
Runners come back too fast after a layoff, and <span style="background-color:rgba(60,86,165,0.15)">week three is where the wheels come off</span>. Most plans are written for the athlete who never misses a session.
</div>

<div style="flex:0 0 320px;max-width:320px;display:flex;flex-direction:column;background:#fff;color:#15171c;border:1px solid #e2e5eb;border-radius:14px;box-shadow:0 1px 2px rgba(18,20,26,.06),0 14px 34px rgba(18,20,26,.13);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden">
  <div style="display:flex;align-items:center;gap:10px;padding:13px 14px 12px;border-bottom:1px solid #eceef2"><span style="width:8px;height:8px;border-radius:50%;background:#3c56a5;flex:none"></span><span style="font-weight:600">Review</span></div>
  <div style="display:flex;gap:2px;padding:0 10px;border-bottom:1px solid #eceef2">
    <span style="position:relative;padding:6px 10px 10px;font-size:12px;font-weight:500;color:#565e6d;display:flex;align-items:center;gap:6px">Active <span style="font-variant-numeric:tabular-nums;font-size:11px;color:#868f9f;background:#f6f7f9;border-radius:999px;padding:1px 6px;min-width:20px;text-align:center">0</span></span>
    <span style="position:relative;padding:6px 10px 10px;font-size:12px;font-weight:600;color:#15171c;display:flex;align-items:center;gap:6px;box-shadow:inset 0 -2px 0 #3c56a5">Done <span style="font-variant-numeric:tabular-nums;font-size:11px;color:#2c3f7d;background:rgba(60,86,165,.09);border-radius:999px;padding:1px 6px;min-width:20px;text-align:center">1</span></span>
    <span style="position:relative;padding:6px 10px 10px;font-size:12px;font-weight:500;color:#565e6d;display:flex;align-items:center;gap:6px">Edits <span style="font-variant-numeric:tabular-nums;font-size:11px;color:#868f9f;background:#f6f7f9;border-radius:999px;padding:1px 6px;min-width:20px;text-align:center">0</span></span>
  </div>
  <div style="margin:10px;background:#fff;border:1px solid #e2e5eb;border-radius:10px;padding:11px 12px 12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 1px rgba(18,20,26,.03)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;color:#2c6f52;background:transparent;border:1px solid currentColor">handled</span>
      <span style="font-size:11px;color:#868f9f">11:04</span>
    </div>
    <div style="font-size:12px;color:#565e6d;border-left:2px solid #e2e5eb;padding-left:9px">the third week is where it shows</div>
    <div style="font-size:13.5px;line-height:1.5;color:#15171c">Say which week plainly. And cut the second sentence down, it is doing two jobs.</div>
    <div style="border-radius:8px;padding:8px 10px;background:#f6f7f9;font-size:12.5px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px;color:#868f9f;font-size:11px"><span>claude</span><span>1 file</span></div>
      Named the week and cut the trailing clause.
    </div>
  </div>
</div>

</div>
</div>

Clicking that card scrolls the page to the highlighted sentence on the left. Note
what the card still quotes: <b>the third week is where it shows</b>, the words as
they were when the comment was made. The page now says <b>week three is where the
wheels come off</b>. Not one word is shared, and the card still has to find it.



### 3. Undo an edit that has already been applied

The reviewer takes back a change the agent made. The passage has to be found
again, put back to what it said, and the agent has to be told to take the change
out of the source so the next rebuild does not bring it back.

An undo is the easiest of these to get right and the worst to get wrong: it
writes, so it needs certainty, and it targets a passage that by definition has
already been changed once.

### 4. Survive the edits queued ahead of it

The reviewer works faster than the agent applies. Four comments are made against
the page as it stands, and then they are applied one at a time, so the second
edit lands on a page the first edit already changed.

If the first edit deletes a paragraph, everything below it shifts, and every
reference taken before that moment now points one place too far down. Nothing
announced it. The references still work, right up until a later edit takes away
the words that were holding them together.

## A document that makes it hard

The 2026-08-26 review of the lessons queue. 73 cards, one per lesson file, each
rendered from the same template. Here are two of them as the reviewer saw them:

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 16px;margin:10px 0;font-family:system-ui,sans-serif">
  <div style="font-size:12px;letter-spacing:.04em;color:#7a8290;text-transform:uppercase">rails</div>
  <div style="font-weight:600;margin:4px 0 6px">a-data-migration-does-not-run-on-a-brand-new-database.md</div>
  <div style="font-size:13.5px;color:#3d4450;line-height:1.5">A migration that has always been in the schema never runs again, so a fix written inside one is a fix that only exists on machines that already ran it.</div>
  <div style="margin-top:10px;font-size:13px"><b>Approve</b> / Deny / Discuss</div>
</div>

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 16px;margin:10px 0;font-family:system-ui,sans-serif">
  <div style="font-size:12px;letter-spacing:.04em;color:#7a8290;text-transform:uppercase">rails</div>
  <div style="font-weight:600;margin:4px 0 6px">a-partial-render-inside-a-loop-reloads-the-template.md</div>
  <div style="font-size:13.5px;color:#3d4450;line-height:1.5">Rendering a partial inside each iteration re-resolves the template every time, which is invisible until the collection is large.</div>
  <div style="margin-top:10px;font-size:13px"><b>Approve</b> / Deny / Discuss</div>
</div>

The reviewer clicked **Approve** on the first card and typed "yes".

Everything the tool would normally use to tell those two apart is identical:

| Signal | Card 1 | Card 40 |
| --- | --- | --- |
| the word clicked | `Approve` | `Approve` |
| the words either side | `/ Deny / Discuss` | `/ Deny / Discuss` |
| tag and classes | `span.decide` | `span.decide` |
| parent chain | `div.card__decide` in `article.card` | the same |
| nearest heading | `rails (15)` | `rails (15)` |
| position | `...>article:1>div:3>span:1` | `...>article:40>div:3>span:1` |

Only two things differ: the position, which lies as soon as a card is added or
removed, and the filename, which is one level up inside the card and was not
being read.

What happened: the anchor could not be minted, the item reached the agent
stamped lost, and the agent resolved it by counting span ordinals and then asked
the reviewer to confirm. It guessed right. It said it would not want to do that
73 times.

Two things came out of that case, both now fixed and both in the cases at the
bottom: context widening climbs to the filename instead of stopping at the first
row of siblings (case 19 and the 73-card test), and minting no longer refuses
when it cannot guarantee re-finding something later.

## What each case looks like

The same paragraph through every state, rendered as the reviewer sees it. The
wash is the tool's own comment highlight, `rgba(60, 86, 165, 0.15)`.

### 1. The comment is made

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 18px;margin:8px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430">
Runners come back too fast after a layoff, and <span style="background-color:rgba(60,86,165,0.15)">the third week is where it shows</span>. The plan has to survive the week nobody plans for.
</div>

Captured: the words, the words either side, `p.lede` inside `section.intro`,
the path, and a stamp written onto the element.

### 2. The agent rewords it

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 18px;margin:8px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430">
Runners come back too fast after a layoff, and <span style="background-color:rgba(60,86,165,0.15)">week three is when it surfaces</span>. The plan has to survive the week nobody plans for.
</div>

Every word the anchor was made of is gone. **The write refuses**, correctly:
these are not the same words and an edit may not land on a maybe. **The
highlight stays**, because the element's identity never depended on the words.

### 3. The agent deletes it

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 18px;margin:8px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430">
Runners come back too fast after a layoff. <span style="border-left:3px solid rgba(60,86,165,0.45);padding-left:8px;color:#7a8290;font-style:italic">your comment was here</span> The plan has to survive the week nobody plans for.
</div>

Nothing claims to be the passage, including the sentence that closed the gap.
What is shown is the surviving neighbour, which is a different claim: not "here
is your passage" but "your passage was here".

### 4. Two rows that cannot be told apart

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 18px;margin:8px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430">
<div style="padding:6px 0;border-bottom:1px solid #eceef1">Weekly check-in &nbsp;&nbsp; <span style="background-color:rgba(60,86,165,0.26);padding:1px 4px">Approve</span> / Deny</div>
<div style="padding:6px 0">Weekly check-in &nbsp;&nbsp; Approve / Deny</div>
</div>

The reviewer marked the first. The two rows then swap. **The write refuses.**
The highlight goes to whichever row is now standing in the remembered place,
which is the wrong one, and the card says it got there by position rather than
by recognising anything.

### 5. The page is rebuilt and nothing moved

<div style="border:1px solid #d8dbe0;border-radius:8px;padding:14px 18px;margin:8px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430">
Runners come back too fast after a layoff, and <span style="background-color:rgba(60,86,165,0.15)">the third week is where it shows</span>. The plan has to survive the week nobody plans for.
</div>

The ordinary case, and the one that has to stay cheap: the words are found once,
nothing else is consulted, and the write lands.

---

## Two jobs, and they need opposite temperaments

Everything here follows from one distinction. Getting it wrong in either
direction is what breaks the tool.

| | **Write** | **Point** |
| --- | --- | --- |
| What it does | changes your document | draws a highlight, scrolls the page |
| Cost of being wrong | a destroyed passage | a mark in the wrong place |
| Can it be undone | not always | it is already nothing |
| So the rule is | **be certain or do nothing** | **best honest answer** |

A write that lands on the wrong paragraph edits text nobody asked about. A
highlight on the wrong paragraph is visibly wrong and you ignore it.

So the same question, "which element is this", gets two different answers on
purpose. **This is the single most important thing in this document.**

---

## What is captured when you click

The reviewer clicks; the element is right there in our hands. Everything below is
recorded at that instant, and **mint never fails**. It used to refuse when it
could not guarantee re-finding the element later, which threw away the comment at
the moment it was made. Being hard to find later is a fact about the future.

```mermaid
flowchart TD
  A["you click an element"] --> B["stamp it: data-lahe-id"]
  B --> C["read its words<br/>(or its signature, for an image)"]
  C --> D["read the neighbours' words<br/>widening outward, then up"]
  D --> E["read what it IS<br/>tag, id, classes, parent chain"]
  E --> F["read where it sits<br/>path with ordinals, up to body"]
  F --> G{"can the words alone<br/>find it again?"}
  G -- yes --> H["text_unique: true"]
  G -- no --> I["text_unique: false<br/>+ why<br/><i>the comment is still good</i>"]
```

### The six signals, and what each is worth

| Signal | Example | Survives a reword? | Survives a rebuild? |
| --- | --- | --- | --- |
| **stamp** `data-lahe-id` | `e7f2a91c` | yes | only if the agent wrote it to source |
| **text** | `Say which week this is about.` | no | yes |
| **signature** (no text) | `img\|src=logo.png\|alt=Logo` | n/a | yes |
| **neighbour text** | before: `The third week...` | yes | yes |
| **identity** | `p.para__body` inside `section.para` | usually | usually |
| **place** | `body>main:1>section:3>p:1` | yes | no, if anything moved |

The stamp is the only one that is **true by construction**. Every other row is a
guess that the element still looks like what it looked like.

---

## Finding it again: the write ladder

Strict. Stops at the first rung that gives a unique answer. Falls off the bottom
into an honest refusal.

```mermaid
flowchart TD
  S{"stamp, and only one<br/>element carries it?"} -- yes --> W["WRITE HERE"]
  S -- "no, or two carry it" --> T{"the words, found<br/>exactly once?"}
  T -- yes --> W
  T -- "found several times" --> C{"widen the neighbour text:<br/>outward, then up a level,<br/>until one survives"}
  C -- "exactly one" --> W
  C -- "none, or two" --> R["REFUSE<br/>and say which kind of no"]
  T -- "found nowhere" --> R
```

**Position is not on this ladder at all.** It corroborates and it never decides.
The reason is one line: when two identical rows swap places, the row now standing
where the original stood *is the other row*. Position there is not weak evidence,
it is evidence pointing hard at the wrong element.

---

## Finding it again: the point ladder

Best effort, because being wrong is cheap here.

```mermaid
flowchart TD
  A{"stamp?"} -- yes --> P["POINT HERE"]
  A -- no --> B{"the words?"}
  B -- yes --> P
  B -- no --> C["score every element on IDENTITY<br/>classes, parent chain, id, neighbours"]
  C --> D{"clear winner?<br/>score 55+, and 20 clear of second"}
  D -- yes --> P
  D -- "tied" --> E{"is one of them standing<br/>in the remembered place?"}
  E -- "yes, and it is not<br/>the neighbour shifted up" --> F["POINT, marked<br/>'reached by position'"]
  E -- no --> G{"are the neighbours<br/>still on the page?"}
  D -- "nothing scores" --> G
  G -- yes --> H["REMOVED<br/>show where it was"]
  G -- no --> I["UNKNOWN"]
```

### Why the margin matters more than the weights

Identity is scored, and the numbers order candidates rather than measuring
probability:

```
data-review-region  100     an author's own name for the region
element id           90
classes              40     Jaccard overlap, so 1-of-1 beats 1-of-9
parent chain         30     tag + classes per level, how many still agree
neighbour before     15
neighbour after      15
nearest heading      10
tag                   5     stops a span and a div being interchangeable
--------------------------------------------------------------
floor                55     below this, no answer
margin               20     the winner must beat second place by this
```

Two candidates at 71 and 70 produce **no answer**. That is the swapped-rows case
wearing a number, and tuning the weights is not how this is made correct.

Position is scored separately (`path` 20, `minted path` 12, `ordinal` 5) and is
compared only when identity has already tied.

---

## The queued-edits problem

The one that is genuinely ours. You leave four comments. The agent applies them
one at a time. **The second edit lands on a page the first edit already changed.**

```mermaid
sequenceDiagram
  participant R as You
  participant L as The layer
  participant A as The agent

  R->>L: comment on paragraphs 1,2,3,4
  Note over L: four references minted<br/>against the page as it is now
  A->>A: edit 1 deletes paragraph 1
  Note over L: everything below shifts up.<br/>2,3,4 still bind on their WORDS,<br/>but every stored path is now wrong
  L->>L: re-find each by stamp,<br/>re-record path + fingerprint
  A->>A: edit 2 rewords paragraph 2
  Note over L: its words are gone too.<br/>The refreshed place is right;<br/>the minted one was not
```

Two answers, and they compose:

1. **Bookkeeping, not matching.** A queue entry carries a stamp. No deletion or
   swap landing ahead of it can move an id. This is how collaborative editors
   solve the same problem (Yjs gives every insert a permanent id; ProseMirror
   maps stored positions through each applied step).
2. **Re-snapshot while you still can.** After each edit lands, re-record where
   everything is, for everything still findable. A region whose words the *next*
   edit destroys keeps the snapshot from just before that edit, which is the most
   recent true thing anyone knows about it.

The timing is the whole point: the fresh position is knowable only while the text
still matches. After that there is nothing left to ask.

---

## The stamp, and why it took an amendment

`data-lahe-id` is written onto the live element the moment you touch it. The
layer owns the browser DOM, so this costs nothing at click time. The agent writes
the same attribute into the **source** when it edits that element, and that is
what makes it survive a rebuild.

D9 originally considered a generated marker and rejected it, correctly, because a
marker written only into the browser dies on the rebuild, and the rebuild is the
moment it was needed. Measured: the library calls `location.reload()` when the
target's mtime changes. **That rejection still stands for a browser-only marker.**

What defeats it is the source half. The source is what the rebuild is built
*from*, so a stamp that reaches it is reproduced rather than erased.

Three rules keep it inside D9 rather than beside it:

1. A stamp places a write **only when it is unique** in the document. Two
   elements carrying one stamp is a copy-paste, ambiguous exactly like two
   identical rows, and it fails the same way.
2. A stamp is **never content**. `cleanMarkup` strips it from `before_html` and
   `after_html` like every tool attribute (R33), because that markup is a
   comparison key and an id we invented is not part of what makes two passages
   the same passage. It reaches an agent as its own field.
3. **Nothing depends on it existing.** No stamp, a page we cannot write to, a
   rebuild that dropped it: all fall through to text, then identity, then an
   honest refusal.

---

## The one thing you can do that beats all of it

If a page repeats a control 73 times, **nothing in this document can tell those
73 apart**, and no amount of cleverness will. The information is not in the DOM.
It is in the data behind it, and only the page knows that.

One line in the template fixes it permanently:

```python
f'<article data-review-region="{lesson.filename}">'
```

`data-review-region` is read but never written by this tool. It survives every
rebuild because it lives upstream of the build, and it scores decisively.

---

## What still does not work

| | Why |
| --- | --- |
| Telling truly identical elements apart, for a write | undecidable without the page's help |
| Generated class names | a hashed CSS-module class gets the full 40 points; five other tools built a "does this look generated?" check and we have none |
| A curly quote replacing a straight one | the normalizer folds whitespace and invisibles, deliberately not typography, because folding it would let a write discard your punctuation fix |
| Looped generated output | **deferred on purpose.** 73 cards, one card in the source: there is nothing there to fingerprint or stamp |
| Any of the pointing ladder, in the product | **built and proven, wired to nothing** |

---

## The test cases

`test/unit/anchor_cases.test.js`. Every row is an assertion, not a wish.

### The document is edited

| # | The difficult document | What we do |
| --- | --- | --- |
| 1 | nothing changed | binds on text |
| 1b | the passage was **reworded** | write refuses; point finds it by identity |
| 8 | a framework wrapped it in a new div | non-event: the innermost element holding the text wins |
| 9 | the passage moved to the top of the page | binds on text; position never got a vote |
| 12 | two comments on the same element | both bind |

### The document is cut

| # | The difficult document | What we do |
| --- | --- | --- |
| 2 | the element was **deleted** | nothing claims to be it, including the paragraph that slid into its slot |
| 2b | ...and we show where it was | anchored to the surviving neighbour |
| 2c | the whole block went | says so, rather than reaching further |

### The document repeats itself

| # | The difficult document | What we do |
| --- | --- | --- |
| 5 | two paragraphs swap, each with its own words | each comment follows its words |
| 5b | two **indistinguishable** rows swap | write refuses; point takes the remembered place and **marks itself wrong-able** |
| 10 | the block was duplicated | refuses: two candidates with identical surroundings |
| 11 | a different page entirely | refuses, and the guess declines too |
| 14 | two images sharing one `src` | refuses, exactly as two identical rows do |

### Edits queue up behind each other

| # | The difficult document | What we do |
| --- | --- | --- |
| 3 | four comments, nothing applied yet | all bind |
| 4 | the first edit **deletes** a paragraph | the ones either side still bind; the deleted one reports lost |
| 19 | ...and then a later edit rewords a survivor | the refreshed place finds it; the minted one does not |
| 21 | ...and then you **undo** | the minted place is right again, which is why both are kept |
| 22 | three edits in sequence, then a reword **and** a restyle | still points at its own paragraph |

### Things with no words

| # | The difficult document | What we do |
| --- | --- | --- |
| 13 | an image, gallery reordered | binds on its `src`, not its position |
| 15 | a **curly apostrophe** replaced a straight one | write refuses (correct); the highlight still lands |

### What the card says

| # | | |
| --- | --- | --- |
| 16 | reworded | reads as **found** |
| 17 | deleted | reads as **removed**, with where |
| 18 | unrecognisable | reads as **unknown** |

### Not yet covered, and said out loud

| # | | |
| --- | --- | --- |
| 4b | `lost` reaching the agent in `review.json` | needs the projection, not just the engine |
| 6b | the rail actually using any of this | nothing is wired yet |
| (none) | a page whose class names are generated per build | no case exists |

---

## Open questions

1. **How does a probable place announce itself?** Paint it like a certain match,
   paint it and say it is probable, or do not paint but let the card jump there.
2. **When does the agent stamp the source?** At first edit of an element, or a
   one-time pass at setup. First-edit is less cruft; setup means even the first
   comment binds to a stamp.
3. **Do we stamp documents we do not own?** The "leftovers are inert" argument is
   easier for your own files than for someone else's page.
4. **Should the reviewer be told at click time** that a comment cannot be placed?
   Mint knows immediately; today you find out from an agent, later.
