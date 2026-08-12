# Architecture review, v2 (continuous flow)

Reviewed: `02_architecture_live_agentic_html_editor.md` against the approved brief (R1-R45), the three
research files, the archived v1 draft and its two review rounds, and the ~10k lines of Phase 0 code
already in `src/` and `test/`.

Verdict up front: the flow model is the right shape and D3 (browse fully native) and D7 (protect, then
replay) are the two decisions worth keeping. But the restart threw away work that the v1 reviews had
already bought, the doc is silent about the code that already exists, and four of the six focus areas
have a concrete interleaving or merge case that loses or duplicates the reviewer's work as written.

Findings are ordered worst first inside each category.

---

## Red flags

### RF1. The doc never says what happens to the 10k lines of code already in the repo

`src/` holds a full Phase 0 kernel built to the v1 send model: `shared/protocol.js` (routes
`review.send`, `session.mint`, `review.next`, `served.document`), `shared/cli_contract.js`
(`next`/`ack` exit codes), `shared/manifest.js`, `service/verification.js`,
`service/review_writer.js` (review.md + review.json), `service/state_dir.js`, `cli/commands/*`, plus
the layer stubs. The repo's own `CLAUDE.md` says "the architecture doc's Key Decisions (D1-D16) are
binding" and "v1 targets macOS and Chromium only". The v2 doc has D1-D12, says cross-browser, and
deletes send, sessions, served mode, verification, `review.json`, and the CLI, without mentioning any
of it.

Failure: a planner has to invent the disposition of every existing module, and a builder reading
`CLAUDE.md` will implement to the dead design. `playwright.config.js` is Chromium-only with a comment
citing the old architecture, while D1 claims four browsers.

Fix: add a "what already exists and what happens to it" section, module by module (keep / rewrite /
retire), and state that `CLAUDE.md` and `playwright.config.js` are updated as part of the first task.
Deletions go on a cleanup list, not into the doc as assumed.

### RF2. D5's merge rule, as written, swallows a rewording (the exact bug the v1 review caught)

"On load, the library merges both: its own undelivered work from browser storage wins on content, the
store wins on status."

Walk it: reviewer marks a comment ready (rev 1). The library delivers rev 1. Reviewer rewords (rev 2);
the helper is down, so rev 2 is undelivered. Laptop sleeps. An agent reads review.md, handles rev 1,
appends `handled`. Reviewer reopens the page. Content merge keeps rev 2 (correct). Status merge takes
`handled` from the store (rule as written), so the item moves to Done and leaves the thread. The
reviewer's rewording is now marked handled by a reply that never saw it.

D4 has the right rule for the online case ("a reply to rev 2 cannot mark rev 3 handled"), but D5's
merge sentence is written without the rev qualifier, and the merge is the offline path, which is where
this failed last time. Round 2 of the archived reviews called this out by name ("No `rev` field, so an
ack can swallow a rewording"); the fix was `rev`, and the merge rule loses it again.

Fix: state the merge rule with rev: the store wins on status **only for a status naming the rev the
browser holds**. A status naming an older rev is recorded as history on the card and the item stays
outstanding.

### RF3. Two windows on one page share one browser-storage bucket, and drafts never reach the helper

D5's last paragraph says a second window "came out cheap" because the store is the truth and the
helper's per-(id, rev) ordering keeps windows consistent. That argument only covers records that
reached the helper. Browser storage is keyed by review id, one bucket, same origin: two windows on the
same review write the same key. Each window writes on every keystroke from its own in-memory snapshot,
so the last writer clobbers the other window's undelivered drafts and half-written comments (which by
D6 never leave the browser at all, since drafts are not actionable).

The v1 design refused the second tab for exactly this reason, and the existing harness carries
`openTwoTabs` with a comment saying so. v2 reverses the decision without addressing the mechanism.

Fix: either keep the refusal (with a plain reason on the rail) or specify the mechanism: per-window
storage keys plus a `storage`-event merge, or a Web Lock with a single writer window. The claim
"came out cheap" is not true until one of those is written down.

