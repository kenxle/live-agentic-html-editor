# Code-lead review: Live Agentic HTML Editor (brief, architecture, plan)

Reviewed against the three documents, the existing `src/` and `test/` trees, the repo's
`CLAUDE.md`, and `README.md`. The question asked here is not "is this a good design" (the PM,
architect and security reviewers already answered that). It is: **if a Sonnet-tier builder
implements this, can I review the result against these documents, or will I be reviewing things
nobody wrote down?**

The design is unusually well specified for the parts that were argued about. The gaps cluster in
exactly the places nobody argued about: the bytes on the wire, the bytes on disk, the exact text a
foreign agent reads, and the mechanics of the one command that ties the whole install together.

Findings are ordered worst first inside each class. Every finding names where it back-patches:
**plan**, **architecture**, or **brief**.

---

## Red flags

### RF1. The library has no way to find the helper after a restart. Back-patches to: architecture (D1/D5), plan (1A)

Plan 1A: "`lahe serve` binds loopback on an **ephemeral port**." Architecture D1: the script line
"points at the built file itself, **never at the helper**." Nothing in any document says how the
library learns the helper's URL.

An ephemeral port changes on every restart. The failure table promises "helper dies mid-review →
on reconnect every unacknowledged event is re-posted", and D5 promises the token "persists across
helper restarts, because rotating it would orphan a page mid-review". Both promises are void if the
page cannot find the port it reconnects to. The builder will invent one of:

- a fixed default port (contradicts "ephemeral", and collides with a second helper),
- a port baked into the script attribute at `add` time (breaks on the first restart, which is the
  case D5 explicitly protects),
