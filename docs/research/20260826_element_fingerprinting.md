# Fingerprinting DOM elements: what the rest of the world does

Research synthesis, 2026-08-26. Three parallel web sweeps: selector-generation
tools (A/B testing, analytics), annotation anchoring (Hypothesis, W3C,
academic), and systems that write identifiers into documents (CMS visual
editors, build tooling). Sources are linked inline.

The question this answers: how should LAHE fingerprint an element the reviewer
clicked, so the reference survives a rebuild and survives swaps and removes in
a list of near-identical cards. And: is it time to write an identifier into the
document itself, and if so, what attribute.

## TLDR

The whole field converged on two answers, and they layer rather than compete:

- **If you can't write into the document:** record many redundant signals at
  click time, re-find with a scored fallback ladder, and refuse honestly when
  uncertain. This is what `pointing.js` already does, and the research
  validates its shape almost exactly.
- **If you can write into the document:** stamp a `data-*` attribute with your
  own prefix. Every serious tool that injects identity chose this, without
  exception. It is the only approach that fully solves the identical-cards
  case. LAHE's agent is already editing the source, so we are the ideal
  candidate for it.

Proposed direction (last section): keep the fingerprint as the universal layer,
add a `data-lahe-id` stamp as the durable layer, and make upgrades to the
fingerprint that the literature shows everyone else needed.

## LAHE's actual position: full edit control, and three jobs

Most of the research below comes from tools that do NOT control the document:
Playwright drives someone else's app, Optimizely rewrites someone else's page,
Hypothesis annotates the open web. Families 1 through 3 below exist because
those tools lack edit control. LAHE has it: the source is local, the browser
DOM is ours through the layer, and every change that happens to either one is
a change we made or recorded. So the value of the no-control research is its
signal-quality lessons (which signals rot, position last, detect generated
names), not its workflow. Our workflow options are wider.

Against that, LAHE has three distinct jobs, and they are not the same problem:

1. **Edit the right element.** The reviewer changed or commented on
   something; the agent must hit the right element in the source. A DOM walk
   up to body with ordinality plus text matching mostly covers this, and it
   is the job the strict predicate (`uniqueness.js`) already does, with
   refusal on ambiguity because a wrong write is destructive.
2. **Point at the correct location after an edit.** A card, when clicked,
   scrolls the reviewer to its part of the document. That re-find has to work
   on a page whose text has since changed, and gets genuinely hard when the
   target was deleted. This is the job `pointing.js` does, and it is the one
   the annotation literature (fuzzy ladders, orphans, best guesses) speaks to
   directly.
3. **Queued edits, the job that is actually ours alone.** The reviewer edits
   rapidly, so edit requests pile up in a queue. A dom-walk-plus-ordinal
   fingerprint was correct when it was taken, but an earlier edit in the
   queue deletes an item from the list before this one is applied, and now
   the ordinals point at the wrong place. The fingerprint did not rot from
   some foreign rebuild; it was invalidated by our own prior edit.

Job 3 looks unique until you notice collaborative editors solved exactly it,
because a collaborator's queued change hitting a shifted document is their
everyday case. Two known answers:

- **Rebase the reference through the known operations.** ProseMirror
  [maps every stored position through each applied
  step](https://prosemirror.net/docs/guide/#transform.mapping): apply an edit,
  then update everything downstream of it. Operational transforms do the same
  for concurrent edits. We can do this because every intervening change is an
  edit we ourselves are applying: when edit N removes a list item, walk the
  queue and fix the ordinals of every fingerprint behind it. No guessing
  involved; it is bookkeeping, not matching.
- **Assign identity at creation so there is nothing to rebase.**
  CRDTs ([Yjs](https://github.com/yjs/yjs/blob/main/INTERNALS.md)) give every
  inserted item a permanent id at insert time, and later operations reference
  the id, never the position. Our version: the layer stamps `data-lahe-id`
  onto the element in the live DOM the moment the reviewer touches it. Queue
  entries then carry the id, and no amount of deleting, swapping, or
  reordering ahead of them in the queue can move it. The layer owns the
  browser DOM, so this costs no source write at click time; the agent writes
  the stamp into the source when it applies the edit, which is what makes the
  id durable across rebuilds too.

The two compose: the click-time stamp solves job 3 inside a session, and the
same stamp written into the source at apply time is the durable layer that
jobs 1 and 2 lean on next session.

## The four families of fingerprinting

Everything found sorts into four families, ordered from most fragile to most
durable.

### 1. Commit to one CSS selector at click time

Who: [Optimizely](https://support.optimizely.com/hc/en-us/articles/4410283960717),
[VWO](https://help.wingify.com/hc/en-us/articles/58870781934745-Working-with-Element-s-Selector-Paths-While-Making-Changes-in-Visual-Editor),
[Adobe Target](https://experienceleague.adobe.com/docs/target/using/experiences/vec/vec-selectors.html?lang=en),
Chrome DevTools "copy selector", Google Optimize (dead).

- The visual editor generates one selector when the user clicks: prefer id,
  fall back to classes, fall back to a structural path with `:nth-child()`.
- Documented as the most fragile family. Dynamic ids and hashed class names
  break them constantly. Optimizely's own troubleshooting doc walks through
  the "selector no longer exists after reload" failure.
- Every vendor's mitigation is the same: settings to ignore dynamic ids or
  classes, and guidance telling customers to add a stable `data-` attribute
  for the tool to target.
- For identical siblings they use positional notation (`:eq()`,
  `:nth-of-type()`). A removed sibling silently shifts the reference to the
  wrong element. Nobody in this family solves that.

### 2. Snapshot many signals at capture time, resolve identity later

Who: [Heap](https://www.heap.io/blog/how-autocapture-actually-works),
[PostHog](https://posthog.com/docs/product-analytics/autocapture) (open
source, so the actual capture code is readable),
[FullStory](https://help.fullstory.com/hc/en-us/articles/4411042289303-What-s-the-difference-between-optimized-and-full-selectors).

- At event time they store a snapshot per ancestor: tag, classes, attributes,
  text, and sibling position, up the tree to `body`. Identity questions are
  answered later against the stored snapshots.
- Closest commercial relative of our approach.
- PostHog filters out Angular's `_ngcontent*` attributes at capture because
  "these update on each build and lead to noise". Their own issue tracker
  ([#2362](https://github.com/PostHog/posthog/issues/2362)) wishes for a
  scorer that prefers `data-* > id > classes > tagnames > sibling
  relationships` and "detects autogenerated ids/class names".
- Surviving a redesign is not automatic even here: Heap's answer is Combo
  Events, where a human manually stitches the old definition and the new
  definition together. FullStory admits its "optimized selectors" are
  "still typically brittle".
- The criticism literature ([Amplitude on
  auto-tracking](https://amplitude.com/blog/why-we-didnt-build-auto-tracking-for-amplitude))
  documents silent breakage on deploys as the norm for this family.

### 3. Redundant selectors, fuzzy matching, and scoring

Who: [Hypothesis fuzzy
anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/), the [W3C Web
Annotation model](https://www.w3.org/TR/annotation-model/), and 25 years of
academic work
([Phelps & Wilensky 2000](https://dl.acm.org/doi/10.5555/347319.346265),
[Microsoft Research keyword anchoring
2001](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2001-107.pdf),
[Robula+](https://dl.acm.org/doi/10.1002/smr.1771),
[Similo](https://arxiv.org/abs/2208.00677)).

- Hypothesis stores three redundant selectors per anchor: an XPath range, a
  character-offset position, and the exact quote with 32 characters of prefix
  and suffix context. Re-anchoring walks down a ladder from cheap to fuzzy,
  and each structural match is verified against the saved quote before it is
  trusted. The quote is the arbiter.
- Their scoring weights, from
  [match-quote.ts](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/match-quote.ts):
  quote similarity 50, prefix 20, suffix 20, position 2. Context counts almost
  as much as the text itself. Position is nearly nothing, kept only as a
  tie-breaker among identical matches. That is independently the same
  conclusion `pointing.js` reached.
- The element-locator research (test automation) shows redundancy plus voting
  consistently beats any single best selector:
  [Multi-Locator](https://www.researchgate.net/publication/273452300_Using_Multi-Locators_to_Increase_the_Robustness_of_Web_Test_Cases)
  broke about 30% fewer references than the best single locator, and
  [Similo](https://arxiv.org/abs/2208.00677) (14 weighted properties per
  element, argmax over candidates) halved failures against a multi-locator
  baseline.
- Even the best version of this family loses anchors at scale. A
  [study of 20,953 real Hypothesis
  annotations](https://arxiv.org/abs/1512.06195) found 22% already orphaned.
  The only full mitigation in the literature is snapshotting the document at
  creation time.

### 4. A cooperating document with written-down identity

Who: Medium (every paragraph gets a permanent id), Notion (every block is a
UUID row), Word (revision ids stamped into the file since 2003,
[OOXML w:rsid](https://ooxml.info/docs/17/17.15/17.15.1/17.15.1.70/)),
Vue scoped styles
([data-v- hashes](https://vue-loader.vuejs.org/guide/scoped-css.html)),
CMS visual editors (next section).

- This family has no re-anchoring problem at all. Identity is written down
  instead of inferred. Medium highlights bind to a paragraph id and survive
  any edit to the paragraph's content by construction.
- It requires the ability to write the document, which the other three
  families exist to avoid needing. LAHE has that ability.

## The identical-cards case specifically

The findings are unanimous, and nobody solves it by being clever:

- Every tool in families 1 to 3 eventually falls back to position for
  identical siblings, and every one that discusses it calls position the least
  trustworthy signal.
- [Playwright's selector
  generator](https://github.com/microsoft/playwright/blob/main/packages/injected/src/selectorGenerator.ts)
  is the most principled: a positional index is scored 10,000 against 1 for a
  test id, it refuses any index above 5, and it prefers searching for a
  distinguishing ancestor to scope the match down to one element. Their docs
  say the quiet part: with positional selectors, "when your page changes,
  Playwright may click on an element you did not intend."
- Hypothesis weights position 2 out of 92 when choosing among repeats.
- The only systems where a swapped or removed card can never fool the anchor
  are the family-4 systems with written-down identity.

Our design in `pointing.js` (position can order candidates but never decide,
and no answer without a clear margin over the runner-up) is the same conclusion
these systems reached independently. The research does not overturn it; it
confirms it and says the ceiling of that approach is real.

One user-study finding worth stealing. [Microsoft Research tested re-anchoring
on real
users](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2001-107.pdf)
and found they strongly prefer an honest "I lost this one, here's my best
guess" over a confident placement in the wrong spot. Their system had three
outcomes, not two:

- Confident: silently re-anchor.
- Middle band: orphan the annotation but show the best candidate as a guess
  the user can accept, adjust, or reject.
- Low: orphan with no guess, because low-quality guesses tested worse than
  nothing (median rating 1.0 out of 7).

Hypothesis reached the same place: orphans are kept and shown in a dedicated
tab, never silently dropped. We currently have two outcomes (place, or
nothing). A visible best-guess tier for comments could be worth adding.

## Writing identity into the document

### Pros

- It is the only complete fix for rebuilds and identical siblings.
- Production precedent is strong. Every Vue app with scoped styles ships a
  build-generated `data-v-xxxx` attribute on every element, and the web has
  tolerated that for a decade. Word has stamped revision ids into documents
  since 2003. Notion and every block editor since assign an id per block.
- A cautionary tale in our favor: React kept element-to-source identity in its
  own private runtime (`_debugSource`) instead of the DOM, and React 19
  [deleted it](https://github.com/facebook/react/issues/31981), breaking the
  whole click-to-source tool ecosystem. Tools that wrote `data-*` attributes
  into the DOM
  ([react-dev-inspector](https://react-dev-inspector.zthxxx.me/docs/compiler-plugin))
  kept working. Identity in the document outlives identity in anyone's
  runtime.

### Cons, all documented in the wild

- **Diff noise.** Word's revision ids are the classic complaint: they churn
  [every docx diff](https://paulhammant.com/2015/07/30/git-storing-unzipped-office-docs/).
  Under 100 edits per document this is real but small.
- **Duplication on copy-paste.** ProseMirror's community spent years on the
  bug where copying or splitting a block
  [duplicates its unique id](https://discuss.prosemirror.net/t/unique-block-ids-avoiding-duplicates/6188).
  If an agent or a person copies a stamped card to make a new one, two cards
  share an identity. A cleanup scan needs to detect duplicates, not just
  orphans.
- **Stripping.** HTML sanitizers can be configured to drop `data-*`
  attributes (DOMPurify allows them by default but has
  [a flag](https://github.com/cure53/DOMPurify/issues/548)). CDN minifiers
  have destroyed comment-based markers outright: Cloudflare's minifier
  [broke Vue and Blazor](https://community.cloudflare.com/t/omit-formatted-comments-from-minification/18572)
  by stripping their marker comments. Attributes survive minification;
  comments do not.
- **Hydration mismatch.** If the attribute exists in the served HTML but not
  in what a framework re-renders on the client, React and Vue
  [complain and may discard it](https://nextjs.org/docs/messages/react-hydration-error).
  This only bites when the stamp goes into rendered output instead of source.

### The trap: stamp the source, not the output

Stamping the rendered DOM does not survive a rebuild. The stamp has to land in
whatever the page is built FROM.

And for the identical-cards case there is a second layer to that: the template
is one component rendered 20 times, so stamping the template stamps all 20
cards identically. The identity that distinguishes card 7 lives in the data,
not the markup.

Netlify's visual editor (formerly Stackbit) solved exactly this with a
[two-part address](https://visual-editor-reference.netlify.com/annotations):

- `data-sb-object-id` on a container names the source. For their Git-backed
  mode it is literally the file path.
- `data-sb-field-path` names the field, and supports array indices
  (`items.6.title`) to name which entry in the data.

For static HTML documents, which is most of what LAHE reviews, this trap does
not exist and a plain stamped attribute on the element is enough. It only
matters for component-built pages, and there the honest answer may be that the
stamp names the source file plus a data path, not just an opaque id.

### Which attribute

`data-*` with our own prefix, full stop. The convergence is total. Every
system that injects identity chose a prefixed data attribute:

- `data-sb-object-id` / `data-sb-field-path` (Netlify/Stackbit)
- `data-tina-field` ([TinaCMS](https://tina.io/docs/contextual-editing/tinafield))
- `data-sanity` ([Sanity](https://www.sanity.io/docs/visual-editing/visual-editing-architecture))
- `data-vercel-edit-target` (Vercel)
- `data-v-*` (Vue scoped styles)
- `data-testid` (the entire testing world, per
  [Kent C. Dodds](https://kentcdodds.com/blog/making-your-ui-tests-resilient-to-change):
  it works because it carries no other meaning, so nothing else ever has a
  reason to change it)

Why not the alternatives:

- **id**: only one per element, must be unique, and it is load-bearing.
  Fragment links scroll to it, CSS targets it, `label for` and ARIA reference
  it. A document already using ids has no free slot.
- **class**: multi-valued, but CSS matches classes, so an injected class can
  accidentally pick up the site's styling.
- **Made-up attributes** (`lahe-id="..."`): browsers keep them but the HTML
  validator rejects them. `data-*` gives the identical capability and is
  valid.
- **HTML comments**: minifiers and CDNs strip them, and you cannot click one.
- **Invisible characters hidden inside the text** (Sanity and Vercel's
  "stega" trick, zero-width unicode encoding a source reference): both
  vendors document
  [broken string comparisons](https://www.sanity.io/docs/visual-editing/troubleshooting-visual-editing),
  copy-paste contamination, and layout glitches, and both shipped a `data-*`
  escape hatch anyway. Avoid.

Note LAHE already honors this hierarchy: `AUTHOR_ATTR` (`data-review-region`)
is the highest-weighted signal in `pointing.js` at 100. A stamped id would be
a second attribute in that same top tier, ours instead of the author's.

## Upgrades to the fingerprint, regardless of stamping

These apply even if we never stamp anything, and each comes straight from
patterns that appeared independently across the sweeps.

### Detect machine-generated names before trusting them

Five independent tools built this: Playwright's `isGuidLike` id check,
FullStory's numeric stripping, PostHog's Angular-attribute filter, and the
word-like predicates in [@medv/finder](https://github.com/antonmedv/finder)
and
[css-selector-generator](https://github.com/fczbkk/css-selector-generator).

Our `CLASSES` signal (40 points) and `ELEMENT_ID` (90 points) currently give
full credit to a hashed CSS-module class or a random id that changes every
deploy. A "does this look generated?" check (digit and case churn, the same
heuristic Playwright uses) that discounts such names would make those weights
honest on framework-built pages.

### For elements with no words: describe the neighborhood, not the element

The failure case: a reviewer clicks a chevron icon and says "make it bigger,"
and the tool cannot tell which chevron. A wordless element among identical
siblings is the identical-cards problem in miniature, and worse: there is no
text of its own to fingerprint, and its tag and classes are shared with every
sibling.

The research has a consistent answer, and it is not to describe the element
harder. It is to describe where the element lives:

- [Similo](https://arxiv.org/abs/2208.00677), the strongest published element
  re-locator, records 14 properties per element, and for wordless elements the
  ones doing the work are **neighbor text** (the visible text nearest the
  element), geometry (x/y location, width/height, shape), and attributes like
  `alt`, `href`, and `src`.
- [Playwright](https://github.com/microsoft/playwright/blob/main/packages/injected/src/selectorGenerator.ts)
  does not try to make the icon itself unique. When the best selector matches
  several elements, it searches for the nearest ancestor that IS
  distinguishable and scopes through it: "the chevron inside the card titled
  Pricing," not "the third chevron."

What this means for our fingerprint: when the clicked element has no text, the
decisive signals should come from its neighborhood. The enclosing card's
heading or label, the enclosing link's `href`, the element's own `alt`,
`aria-label`, or `src`. Our CHAIN signal walks parent classes already; this
says the walk should also pick up the nearest text the reviewer can see,
because that text is how the reviewer themselves knows which chevron they
meant. And when the neighborhood is identical too, nothing in the literature
does better than position: that is the refuse-or-stamp case.

### For prose passages: fingerprint text by its rarest words

This one applies only where the anchor has words, which is most of a document
review and none of the chevron case above.

The [Microsoft Research
system](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2001-107.pdf)
stored the 3 or more rarest words of the passage, with their spacing, and
re-found anchors by them. It beat exact-string search significantly in user
testing, because rare words and proper names survive a rewrite that changes
everything else. Users themselves key on unique words and proper names, not
surrounding context.

[NYT Emphasis](https://github.com/NYTimes/Emphasis) is the tiny version of the
same idea: a 6-character key from the first letters of a paragraph's first and
last words, compared with edit distance so edits degrade the key gradually
instead of flipping it.

This is a natural evolution of our PREFIX and SUFFIX signals, and it fits the
case that motivated `pointing.js`: a comment on a passage the agent is about
to rewrite.

## What this suggests for LAHE

A layered design, in order of trust:

1. **The stamp** (new). A `data-lahe-id`, minted by the layer in the live DOM
   the moment the reviewer touches an element, so every queued edit carries
   identity instead of position (job 3). The agent writes the same stamp into
   the source when it applies the edit, folded into the review contract so
   every agent knows to do it, which is what makes the id durable across
   rebuilds. On later re-anchors it is decisive, same tier as
   `data-review-region`.
2. **Queue rebasing** (new, cheap). When an applied edit removes or moves
   elements, update the ordinals and paths of every fingerprint still queued
   behind it, ProseMirror-style. Bookkeeping over our own known edits, not
   matching.
3. **The fingerprint** (exists). Unchanged role: the universal layer for
   elements never yet touched, and the fallback when a stamp is missing or
   was stripped.
4. **Refusal and orphans** (exists, could grow). Below the margin, no answer,
   as today. Possibly a visible best-guess tier for comments, per the MSR
   finding that users prefer an honest guess over silence and prefer silence
   over a confident wrong placement.

Plus the two fingerprint upgrades above, and a cleanup story: a scan that
finds stamps (they all share the prefix, so one query finds every one),
detects duplicates from copy-paste, and can strip them all when a document
leaves review, the same shape as `lahe add --remove`.

Open questions for review:

- Should the stamp be an opaque id, or a structured address (source file plus
  path) the way Netlify did it? Opaque is simpler and survives content moving
  between files; structured lets an agent resolve the target with no lookup
  table.
- When does the stamp reach the source: at first edit of an element, or as a
  one-time pass over the whole document at review setup? First-edit is
  minimal cruft; setup-time means even the first comment on an element can
  bind to a source-durable stamp. (The live-DOM stamp at click time happens
  in either case; this question is only about when it gets written down.)
- Do we stamp documents Ken owns only, or any reviewed document? The
  under-100-edits cruft argument holds for owned docs; for someone else's
  page it is more intrusive.