### RF4. Drafts have exactly one durable home, and it is the reviewed app's own storage

D5 puts half-written drafts in browser storage only. R1 says a reload, a tab close, a navigation, a
restart, or a sleep never loses a keystroke, and the doc's whole trust argument is "two stores, each
sufficient alone". For drafts there is one store, and it is the reviewed page's origin storage, which
the app's own scripts own: a sign-out flow, a `localStorage.clear()`, a Turbo cache reset, or a switch
from `localhost:3000` to `127.0.0.1:3000` all take it. The v1 review raised this ("browser storage is
the app's origin's storage, so the app's own scripts can read and clear it"); v2 does not mention it.

Fix: say whether draft events are posted to the helper (recommended: post them, marked `draft`, and
have review.md omit drafts from the actionable list, which satisfies R7 without leaving the draft with
a single owner). Either way, name the app-owns-the-bucket risk in the failure table.

### RF5. Nothing commits an edit when the reviewer navigates away, and browse mode makes navigation one click

D3 says browse is fully native: links navigate. D3 also says an edit is committed by Esc or clicking
outside. A reviewer typing in a block who clicks a link (the whole point of the dev-server story) hits
neither. The record for that block is a draft, so per RF4 it lives only in browser storage, and per D6
it is invisible to the agent. R1 names navigation explicitly.

Fix: add a commit trigger on `pagehide`/`visibilitychange` and on Turbo's `before-visit`, and state
that a navigation commits the open region rather than discarding it.

### RF6. The protected region loses the active veto, so the caret dies exactly where v1's round 2 said it would

D7: "The block is marked so cooperative frameworks skip it (Turbo's own opt-out attribute, honored by
morphing), and a mutation observer restores it if something rewrites it anyway."

The archived round-2 review walked this precise path and concluded that restore-after-the-fact is not
enough: the morph destroys the text node holding the caret before any observer callback runs, so the
restore repaints correct text with a dead caret and an interrupted word, twice a second on a polling
frame. Its fix was an **active veto** on `turbo:before-morph-element` plus a region-relative selection
snapshot restored after any rewrite. v2 keeps the attribute and the observer and drops both the veto
and the selection snapshot, then claims "the caret and the in-progress text survive a repaint of
everything around them". As written that claim is false for the fallback path, which is the path every
non-Turbo framework takes.

Fix: restore the veto and the selection snapshot into D7, and say honestly what the observer fallback
buys (text, not caret) on frameworks with no opt-out hook.

### RF7. A protected region silently hides an agent's landed change

Interleaving: the reviewer is editing block B (protected, morphs vetoed or restored). The agent lands
a change to block B in source. The repaint arrives; the protection discards it for that block. The
reviewer commits; the DOM equals their `after`; replay's three-way compare says `skip_already_applied`
and does nothing. The agent's change to that block never renders and nobody is told. The page the
reviewer is looking at no longer matches source, in the one region they care most about.

Fix: when protection suppresses an incoming repaint of the protected region, record it and surface it
on that item's card on commit ("the page changed under this while you were typing"). That is the same
class of message R5 already requires and the mechanism does not exist yet.

### RF8. The three-way compare has no third state for "an earlier rev of this record was already applied"

D7 compares the DOM against `before` and `after` of the current record. R29 pins `before` to the
wording when the reviewer first touched the region, forever. So on the second rewording:

- rev 1: before = X, after = Y. Agent applies Y to source.
- reviewer edits again: rev 2, before = X (per R29), after = Z.
- the agent's change lands, the page repaints showing Y.
- compare: Y is not Z, Y is not X, so "content changed underneath", collision flagged.

That collision is not real, and the reviewer gets a scary "the content changed" on their own applied
fix. The record needs the set of previously applied `after` values, or the reply must carry what it
wrote so replay can recognise it.

Fix: keep an `applied_afters` list on the record (or fold the reply's "what it actually changed" into
the comparison) and add a fourth branch: matches a previous rev's after, so re-apply the current one.

