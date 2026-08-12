# 1C builder notes: the anchor engine

Branch `task/1c`, worktree `../lahe-worktrees/1c`. Implements plan section "1C: Anchor engine" and
ranked test 9. Architecture: D9, anchors match by uniqueness, not confidence.

## What is in the branch

| File | What changed |
| --- | --- |
| `src/layer/anchor.js` | Reworked. The stub candidate search is now a real DOM walk. `mint` and `resolve` keep their signatures |
| `test/unit/anchor_engine.test.js` | New. The corpus, the transformation set, widening, and the failure paths, over a simulated DOM |
| `test/browser/anchor_engine.spec.js` | New. The same bar against Chromium on `built-doc.html` and the multi-page app fixture |

Nothing else is touched. `dist/` is not committed. No file owned by another task was edited.

## The engine, in four rules

1. **Text places a write. Nothing else does.** A candidate exists because the region's normalized text
   was found at it. The structural path, the nearest heading, and the author's `data-review-region`
   attribute ride along as corroboration on the descriptor and never create a placement. The one
   exception the plan names is implemented: when the text is gone entirely and the author's attribute
   still points somewhere, the engine emits a `STRUCTURE` candidate so the card can say "it used to be
   here". The shared predicate refuses to write to it, which is the point.

2. **The innermost element holding the text is the candidate.** Every ancestor of a match also contains
   the text; they are the same text seen from further out, not rival regions. So an element with a
   matching descendant is not a candidate. This is what makes "a wrapper element added around the
   region" a non-event, with no scoring involved.

3. **Widening: the unit is a whole sibling element, the stopping rule is the containing block.** Mint
   starts with one whole sibling on each side, and while the region is not yet unique it takes one more
   sibling on each side, outward. When the containing block is exhausted and the region is still not
   unique, mint **fails honestly** (`not_unique_in_containing_block` / `ANCHOR_AMBIGUOUS`) rather than
   widening to the document.

   Mint starts at one sibling rather than zero on purpose. A region can be unique today with no context
   at all, but a reference minted that way can never be told apart from a copy pasted in tomorrow, and a
   page that gains a duplicate is the ordinary case. Starting at one is also what makes the minted
   reference identical to `test/fixtures/uniqueness_corpus.js`'s `REFERENCE`, so the engine and the
   predicate really are judged by one standard.

4. **The context anchor climbs through only-children.** A region that is the only element in its parent
   has no siblings to widen into, so its context is read from the nearest ancestor that has siblings.
   Without this, wrapping a region in a `div` empties its context, the stored context stops matching,
   and a duplicate elsewhere on the page can win the elimination round. That is the one forbidden
   outcome, resolving to a DIFFERENT node, and there is a test for exactly that combination
   ("a wrapper added around a region that is ALSO duplicated").

**No scalar anywhere.** The verdict is `uniqueness.selectUnique` and nothing else; there is no
threshold, no confidence, and no score in the file, and a unit test greps the source to keep it that
way. One derived length is used, and it is not a tunable: a candidate's found context is cut to the
stored context's own length, which is what keeps context comparison ADJACENT. Without the cut, a
candidate at the foot of the page matches any stored prefix, because everything on the page precedes it.

## Done-when, item by item

- **Three binding corpus cases bind to the right node, three non-binding cases write nothing.**
  `test/unit/anchor_engine.test.js`, "the fixture corpus: the real DOM engine lands where the predicate
  lands", runs all seven corpus cases through the real engine and asserts the bound node identity, not
  just the verdict. Non-binding cases assert `element === null` and a named `failureCode`.
- **Occurrence four of five survives the deletion of occurrence two.** Its own test in both lanes: five
  copies of one sentence, each with its own neighbours, mint on the fourth, delete the second, resolve
  again, assert the same node.
- **The transformation set at the stated bar.** Whitespace collapse and expansion, sibling reordering, a
  duplicate paragraph inserted elsewhere (both after and **before** the region), a neighbouring block
  deleted, and a wrapper element added around the region. Every one is asserted as: same node, or an
  honest failure with a code, and never a different node. Five of them are held to the stronger bar of
  actually binding, because the region is still uniquely there.

## The demonstrated failure

The rule the tests exist to enforce is "a write needs a unique candidate, not the first plausible one".
The one-line revert takes the first match:

```diff
   function resolve(ref, root) {
     var reference = ref || {};
     var scope = scopeOf(root, null);
-    var verdict = uniqueness.selectUnique(candidatesFor(reference, scope), reference);
-    verdict.element = verdict.bound ? verdict.key : null;
+    var found = candidatesFor(reference, scope);
+    var verdict = uniqueness.selectUnique(found, reference);
+    verdict.element = found.length ? found[0].key : null; // DELIBERATE REVERT
     return verdict;
   }
```

Unit lane against the revert:

```
not ok 2 - the fixture corpus: the real DOM engine lands where the predicate lands
    same_paragraph_duplicated: a non-binding verdict writes nothing
not ok 4 - targeting occurrence four of five survives the deletion of occurrence two
    Expected "actual" to be reference-equal to "expected":
not ok 8 - transformation: a duplicate paragraph inserted BEFORE the region
not ok 16 - a structure-only match corroborates and can never place a write
# tests 17
# pass 13
# fail 4
```

Browser lane against the same revert:

```
  ✘  3 › occurrence four of five survives the deletion of occurrence two
  ✘  4 › three identical list items: each binds to itself, and never to one of the others
  ✘  2 › two identical paragraphs in different containers are told apart by their context
  3 failed
  3 passed
```

The revert was reverted; the branch holds the real version.

## What the browser lane caught that the simulated DOM did not

The first draft of the browser spec asserted that `built-doc.html`'s three identical list items are
indistinguishable and that mint must refuse. Against the real page that is false, and the test failed:
what FOLLOWS each of the three differs (two repeats, then one, then none), so widening separates them
by context, which is legitimate placement under D9 and not a position guess. The assertion was wrong,
not the engine. The spec now asserts the thing that actually matters for those three, which is that no
item ever binds to a different item, and the genuinely symmetric case (a copy with the same neighbours
on both sides, all the way out) gets its own test, where mint does refuse.

## Gate

`npm run gate:builder`, run synchronously in this worktree:

```
> lint
lint passed (syntax: 98 files, no jsdom, manifest complete)
> test:unit
# tests 263
# pass 263
# fail 0
> test:browser
  56 passed (15.8s)
```

(262 and 56 are the totals after this branch's 17 unit tests and 6 browser tests were added.)

## Asks routed to the orchestrator

**None for the normalizer.** `shared/normalize.js` had everything the engine needed:
`normalizeText` is idempotent, whitespace-insensitive, and it folds the unicode spaces, which is the
whole of "whitespace-tolerant matching". `shared/uniqueness.js` needed no change either; its
`contextMatches` containment tolerance is what makes a deleted neighbour survivable.

One observation for whoever owns the predicate later, recorded rather than acted on: `buildCandidates`
in `uniqueness.js` emits a `CONTAINS` candidate in **both** directions (candidate contains probe, and
probe contains candidate). The real engine emits only the first direction, because the second turns
every stray fragment of the region's text into a rival and suppresses the real match's ancestors. The
corpus does not exercise the difference, so nothing disagrees today.

## Cleanup needed

Nothing deleted, nothing to delete. `test/unit/consumer_1c_anchor.test.js` (0A-kernel's throwaway stub
consumer for this task) is already on the Phase 4B cleanup list in the plan and still passes unchanged
against the real engine, so it can be removed with the rest of that batch whenever the orchestrator runs
it.
