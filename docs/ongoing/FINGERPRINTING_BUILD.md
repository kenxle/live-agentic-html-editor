# Fingerprinting: the build

The plan for finishing what `FINGERPRINTING.md` describes. That doc is the
design and the cases; this one is the work, in order, with what "done" means
for each piece. Written 2026-09-11 after Ken decided the four open questions
in a live review (see the "Open questions, now decided" section there).

## The decisions this build is bound by

- **Stamp at first edit.** `data-lahe-id` is written onto the element in the
  browser the moment the reviewer touches it (already true in the August
  engine work). It reaches the source when the agent first edits that element.
  No setup pass.
- **The click always places.** A comment or edit on one of N identical
  elements is not refused. The record carries the stamp, the element's path,
  and its ordinal among identical siblings, and the agent stamps the right
  one in the source. The browser's own write ladder still refuses to write on
  position alone (D9); the ordinal is information for the agent.
- **A probable place is the fallback only.** When a stamp is missing, the
  point ladder's best guess is painted in a weaker treatment with the word
  "probable" on the card. Never dressed as a find.
- **Looped generated output stays deferred.**

## What exists

- `src/layer/anchor.js`, `src/layer/pointing.js`, `src/shared/regions.js`,
  `src/shared/markers.js`: the August 26 engine work, uncommitted in the
  working tree until task 1 lands it. Mints and finds the stamp, keeps two
  remembered identities (path and fingerprint), and has the whole point ladder
  (`bestGuess`, `whereItWas`, `verdictFor`). 61 unit tests pass.
- The architecture doc's D9 amendment (same diff).
- Two browser specs are red against it, on purpose: they assert the OLD rule
  (refuse a symmetric copy, refuse a bare canvas). Under "the click always
  places" the engine is right and the specs are rewritten in task 1.

## Tasks

| # | Task | Depends on | Done means |
| --- | --- | --- | --- |
| 1 | Land the engine, project it, and tell the agent | nothing | August work committed; the two specs assert the new rule; review.json carries `region.stamp`, `region.where`, `region.ordinal`, `region.text_unique`; the contract tells the agent to carry the stamp into the source and how to pick a twin; every restated copy matches |
| 2 | Heading walk sees inside earlier siblings | nothing | a treatment heading wrapped in a sibling div reaches `context.heading` |
| 3 | The rail uses the point ladder | 1 | a comment whose exact match is gone jumps to and paints its probable place, weaker, with "probable" on the card; a stamped element is found with certainty and painted normally |
| 4 | reveal.js fixture in the suite | nothing | a real reveal deck fixture; comment box, rail fields, selection pill, and change highlight all pass on it |
| 5 | Release | 1 to 4, 6 | `dist/lahe-layer.js` rebuilt and committed; `gate:all` green on all three lanes; version bumped; the board row closed |
| 6 | The graceful-failure net | 1 | every case in the list below refuses and reports lost; none writes; run as unit tests on the gate and as browser tests on a rebuilt page |

## Task 6 in detail: graceful, never destructive

Ken, 2026-09-11: "I would much rather have graceful failures than quiet
failures or destroying work." The stamp adds new ways to be confidently wrong
that the existing 22 cases do not cover. Each of these must REFUSE the write,
stamp the record lost with a reason the reviewer reads, and leave the page and
the source untouched. Quiet success on any of them is the bug.

| # | The hazard | Must happen |
| --- | --- | --- |
| S1 | the same stamp on two elements (copy-paste in the source) | refuse; lost says "two elements carry this id" |
| S2 | the agent stamped the wrong twin: stamp found, but its text is not the record's before and not any after in its history | refuse; lost says the stamp points at different words |
| S3 | a stale stamp: the stamped element was deleted and a rebuild reused nothing; stamp absent, text absent | lost, as today |
| S4 | stamp absent, text present more than once | refuse (D9), exactly as before the stamp existed |
| S5 | stamp absent, text present once, but the tie-breakers disagree (different tag, different parent) | write only if the text is unique in the document; tie-breakers corroborate, never overrule |
| S6 | a stamp inside a protected block (the reviewer is editing it) | never written to by replay; the conflict branch, as today |
| S7 | an agent reply says handled but the stamp is not in the rebuilt source | the page check reopens once (the existing check_reopen guard), and the note says the stamp did not land |
| S8 | a point-ladder guess (probable place) | never receives a write; paint and card only |

Plus the negative of the whole list: the 22 existing cases stay green
unchanged, and a record with a valid unique stamp on an element whose text
matches writes exactly as before. The reviewer must never see a silent
drop: every refusal is a lost stamp on the card and in review.json.

Frozen files (`manifest.js`, `review_format.js`, `layer/selection.js`) may be
edited by the task that needs them; the orchestrator authorized it here.

## Task 1 in detail

1. Commit the working-tree engine work as one commit, with the architecture
   amendment. Nothing else in that diff changes.
2. Rewrite the two red specs. `anchor_engine.spec.js:210` (symmetric copy):
   the mint succeeds (`ok: true`) because the stamp identifies it, and the
   record says `text_unique: false` with `not_unique_reason` filled, so the
   agent knows text alone will not find it. `element_subject.spec.js:185`
   (bare canvas): same shape, `ok: true` with a stamp and `subject` null; it is
   not stamped lost.
3. Project onto every item in review.json:
   - `region.stamp`: the id, or null.
   - `region.where`: the ancestor chain innermost last, each as
     `tag#id.class.class`, e.g. `main > section#t6.tcase > div.state > section.sec-blog > div.wrap`.
     The fingerprint chain today keeps ancestor classes; keep ids too.
   - `region.ordinal`: `{index, of}` among siblings under the same parent whose
     normalized text and tag are identical to this element's; `{1, 1}` when
     unique.
   - `region.text_unique`: boolean.
4. Contract sentences (and their copies in test/unit/review_format.test.js,
   docs/CONTRACTS.md, AGENTS.md, skills/lahe/SKILL.md), plain words:
   - An item's `region.stamp` is an id the reviewer's page wrote onto the
     element. When you edit that element in the source, write the same
     `data-lahe-id` attribute onto it, so the next build reproduces it and the
     page finds it with certainty. Never remove one. The attribute is not
     content: it never appears in `before` or `after`.
   - When `region.text_unique` is false, the text is on the page more than
     once. Use `region.where` and `region.ordinal` to pick the right one in
     the source: the ordinal counts identical siblings in source order, which
     is page order for a page built once from its source.
5. Unit tests for the projection fields and the contract copies. The gate.

## Task 3 in detail

- `replay.js`: when a record's write-ladder resolve fails for a comment or
  note (never an edit: edits refuse and stay refused), ask `pointing.bestGuess`
  for its probable place. Bind the highlight there with a new
  `highlight.NAME.PROBABLE` (a lighter or dashed treatment of the comment
  color), and put the word "probable" on the card through the existing card
  notice seam.
- A stamped element found by stamp is a certain find: normal paint, nothing
  on the card.
- Card click jump goes to the probable place too.
- Browser test on a rebuilt page whose sentence was reworded: the comment
  lands on the reworded paragraph, painted probable; after the agent stamps
  the source and the page rebuilds, it is painted normally.