### RF9. Format-only changes and deletions cannot be expressed in an anchor-plus-text-compare model

Two record kinds in D4 have no replay semantics:

- **Format-only (R31).** D9's anchors and comparisons run over normalized *text*. A bolded word has
  identical normalized text before and after, so the compare returns `skip_already_applied` and replay
  never re-applies the formatting after a repaint, and can never detect that the page moved on. The
  doc says an HTML pair is carried, but the comparison rule is text.
- **Delete (R27).** After the delete is applied, the anchor's text is gone from the DOM. Uniqueness
  matching cannot find "the region that should not be there", so the idempotence check has no way to
  say "already applied" and the surrounding-context anchor is the only handle. Nothing says how.

Fix: state the compare rule per record kind. Formatting compares normalized HTML of the region;
deletion binds to the surviving neighbours and is idempotent when the region is absent between them.

### RF10. Cross-region edits lost the atomic-group fix

Round 2's "Cross-region gestures corrupt intent silently" (select across a paragraph boundary, type,
two blocks merge into one record, replay rewrites the first and leaves the second standing, so the
content shows twice and the agent is told to duplicate it in source) was fixed with "one record per
touched region plus an atomic group id". D4's record list has no group id and D7 says nothing about
multi-region records. R30 ("two separate edits stay two separate edits") is the requirement.

Fix: put the per-region decomposition and the group id back into D4, and the group-atomicity rule
(no member writes unless every member binds) back into D7.

### RF11. `review.md` plus `replies.jsonl` is not sufficient for concurrent agents, and the doc claims it is

D6 is the agent-agnostic story and the non-goals explicitly contemplate several agents at once. Four
gaps:

1. **No claim or lease.** Two agents read the same `review.md` and both act on item 7. R9 ("the same
   feedback is never acted on twice") is defended only at the reply level; the *work* is duplicated,
   in source, by two agents editing the same file. This is the single largest hole in D6.
2. **Concurrent appends to `replies.jsonl` are not atomic.** D5 argues appends are atomic "at this
   size" for `events.jsonl`, where the helper is the only writer. `replies.jsonl` has N uncoordinated
   writers, some of them shell redirects from an agent harness. Interleaved partial lines corrupt
   replies, which is the one file that clears items off the reviewer's screen.
3. **Conflicting replies are undefined.** Agent A says handled, agent B says not_handled, same
   (id, rev). Nothing says which wins or that both are shown.
4. **`review.md` is regenerated continuously while agents read it.** No atomic-write rule is stated
   (the existing `service/review_writer.js` has temp-write-and-rename for exactly this); a
   mid-regeneration read hands an agent a truncated review.

Fix: one reply file per agent (`replies/<agent>.jsonl`) or a claim line appended before work with a
stated expiry; temp-plus-rename for `review.md`; a stated precedence rule for conflicting replies.

### RF12. "The agent reads review.md in a loop" is the failure the brief exists to fix, restated as a hope

The brief's context names "agents did not reliably collect the feedback" as one of the four symptoms.
v2's answer is that the agent reads a markdown file in a loop for as long as the review runs. In
practice an LLM agent polling a file either burns its context re-reading unchanged content or stops
looping. v1 solved this with a blocking `next` command (keepalive on stderr, one JSON payload on
stdout, distinct exit codes for "work", "nothing outstanding", "review ended"), and that contract is
already written in `src/shared/cli_contract.js`. v2 deletes it and does not mention it in Alternatives
considered, which lists only MCP.

R6 (feedback reaches the agent as the reviewer works) and R33 depend entirely on the agent looping.

Fix: keep the file as the contract (it is the right agent-agnostic floor) and add a blocking waiter on
top: `node bin/lahe.js next --wait 300` that returns when there is work. Then say in Alternatives why
the CLI is a convenience rather than the contract, honestly, next to MCP.

### RF13. Nobody owns the refresh (R36)

D7 says "when the agent lands a change and the page updates itself (R36), the same pass runs". Nothing
names what updates the page. On a dev server it is the framework's own reload (hotwire-spark, HMR).
On a static built doc, which is Ken's most common review target, the agent rewrites the `.html` and
nothing tells the browser. The helper is the only piece that could watch the file and tell the
library, and the doc does not give it that job. This was an archived "important" finding and is still
open.

Fix: give the helper a watch on the reviewed file/target and a "source changed, reload" push to the
library, and say per target type what triggers the update.

### RF14. Nothing tells the agent which file to edit

D2 is right that the library must not write the page's file, and it says applying the change to source
is the agent's job "guided by the record's before and after". But an agent handed a review of
`02_architecture.html` will edit `02_architecture.html`, report handled, watch the item leave the
thread, and the next build erases the fix. The archived review called this out and the fix was a
per-target **source hint** captured at setup (also present in the existing `state_dir.js`
`origins.json` shape). v2 dropped it. R23 says a comment carries enough for an agent to find its
subject in the source.

Fix: put the source hint back: per page, in `review.md`, set once at add time (the `add` command asks).

### RF15. A CSP refusal and a dead helper look the same, on the primary target

The library runs in the app's origin and talks to the helper on loopback. Rails' generated CSP
initializer (Steady Thread has one) blocks that `connect-src`, and a blocked fetch is
indistinguishable from the helper being down unless the library listens for
`securitypolicyviolation`. D5 calls helper-down harmless and D11 discusses CORS but never CSP. The
reviewer then sees "kept locally", believes it is fine, and their work never reaches the agent for the
whole session. R12 is the requirement, and the existing `src/layer/sync.js` already encodes the
distinction.

Fix: name CSP in D11, keep the classifier (policy refusal vs helper down), and have the add step print
the `connect-src` line to add.

### RF16. Where the library file comes from is unstated, and the "works alone" claim depends on it

D1 says adding the library is one `<script>` line with a review token as an attribute. It never says
what the `src` points at. If it points at the helper's port, then no helper means no library, which
contradicts the summary's "the library works alone" and the first row of the failure table. v1
resolved this (the built file is copied into the host application's own static assets; see
`src/shared/manifest.js`). v2 leaves it for a planner to invent.

Related and also unstated: the token is embedded in the page. For a dev server that line lives in a
layout under version control, so the token gets committed; and if a static doc is rebuilt by the agent
(the common case), the script line has to survive the rebuild with the same token, or the review id
changes and the browser-storage bucket orphans mid-review.

Fix: state the delivery path (copy the built file into the host's assets, or a file:// relative path
for a static doc), state where the token lives for a dev server, and state the rule that regenerating
a page must preserve the review id.

### RF17. Comment highlights break on every repaint unless something re-resolves them

D8's Custom Highlight API is the right call for R14, but a `Range` points at live nodes. A morph
replaces those nodes, the range's nodes detach, and the highlight silently paints nothing. To the
reviewer that reads as "my comment marker disappeared", which is one of the old tool's symptoms. D7's
replay pass is described only in terms of committed edit records; nothing says highlight ranges are
re-resolved from anchors on every pass.

Fix: add "re-resolve every highlight range from its anchor" to the replay pass, and test it on the
repainting fixture.

### RF18. Undo has no story once an item is handled, and no representation for the agent

D7 says undo reverts the region to `before` and retires the record. R28 is satisfied on the page. But
if the agent already applied the edit to source, the reviewer's undo leaves the source carrying a
change they took back, and no event tells the agent to revert it: a retired record simply leaves
`review.md`. Silently disappearing from the agent's file is the same shape as the burn-down lying.

Fix: an undo of a handled item becomes its own actionable item ("revert this, here is what to revert
to"), not a retirement.

### RF19. R17 (comment on a whole element) has no anchor

D9 defines an anchor as "the normalized text of its region plus enough surrounding context". R17
exists precisely for things with no text: an image, a diagram, a chart. D9 gives them nothing, so R19
(holds its subject when the page changes) and R20 (says so when lost) cannot be satisfied for the
element case.

Fix: state the element anchor: tag plus attributes that identify content (`src`, `alt`, the SVG's text
nodes) plus surrounding text context, with the same uniqueness-or-fail rule.

### RF20. The cross-browser claim is untested, and it contradicts the repo

D1 and the Alternatives entry reject Chromium-only and assert Chrome, Edge, Safari, and Firefox all
work. The whole design leans on browser behaviours that differ meaningfully: `contentEditable` output,
`beforeinput`, IME composition, Custom Highlight API (Firefox shipped it only recently), and
`queueMicrotask` ordering against MutationObserver batches. The test strategy says "real browser" and
the checked-in Playwright config runs Chromium only.

This is not a request to drop the claim. It is a request to be honest about which browsers are tested
and which are best-effort, per R42's demand that a stated limit carry its reason.

Fix: state the tested matrix. If the gate runs Chromium only, then "works in four browsers" is an
expectation, not a property, and the doc should say so.

---

## Suggestions

- **S1.** The failure table's "Agent lands a change under an outstanding edit" row assumes the
  reviewer keeps seeing their text. In the `content_changed` branch the DOM shows the agent's version
  and the reviewer's typing visibly vanishes from the page (it survives in the record and on the
  card). That is symptom one of the old tool as far as the reviewer's eyes are concerned. Say what the
  page shows, not only what the store keeps, and consider keeping the reviewer's text painted in a
  conflict state.

- **S2.** Add the ack-before-replay ordering rule that the v1 design had (an item whose reply has
  landed is retired before the repaint its own change caused). Without it, every landed change shows a
  provisional collision that clears a moment later, which trains the reviewer to ignore collisions.

- **S3.** Say where the helper's data directory is and that it lives outside any checkout, owner-only.
  The existing `state_dir.js` already decided this for good reasons (a student's `git add -A`
  publishing their review history). It is a default that is painful to migrate later.

- **S4.** State that copy/export (R10) produces the same document as `review.md`, from one shared
  formatter. The existing `shared/review_format.js` exists to keep those two from drifting; the v2 doc
  describes `review.md` as a helper projection only, which quietly creates a second format.

- **S5.** Say what "a block" is for Cmd-Shift-E. `src/shared/regions.js` has a definition; the doc has
  none, and a builder picking "the nearest block-level ancestor" versus "the nearest element with only
  text children" gets very different behaviour on a card or a list item.

- **S6.** Pick the formatting mechanism (`document.execCommand` versus manual range surgery) in the
  doc. Round 2 boarded this and it is still open; two builders will pick differently and R26/R31
  depend on which.

- **S7.** R3's named failure is a comma coming back as an em dash. On macOS, `contentEditable` plus
  system text substitution can do that inside the reviewer's own typing. Say whether edit regions
  disable autocorrect/substitution and spellcheck-driven replacement, and note that this is the one
  place where leaving text alone requires an active setting.

- **S8.** Reopening a handled item (the state diagram's `handled --> ready`) should bump the rev.
  Otherwise the original reply still names the current rev and the item can be re-retired by an old
  line the helper folds in again.

- **S9.** The SQLite rejection is right but the reason is slightly off: `node:sqlite` does not exist at
  all on the Node 20 floor D1 sets, which is a stronger reason than "still experimental".

- **S10.** Q1 (does the helper start itself) should be closed in the doc rather than left leaning. It
  changes whether the add step writes a launch agent, and the plan cannot sequence around a lean.

---

## Cuts

- **C1.** Nothing in v2 is over-built; the cuts worth naming are the v1 leftovers the doc should
  explicitly retire so a planner does not resurrect them: `review.json` as a second authoritative
  file, `served.document` mode, session minting, the manifest's six-owner scheme, and
  `service/verification.js` as written. Each is a file in `src/` today. **They belong on a cleanup
  list, not deleted mid-task.** See "Cleanup needed" at the end.

- **C2.** If the second-window support in D5 cannot be specified properly (RF3), cut it back to a
  refusal with a plain reason. It is a nice-to-have that Ken deferred to the architecture, and shipping
  it half-specified costs exactly the trust the feature exists to build.

---

## Questions

- **Q-A.** Are draft events posted to the helper, or do drafts live only in the browser? The answer
  decides RF4, RF5, and half of RF3, and it is the single most load-bearing unstated fact in the doc.

- **Q-B.** What starts a new review, and what ends one? The token persists across helper restarts
  (D11), the review id keys browser storage (D5), and R39 promises an end-of-session list of hand
  edits. If token and review id are the same thing and both persist, "session" has no boundary.

- **Q-C.** When the reviewer walks several origins in one review (a static doc plus a dev server, or
  `localhost` plus `127.0.0.1`), browser storage is per origin. What does copy/export produce with the
  helper down: the current origin's slice, or the review? The doc's R10 claim reads as the latter and
  the mechanism gives the former.

- **Q-D.** Does the library refuse to initialize on a non-local origin? D11 covers what the helper
  accepts, but the script line can be committed into a layout and reach staging or production, where
  it executes in a logged-in visitor's session. The archived security round called the in-snippet
  guard unimplementable and moved the guard into the host template's conditional. v2 says nothing.

- **Q-E.** How many outstanding records does replay re-apply per pass, and what is the cost on a page
  with a two-second poll and eighty records? Every pass re-resolves every anchor with a
  uniqueness check over the page text. The doc treats replay as free.

---

## Requirement coverage sweep

Homed and convincing: R1 (partly, see RF4/RF5), R2, R4, R6, R7, R8, R10, R11, R12, R13, R14, R16, R18,
R21, R22, R24, R32, R33, R34, R35, R37, R38, R39, R40, R41, R42 (claim untested, RF20), R43, R44, R45.

Homed but broken or incomplete as written:

| Req | What it needs | Where it fails |
| --- | --- | --- |
| R1 (nothing typed is lost) | a durable home for drafts, and a commit on navigation | RF4, RF5 |
| R5 (unsent work not silently overwritten) | a fourth compare branch, and a message when protection hides a repaint | RF7, RF8 |
| R9 (never acted on twice) | a claim mechanism for concurrent agents; a rev-aware merge | RF2, RF11 |
| R15 (keeps working as the page changes) | the morph veto and the selection snapshot | RF6 |
| R17 (comment on an element) | an anchor for things with no text | RF19 |
| R19/R20 (highlights hold their subject) | highlight ranges re-resolved every replay pass | RF17 |
| R23 (agent can find the subject in source) | the per-page source hint | RF14 |
| R25/R28 (undo) | what an undo means after the item was handled | RF18 |
| R27 (delete a block) | replay and idempotence semantics for an absent region | RF9 |
| R30 (two edits stay two) | per-region decomposition and the atomic group id | RF10 |
| R31 (format-only counts) | an HTML-level comparison rule | RF9 |
| R36 (page updates as changes land) | an owner for the refresh | RF13 |

Requirement with no mechanism at all: **R26** (basic formatting) is named once as a record kind and
never given an implementation, a vocabulary, or a paste rule.

---

## Reuse claims, checked against the files

- **"The harness already built survives" (Test strategy): true, and stronger than the doc says.**
  `test/fixtures/repainting.html` plus `test/fixtures/assets/repaint-engine.js` really do revert typed
  text on a timer; `test/helpers/caret.js` and `assertions.js` carry the caret-identity and
  no-second-write assertions; `src/layer/replay.js` already exposes the pass counters the doc says
  tests must read; `test/browser/harness_selftest.spec.js` tests the assertions in both directions.
  The doc undersells this: it is the most valuable thing in the repo and should be named as a keep.

- **"the protected-region and replay design, the record shape, and the data-fencing rules survive"
  (What carries over): partly true.** The record shape and fencing survive in `src/shared/record.js`
  and `review_format.js`. The protected-region design does not survive intact: the morph veto and the
  selection snapshot are gone (RF6), and the atomic group id is gone (RF10).

- **`test/helpers/contexts.js` contradicts D5.** It documents `openTwoTabs` as the case "D6 says must
  be refused with a reason". D5 now says two windows are supported. One of the two is wrong and the
  doc does not know the other exists.

- **Repo `CLAUDE.md` contradicts D1 and the Alternatives entry** on Chromium-only, macOS-only, and
  D1-D16. `playwright.config.js` cites the dead architecture in a comment.

## Alternatives considered: honesty check

Send/batch, whole-page contentEditable, wrapper highlights, and writing the reviewed file are all
rejected honestly and for the reasons Ken and the reviews actually gave. Two gaps:

1. **The blocking CLI is missing from the list.** It is the strongest competitor to the file-polling
   contract, it is already specified in `src/shared/cli_contract.js`, and its absence lets D6 avoid
   the question of how an agent knows there is work (RF12). Rejecting only MCP makes the file look
   like the only agent-agnostic option, which is not true.
2. **Verification is deleted, not rejected.** v1 had the helper check that the reviewer's text appears
   in the file the agent named. R9's second half ("something the agent has not actually handled is
   never treated as handled") now rests entirely on agent self-report. Whether that trade is right is
   arguable; making it silently is not.

---

---

## Cross-check against the research on the tool being replaced

The research documents roughly forty concrete failure mechanisms in human-review. The good news is
real: the two structural decisions (D2, the library never writes the reviewed file; D3, browse is
native) delete whole families of them outright. Every save/baseline/409/serializer/revert-race
mechanism has no analogue in v2 because there is no save path. The batch-latch family (a stranded
send disabling the button forever, the frozen snapshot, the un-flushed send) is gone with the send
model. The rail-rebuild-destroys-an-open-textarea mechanism is answered by D10. The toast-only
failure reporting is answered by D10's persistent status line and dismissible chips.

Mechanisms from the research that still have **no home in v2**, beyond the red flags above:

- **Two helpers running at once**, each clearing the other's state. Human-review shipped a fix for
  exactly this (`2740913`). Q1 asks who starts the helper and never asks what happens when two do.
  Needs a lock file and a refuse-with-a-reason second instance (`src/service/state_dir.js` already
  reserves a `lock` path).
- **Old feedback resurrecting.** Human-review re-opened targets and served feedback up to thirty days
  old. v2 has an append-only log with no retention, no pruning, and no statement of what a returning
  reviewer sees on a page they reviewed last month.
- **Helper/library version skew.** Human-review's `8bb9ce4` scar: an upgraded CLI against a stale
  running helper silently serves broken pieces. v2 has a built file copied into a host app and a
  helper started separately, which is the same shape, with no version gate.
- **How the agent is told where `review.md` lives.** Two of human-review's agent-pickup failures were
  in the instruction file, not the code: a wrong invocation written by the installer, and a filename
  the agent never found. R40/R41/R43 cover installing the library on the page; nothing covers writing
  and verifying the pointer that sends the agent to the right review folder. This is the other half
  of RF12.
- **The library's reply poll has no stated interval or bound.** The sequence diagram says "library
  polls for replies" and nothing else. Human-review's standing cost was two polling loops; v2 replaces
  one and leaves the other unspecified.
- **What happens when the agent's own turn ends.** D6 says the agent reads in a loop for as long as
  the review runs. Nothing re-establishes the loop when the agent's session ends mid-review, which is
  the normal case, not the edge case.

## Cleanup needed

Files superseded by the v2 design, left in place per the no-rm rule, for one batched pass once the
plan confirms the disposition:

- `src/service/verification.js` (v1 verification, deleted from v2 with no replacement)
- `src/cli/commands/next.js`, `ack.js`, `open.js`, `setup.js` and `src/shared/cli_contract.js` (only
  if RF12 is resolved against the CLI; otherwise they are a keep)
- `src/shared/manifest.js` six-owner scheme, if the build drops per-file ownership
- the `served.document` / `session.mint` / `review.send` routes in `src/shared/protocol.js` and their
  handlers in `src/service/routes.js`
- `test/fixtures/servers/stub-service.js` (built to the v1 send protocol)

Nothing above should be removed until the plan states what replaces it.