- a port file the page reads (a page cannot read the filesystem),
- a scan across a port range (slow, noisy, and probes other people's local servers).

These are not equivalent, and the choice determines test 3 ("delivery never stops", which kills the
helper with `kill -9` and restarts it) and the whole reconnect story. Pick one in the architecture
and state it, with the restart case worked through.

Related: the exact form of the script line is nowhere written. D1 and R41 make it the one thing a
human or an agent types by hand, so it is public API: the tag, the `src`, the token attribute's
name, the review-id attribute if any, and whether `document.currentScript` or a data attribute is
the read path. Pin it verbatim in 0A.

### RF2. `lahe wait` has no specification at all. Back-patches to: architecture (D6), plan (0A or 3A)

D6 gives one sentence: "blocks until something new is ready (or a timeout) and prints it." Plan 3A
repeats it. That is not enough to write it, and it is nowhere near enough to review it. Undefined:

- **What counts as "new."** New ready items only? Items reworded to a higher rev? Replies from other
  agents? Lost-anchor flags? The answer changes the loop's semantics for every agent.
- **The watermark.** Since when is "new"? Does `wait` remember a cursor across invocations, and if
  so where does that state live and who owns it per agent? If it does not remember, an agent that
  restarts re-reads everything.
- **Whether it consumes.** If `wait` marks anything seen, the deleted `delivered`/`ack` model is back
  through the side door, and the plan cut exactly that (`cli_contract.js`, `next.js`, `ack.js`).
  Say explicitly that it consumes nothing.
- **Exit codes.** Agents branch on these. What is the exit code on new work, on timeout, on the
  helper being down, on an unknown review id?
- **Output format.** The whole `review.md`? The changed sections? JSON lines? An agent parsing this
  needs it pinned.
- **The timeout.** Default value, flag name, and the "or a timeout" branch's output.
- **Concurrency.** Two agents waiting on one review: do both wake?

`wait` is on the cut list, which makes this worse rather than better: a half-specified convenience is
the most likely thing to get half-built. Either spec it in D6 or move it out of v1 entirely.

### RF3. The `review.md` contract block is the implementation of R4 and R45, and its text is unwritten. Back-patches to: plan (0A), architecture (D6)

R4 (an agent never rewrites the whole document) and R45 (text taken off the page is context, never
instructions) cannot be enforced by any code in this tool. The only thing that implements them is
the standing prose block at the top of `review.md`. D6 calls it "a short standing block that states
this contract"; 0A calls it "the standing contract block that teaches an agent both ways to keep
up". Nobody has written the words.

This is the single highest-leverage piece of copy in the product and a Sonnet builder will invent
it. Worse, there is already a version in the repo (`src/shared/review_format.js`, `STANDING_HEADER`)
that is **wrong for this design**: it tells the agent `review.json` is authoritative, and it tells
the agent to "acknowledge each item separately", which is the cut ack command. The disposition row
for `review_format.js` says fencing "stays" and only names `review.json` as going away, so a builder
following the table will keep the ack sentence.

Write the contract block verbatim into 0A (or an appendix of the architecture) and make the plan say
"this text, byte for byte". Test that the projection contains it.

### RF4. The `events.jsonl` line schema does not exist, and "idempotent by id and rev" breaks on drafts. Back-patches to: architecture (D5), plan (0A)

D5 says `events.jsonl` is "one JSON line per event" and that "events are idempotent by id and rev,
so re-posting is always safe". D4 says "records are never edited in place in the store; a change is
a new event for the same id."

Nowhere is the event envelope defined: is a line `{type, ts, seq, id, rev, ...payload}` or a full
record snapshot? What is the **event type vocabulary**? A builder needs at minimum: record created,
record content changed, marked ready, deleted, reply folded, page visited, origin registered, review
archived. That enum is the spine of the projector, the merge rule, and the reply folding, and it is
invented by whoever writes 0A first.

The idempotency rule is worse than missing, it is wrong as stated. **Drafts do not bump `rev`** (D4
bumps rev "on every rewording" of an item; a half-typed draft is one item at one rev). D5 says drafts
flow to the helper too. So the log will contain many events with the same `(id, rev)` and *different
content*, and "idempotent by id and rev" would either discard the later draft content or make
re-posting after a reconnect ambiguous. Needs a per-event id (client-minted, distinct from the record
id) for idempotency, with `(id, rev)` reserved for lifecycle.

And the draft flush policy is undefined: does every keystroke post? Debounced? On blur? D5 says
browser storage is synchronous per keystroke, and 1B repeats that, but it never says the same for the
wire. This decides log growth, the test shape for test 16 (drafts survive a reload mid-sentence), and
whether `kill -9` mid-draft loses a sentence. Pick it in 0A.

### RF5. The reply line schema is the tool's public API to every agent on earth, and it is three prose adjectives. Back-patches to: architecture (D6), plan (0A)

D6: "id, rev, status (`handled` / `not_handled` with a reason / `question` with text), an optional
agent name, and what it actually changed." 0A: "id, revision, status, optional agent name, optional
files touched" — which silently **drops the reason and the question text**, the two fields R33 and
R34 exist for.

An external program hand-writes these lines. Every one of these must be pinned exactly:

- Field names, spelled. `rev` or `revision`? `agent` or `agent_name`? `files` or `files_touched`?
  `reason` and `text`, or one `message`?
- Which fields are required per status.
- What the helper does with a **malformed or unparseable line**. The repo ethos is fail loud, but a
  helper that dies on one agent's typo takes the reviewer's session with it. The honest answer is
  probably: skip the line, surface a failure chip on the rail naming the file and line number. That
  is a design decision and it is not made anywhere.
- How the helper **notices** new lines: watch, poll interval, byte-offset tracking, and what happens
  if a file is truncated or rewritten rather than appended to.
- `replies-<agent>.jsonl`: `<agent>` is a **path component chosen by an untrusted-ish writer**. D11
  constrains review ids to a safe character set precisely because they are path components; nothing
  constrains the agent segment, and the helper globs for these files. Constrain it, or discover
  replies by directory scan with an explicit safe-name filter.
- When the filename's agent and the line's `agent` disagree, which wins.

### RF6. CP1's manual walk depends on a Phase 3 task. Back-patches to: plan

CP1: "add the library to `test/fixtures/built-doc.html`, start the helper, leave three comments..."
The `add` command is built in **3B**, two phases later. Its job is to mint the per-review token and
register the origin, which D11 makes a hard precondition for any request reaching a handler. So at
CP1 there is no token, no registered origin, and no way for the library to talk to the helper except
by a mechanism nobody has specified.

Same problem, smaller, at CP2 ("walk it by hand ... with the helper running").

Either move the token-minting half of 3B forward into 1A (it is D11's other half and belongs with the
server checks anyway), or state a Phase-1 developer path for minting a review and say it is
temporary. Do not leave the checkpoint depending on future work.

### RF7. The cut line drops 3B but describes a tool that needs it. Back-patches to: plan

"The cut line" orders 0A, 0B, 1C, 1B, 1A, 1D, 2A, 2B, 2C, then the reply half of 3A. **3B is not in
the list**, and 3C is not either. The paragraph then describes what survives as: "add the library to a
page, comment, type fixes ... copy and export with nothing running". `add` is 3B. Copy and export is
3C. Two of the four capabilities the cut line promises are in tasks the cut line drops.

Fix the ordering, or fix the description. As written a builder under time pressure will ship a thing
that cannot be installed.

### RF8. AC6 contradicts the design it is supposed to accept. Back-patches to: plan (3B, AC6), architecture (Q1's answer in 0A)

AC6: "clone, run **the one documented command**, add the library to a page of their own, and complete
a review. *Fails if:* any step needs a **second command not printed by the first**."

The design as specified needs at least two: `lahe serve` (0A closes architecture Q1 with "the agent
starts it", manual one-liner as fallback) and `lahe add`. 3B's done-when repeats "run one command".

Either `add` starts the helper when it is not up (which is defensible, given `serve` is stated
idempotent), or AC6 relaxes to "every subsequent command is printed by the previous one". Pick one
and make 3B's done-when, 0A's Q1 answer, and AC6 agree.

### RF9. D8's "no library CSS touches the page" and the Custom Highlight API cannot both hold. Back-patches to: architecture (D8), plan (1D, test 15)

The CSS Custom Highlight API needs two things: a registration (`CSS.highlights.set(name, highlight)`,
scriptable from anywhere) **and a `::highlight(name)` style rule that applies in the tree the
highlighted nodes live in**, which is the page's own document. A stylesheet inside the library's
shadow root does not style page text.

So the library must add a stylesheet (a `<style>`, or an adopted stylesheet) to the reviewed
document. That is in direct tension with D8's "all library UI lives in a shadow root ... the
library's CSS cannot touch the page" and with the way test 15 is phrased ("zero host elements
carrying a library class or a style attribute after a session").

Name the exception in D8: one library-owned stylesheet in the page document, containing only
`::highlight()` rules, marked, and removed on teardown. Then test 15 can assert that it is the *only*
page-level addition rather than asserting zero. Also note that `CSS.highlights` is a global name
registry: pick a namespaced highlight name so a page using the API itself does not collide.

### RF10. Commit-on-unload and D11's required custom header conflict. Back-patches to: architecture (D5, D11), plan (2A)

D5 and 2A: "an open edit commits automatically on navigation or unload (kept synchronously in browser
storage, **handed to the helper on the way out**)."

D11 requires every request to carry a custom header and a JSON content type. The standard unload
delivery mechanism, `navigator.sendBeacon`, **cannot set custom headers** and cannot set an arbitrary
content type beyond a small set. A builder reaching for the obvious tool will either drop the header
(silently breaking D11's "no exceptions") or watch the beacon get refused and never notice, because
it is unload, so nothing is watching.

The workable path is `fetch(..., {keepalive: true})`, which does allow headers, at the cost of a
~64KB body limit that a large `after` can exceed. Say so in D5, and give the oversize fallback
(browser storage plus re-post on the next load, which R1's navigation clause already covers).

### RF11. The lifecycle states disagree between the plan and the architecture's own diagram. Back-patches to: plan (0A), architecture (Data and state)

Plan disposition for `shared/lifecycle.js`: states become "draft, ready, handled, not_handled,
**question, reopened**". The architecture's state diagram has four nodes (draft, ready, handled,
not_handled) and models reopen as a *transition* (`handled --> ready: reviewer reopens`), with no
`question` node at all. D6 makes `question` a *reply status*, not an item state.

0A is the task whose entire job is "the lifecycle table with its actor column ... as code". It cannot
be right when the two source documents give two different state sets. Reconcile before 0A starts:
most likely `question` is a reply status that leaves the item in `ready`, and `reopened` is a
transition, not a state.

### RF12. Test 25 (file drop) has no requirement and contradicts D3. Back-patches to: plan (test 25), or delete it

"A file dropped onto the page from the desktop does not navigate the page and does not reach disk"
maps to 2A. No requirement in the brief mentions drag and drop. Making it true requires intercepting
`dragover`/`drop` on the page, which is exactly the "no intercepted events, browse is the page
untouched" law that D3 and 2C are built on, and R13 ranks above editing convenience.

Also, "does not reach disk" is a property of the *helper*, not the page: nothing in the library can
write to disk. Either drop the test, or add the requirement and design the interception explicitly as
an exception to D3.

### RF13. `docs/CONTRACTS.md` is cited by 21 source files and does not exist. Back-patches to: plan (0A)

Confirmed: 21 files in `src/` carry "Dual-environment module. See `docs/CONTRACTS.md`, 'How a shared
module loads'." `docs/` contains only `features/`. The plan spots this and assigns it to 0A ("writes
it or retargets the references"), which is right; flagging it here only to say the choice matters:
the UMD-ish dual-environment wrapper at the top of every shared module *is* a real contract (browser
attaches to `root.LAHE.<name>`, Node uses `module.exports`), every Phase 1-3 builder will copy it,
and if it stays unwritten they will each copy it slightly differently. Write the file; do not
retarget.

---

## Suggestions

### S1. 3C has no "done when". Back-patches to: plan

Every other task carries a done-when. 3C (the Edits tab, copy, export) has none. It also owns two
acceptance criteria (AC7, and R10's half of AC1) and test 22. Give it one; the obvious shape is test
22's: export bytes with no helper running are byte-identical to the helper's projection for the same
records, and the export carries the "this page's slice" label.

### S2. Phase 4 is a box on a diagram. Back-patches to: plan

"Phase 4: acceptance walks, then cleanup batch" has no task id, no owner, no done-when, and no
statement of who the "evaluator who did not build the code" is or how they are dispatched. It carries
AC1 through AC8 and the entire batched deletion, which is the one step in this build that removes
files. Give it 4A and 4B with done-whens, and say who scores.

### S3. Both inventory counts in "What already exists" are wrong. Back-patches to: plan

- "the shared kernel is mostly keep or rework (**12 of 14**, with only the CLI contract cut)":
  `src/shared/` has 14 files and exactly one cut, so it is **13 of 14**.
- "the test harness survives almost whole (**23 of 26 files kept**)": `test/` has **37** files. Two
  are cut and eight are reworked, so **27 of 37** are kept.

Small in themselves, but these numbers are the summary line a reader trusts instead of reading the
table, and the table is the contract for what a builder may touch.

### S4. `scripts/` is missing from the disposition table. Back-patches to: plan

`scripts/build-layer.js` and `scripts/lint.js` are not in either disposition table, yet D1 depends on
the build script (concatenation order comes from `shared/manifest.js`, which *is* in the table as
Rework with "the file list changes with this plan's tasks"). Someone has to update the build script's
expectations when the manifest changes, and no task owns it. Also `npm run gate` includes
`check:layer`, which fails the moment `dist/lahe-layer.js` is stale, so every builder who touches a
layer file must rebuild. Say that out loud in the three binding rules.

### S5. "Basic formatting only" (R26) is never defined anywhere. Back-patches to: brief or architecture

R26 says "basic formatting only. Anything beyond the basics can be asked of the agent." R26 appears
zero times in the architecture and zero times in the plan; 2A says "Basic formatting only" and stops.
A builder must invent the list. It matters concretely, because R31 (a formatting-only change is still
a change) and D7's structural-comparison branch both key off it: the set of formats is the set of
things the structural comparator must distinguish. Name them: bold, italic, and what else. Link?
Inline code? Heading level?

### S6. The per-item versus per-file fencing delimiter disagrees with the code the plan says to keep. Back-patches to: plan (`review_format.js` row)

D6 and D12 both say "random **per-item** delimiters (so page content cannot close its own fence)".
0A repeats "per-item". The existing `src/shared/review_format.js` is explicitly **per-file** ("The
per-file delimiter is passed in, so the service can use a CSPRNG and a test can pass a fixed value"),
and its disposition row says "Fencing, per-item random delimiters, and field classification are
exactly D12 and stay". They do not stay; per-file has to become per-item. Say so in the row, or the
builder will read "stay" and keep the per-file behavior.

Two smaller things in the same module that the docs never name: `BEFORE_MAX = 2000` is the bound test
19 asserts against ("quoted page text is bounded with its **marker visible**") and neither the number
nor the marker text is in any document; and `escapeDataLine` only escapes lines whose *leading*
content is the delimiter, which is worth a second look now that reply text (RF5) also flows through
the fence.

### S7. The reply-poll transport straddles 1B and 3A. Back-patches to: plan

D6's reply channel is split: 1B builds the sync client (Phase 1), 3A builds replies and folding
(Phase 3) and says "the library polls for replies". 1B's done-when says nothing about the poll, so it
will be stubbed or absent, and 3A will need to edit a file 1B owns, which the plan's own rule
("a builder that needs a file it does not own asks the orchestrator") flags as friction. Either give
1B the poll loop against 0A's stubbed reply shape, or state that 3A takes ownership of `layer/sync.js`
at CP2. The polling interval and the cursor shape (a `seq`, a timestamp, an ETag) should be pinned in
0A's wire section either way; it is currently absent from the "The wire" bullet, which lists routes,
headers, checks and error shapes but no success or cursor shape.

### S8. Second-window refusal has no named mechanism and no stale-lock recovery. Back-patches to: architecture (D5), plan (1B)

D5 refuses a second window "with a reason pointing at the first". Test 18 maps it to **1A and 1B**,
so the two builders will each assume the other owns the detection. The mechanism matters: a browser
mechanism (BroadcastChannel, a Web Lock, a storage heartbeat) and a helper-side mechanism (a session
per review) fail differently. And nothing states the recovery path when the first window died without
closing cleanly, which is the ordinary case after a crash. A reviewer locked out of their own review
with no override is a work-losing outcome in a tool whose whole thesis is never losing work. State
the mechanism, the heartbeat, and the takeover affordance.

### S9. The protection veto hook is unnamed, and testing it changes a "Keep" fixture. Back-patches to: plan (2B, `repaint-engine.js` row)

D7 and 2B both say the library "vetoes the morph of that element before it happens **where the
framework offers the hook**". No framework and no hook is named. Turbo's cancelable
`turbo:before-morph-element` and `data-turbo-permanent` are presumably meant; say so, since the
cooperative-skip layer and the veto layer are two different Turbo features and a builder can easily
implement one and believe they did both.

Test 1 then requires running "on all three protection layers separately, including the flavor with no
veto hook", which means `test/fixtures/assets/repaint-engine.js` must grow a cancelable pre-morph
event. Its disposition row says **Keep**, "harness-owned and unaffected by the redesign". It is
affected. Move it to Rework and give the change to 0B, or 2B will edit a fixture it does not own.

### S10. Test 3's "static assertion" has no stated mechanism. Back-patches to: plan

"Plus a static assertion that no control anywhere gates a record on the helper being reachable." I
cannot review an implementation of that sentence. Is it a lint rule? A grep for `await` around the
sync client in the record path? A runtime assertion with the helper stubbed to reject? Name the
instrument. As written, a builder writes a comment and calls it done.

### S11. AC4's "machine sleep simulated by suspending the helper process" does not test the requirement.

R1 names "a machine sleep immediately after a keystroke", and the risky half of that is the
**browser's** timers, pending fetches, and storage flush, not the helper's. Suspending the helper is
already covered by the `kill -9` case. If browser suspension is not reachable in Playwright, say so
and state what stands in for it (backgrounding the page, `visibilitychange`, freezing the render
loop), rather than substituting a different failure and keeping the label.

### S12. AC2 names a dependency the repo does not have.

"The evaluator adds the library to a **Turbo-driven app's development layout**, logs in, walks three
screens." There is no such app in this repo and no fixture stands in for one. Either name the app
(steady-thread's dev server is the obvious candidate, and it is Ken's actual story) with the access
the evaluator needs, or build a Turbo fixture and say which task owns it. As written, AC2 is not
runnable by an evaluator who did not build the code.

### S13. `README.md` still claims macOS and Chromium. Back-patches to: plan (3B)

The architecture's "code already in the repo" section says the `CLAUDE.md` claim is corrected, and it
is. `README.md` line 6 still says "Targets macOS and Chromium for v1", which contradicts D1, R42, and
the plan's cross-browser lanes. 3B rewrites the README but is only told to add requirements and
reasons. Tell it to fix the claim.

Also minor and in the same family: `CLAUDE.md` describes the gate as "lint, unit tests, and browser
tests", omitting `check:layer`, which `package.json` runs and which is the check most likely to fail
a builder unexpectedly.

### S14. 0A is one serial task carrying most of the design surface, with one weak gate.

0A produces the record shapes, the lifecycle table, the merge rule, the normalizer's second mode, the
whole wire, the `review.md` format, the reply format, the gesture table, six stubbed subsystem APIs,
and answers to two open questions. Everything else in the build reads it. Its done-when is "the gate
is green" plus two specific tests. The gate's lint is `node --check`, a syntax check, so "gate green"
means very little for a task that is almost entirely contract definition.

Suggest an explicit contract-freeze read of 0A's output (a second pair of eyes on the field names,
the event enum, the reply schema, and the contract block text) before CP-A opens the fan-out. Every
one of the RF items above is cheap to fix in 0A and expensive to fix at CP2.

### S15. Anchor widening has no stated stopping rule. Back-patches to: architecture (D9), plan (1C)

D9's "enough surrounding context to make it unique" and "no scalar threshold anywhere" are the right
posture, but widening still needs a unit (words? sibling elements? block boundaries?) and a stopping
rule (widen until unique, or until the containing block is exhausted, then declare failure). 1C's
done-when is corpus-based and genuinely checkable, which saves this from being a red flag, but the
"mechanically generated transformation set" it is also judged against is undefined: which
transformations, and what is the pass bar? Name three or four transformation classes (whitespace,
reordering of siblings, insertion of a duplicate paragraph, deletion of a neighbour) and the bar.

---

## Questions

### Q1. Is a review per page, per file, or per app, and what does a second `add` on the same file do?

D5 says a review "starts when the add step mints it". 3B's `add` on a static file writes the script
line; on a dev server it prints a layout line covering many pathnames. So a dev-server review spans
pages and a file review is one page. What happens when a reviewer runs `add` twice on the same file:
a second review, or the existing one reused? And what happens when the same script line (one token)
is served from two different origins (`localhost:3000` and `127.0.0.1:3000`)? D5 says browser storage
is keyed by review id precisely so those are not two buckets, but D11 registers "the page's origin"
singular with the helper. One of those two has to accept a set.

### Q2. Does 0A's "one section per pathname" collapse different origins?

"Query strings and fragments collapse into the pathname." Two dev servers on different ports both
serving `/dashboard` would collapse into one section. Probably not a real case for one reviewer, but
say whether the section key is the pathname or the origin plus pathname.

### Q3. Is the source hint cut or kept?

3B mints and records it, 3A renders it in the section header, 0A defines the header format, and "The
cut line" lists "Source hints on page headers" as shippable-without. That reads as: keep the capture,
drop the rendering. If so, say it, because a capture nobody reads is a field three tasks maintain for
nothing. Also, the hint's *format* is undefined everywhere: a file path, a directory, a glob, or a
mapping from URL pathname to template path. On a Rails dev server one pathname maps to a layout plus
a view plus partials, so a single string may not be the right shape.

### Q4. R8 says work reaches the agent with nothing running. Does copy-and-export satisfy that?

The architecture grounds R8 with "the library works alone ... copy and export carry it out". Copy and
export are human actions. If the helper never runs, nothing automatically reaches an agent. That may
be exactly what Ken means (R10 is the "take it elsewhere by hand" requirement, and R8 is "it is there
when something starts"), in which case the architecture's pairing of R8 with copy/export is just
loose wording. Worth confirming, because it is the difference between a durability claim and a
delivery claim.

### Q5. R14 says the library changes nothing about how the page looks. The rail and the highlights do.

D8 is honest about it: "identical ... to the pixel, **except painted highlights and the fixed rail**".
That is the right trade and nobody would argue with it, but R14 as written in the brief is an
absolute, and AC1 fails the build if "the page's layout differs by a pixel". Test 15 already resolves
this correctly ("zero diff **outside the rail's bounds**"). Soften R14's wording in the brief, or add
the exception, so AC1 and test 15 do not read as contradicting each other.

### Q6. Three requirements are never cited in either downstream document: R16, R26, R30.

R16 (the comment box takes focus immediately) and R30 (two separate edits stay two separate edits)
are both structurally implemented and tested (1D's "already focused", 2A's done-when and test 13);
they are just uncited, which is a traceability nit rather than a gap. R26 is the real one, covered in
S5. Also uncited in the plan, though structurally satisfied by the design's shape rather than by any
task: R2, R4, R6, R8, R14, R15, R19, R22, R24, R25, R33, R35, R40, R41, R45. R4 and R45 are the two
that worry me, for the reason in RF3: their only implementation is prose nobody has written.

### Q7. "Five phases, fourteen tasks" — I count twelve.

0A, 0B, 1A-1D, 2A-2C, 3A-3C is twelve. Phase 4 presumably carries two more, which is S2's point:
name them.

---

## Cleanup needed

Nothing to delete from this review. The plan's own Cleanup needed list is correctly formed and
correctly deferred; it matches the repo's no-`rm` rule. One note on it: `test/fixtures/sample.html`
and `test/browser/sample.spec.js` are on the list, and both are currently referenced by nothing else
I found, so they are safe. `src/shared/cli_contract.js` is referenced by `src/cli/commands/next.js`
(also cut) and by the protocol's `review.next` route description, which 0A rewrites, so the six cut
files come out as one connected batch and nothing kept points into them after 0A lands.
