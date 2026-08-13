# Phase 5 review findings ledger

Five reviewers ran in parallel on the implemented diff (code, security, testing, code-lead,
design re-check). The adversary reads this union and hunts for what they all missed. Then one
consolidated fix wave. Every row here carries a disposition once fixed.

Baseline at review time: gate green, 403 unit, 149 Chromium browser, 447 tri-browser, all
checkpoint + acceptance specs green on three lanes. No reviewer found a blocker that leaks
review data to a remote attacker or writes outside the data directory. The design verdict flipped
to "this is one product and it ships."

## Cross-review clusters (the same defect seen from two angles)

**C1. The second window is not actually refused (code F1+F2, security S3).** Three independent
holes: (a) `sync.start()`'s lock outcome is never inspected, so a refused window keeps editing and
keeps writing the shared storage bucket (last-keystroke-wins loss, the exact thing D5's refusal
exists to prevent); (b) the helper session heartbeat is posted once and never repeated, so the
helper-side defense expires 30s after load; (c) the 409 refusal body discloses the holder's
`window_id`, and replaying it is accepted as the holder's heartbeat, granting a second window in one
extra request (confirmed live). Fix must close all three: inspect the lock and go read-only on
refusal; re-post the heartbeat on an interval; stop disclosing the window id and prove possession
with a server-minted session secret.

**C2. The intent channel is empty for the tool's primary gesture (security S1).** Nothing populates
`change` on an edit commit, so for "fix this sentence" both intent fields (`note`, `change`) project
null and the only thing describing the reviewer's vetted change is the data-class, 2000-char-bounded
`after_full`/`before` the contract explicitly tells the agent never to treat as instructions. That is
the exact D12 laundering the redraw was meant to prevent, plus silent truncation. Existing tests
hand-build `change`, which is why it stayed green. Fix: populate `change` on the edit commit path and
add a pipeline test that drives a real edit and asserts `change` is non-null and verbatim.

## Findings

Severity, source, where, what, fix. B = blocker, I = important, M = minor.

| # | Sev | Source | Where | What | Fix |
|---|-----|--------|-------|------|-----|
| 1 | B | code F1 / sec S3 | sync.js:449-474, index.js:469 | Refused second window keeps writing the shared bucket (C1a) | Await/inspect the lock; read-only mode on refusal (no comment/edit handlers, no item writes, refusal panel) |
| 2 | B | code F2 | reviews.js:249, sync.js:477 | Heartbeat sent once; helper defense expires after 30s (C1b) | Re-post window.claim on a HEARTBEAT_SECONDS interval; stop in sync.stop |
| 3 | B | sec S3 | reviews.js:270-295 | 409 discloses holder window_id; replaying it is accepted as heartbeat (C1c) | Don't return the window_id; mint a server-side session secret, require it on heartbeat |
| 4 | B | test R5 | harness_second_origin.spec.js, protocol_wire.test.js | Read-direction of "cannot be driven from outside" untested; a fork letting read routes skip the token stayed green (code is correct; coverage gap) | Add cross-origin read probe of review.read + replies.poll asserting the attacker received nothing + the helper log names the check, with positive control; add read-route unit cases |
| 5 | B | test AC3 | ac3_walk.spec.js:373 | "Every other item unchanged" compares a snapshot against itself; cannot fail | Capture the others snapshot BEFORE the collision, compare post-commit against it |
| 6 | B | test R10 | agent_replies.spec.js:329 | Offline stale-reply half asserts end-state, not the refusal; really tests the reconnect merge | Read reply.folded events after reconnect; assert last has accepted:false naming rev 1 |
| 7 | I | sec S1 | record.js:319, editing.js, review_format.js:260 | `change` never populated; edits ship no intent field (C2) | Populate change on edit commit; pipeline test asserts non-null verbatim |
| 8 | I | sec S2 | protocol.js:340, auth.js:62/69 | helper.log is log-injectable via newlines in the review id (confirmed live); AC8 rests on this log | JSON.stringify + length-cap every attacker-controlled value before helperLog |
| 9 | I | code F3 | replay.js:223, epoch.js:104 | `takePendingExternal()` has no caller; a repaint landing in replay's own write batch owes a pass that never runs | After each pass / on epoch close, take the pending flag and schedule one more pass |
| 10 | I | code F4 | merge.js:78, store.js | `item.acknowledged` is never set; SAME_REV_ACKED unreachable, browser always wins at equal rev | Stamp acknowledged when the helper's accepted list names the item's current-rev event; clear on next write |
| 11 | I | code F5 | record.js:379 | bumpRev skips history for format_only (after text equals before), so replay branch three misses and flags a false conflict | Dedupe history on comparisonFields(next), push when after OR after_html moved |
| 12 | I | code F6 / sec | failures.js:108 | Refusal copy names a "Review here instead" button that does not exist (takeover always false, no UI) | Build the takeover button, or change the copy to what the product does |
| 13 | I | code-lead 1 | index.js:507, sync.js:521 | teardown never calls sync.stop(); poll timer, window lock, and window-registered unload listeners all leak | Add sync.stop() to teardown |
| 14 | I | code-lead 2 | wait.js:310 | wait exits 0 with zero items + advances cursor when review.read fails: silent permanent skip of outstanding work | On non-empty events but unresolved items, don't advance/print success; retry or exit HELPER_UNREACHABLE |
| 15 | I | code-lead 3 | replies.js:163,170 | NUL-byte hash separators make the file "data": every grep-based sweep silently skips it | Use  / \x1e; keeps the file text, same collision resistance |
| 16 | I | test R3 | (no owning spec) | Nothing asserts records made on both sides of a kill -9 reach review.json (the file the agent reads) | Extend cp1_walk with a review.json survival assertion after the backlog drains |
| 17 | I | test R33 | rail_chips.spec.js:52 | Chip "survives a replay pass" clause runs on a fixture with no replay engine; passes whether or not replay ran | Read replayPasses around the repaints and assert it moved, or move the clause to a replay fixture |
| 18 | M | code F7 / sec | protocol.js:762, sync.js:174 | ITEM_CONTENT never carries reworded/lost, so lahe wait never wakes on an item going lost (dead capability) | Emit lost:true where replay flags an anchor lost, or drop the arms from countsAsNew + the contract |
| 19 | M | sec S4 | add.js:508, index.js:89 | --state-dir bypasses the in-checkout guard (a git add publishes the token) | Route explicit paths through stateDir()'s checkout walk |
| 20 | M | sec S5 | protocol.js:324, index.js:144 | Health route reflects the raw Origin into Access-Control-Allow-Origin; comment claims it never reflects | Return origin:null for AUTH.NONE routes; correct the comment |
| 21 | M | sec S6 | add.js:406 | Helper restart leaves 7817 unbound; a local squatter that answers {ok:true} collects tokens | Page verifies a per-review value the squatter cannot produce; note the residual in D11 |
| 22 | M | sec S7 | tab_done.js:294, replies.js:211 | Agent name and rejection reason reach the rail unbounded (text is plain + labeled, just not bounded) | boundData(CONTEXT_MAX) on both |
| 23 | M | sec S8 | add.js:407 | SIGTERM to whatever pid service.json names, no check it is a lahe helper | Verify started_at / cmdline before signalling |
| 24 | M | sec S9 | review_format.js:289, overlay.js:756 | reply.files passed through with no type check or bound | Filter to strings, cap count, bound each entry |
| 25 | M | code-lead 6 | replay.js:669 | keep_mine on a lost+conflict record leaves a stale region.lost stamp | clearLost + refresh lastElement on keep_mine |
| 26 | M | design N1 | conflict card | Amber badge (loudest block) sits below the buttons: explanation after the decision | Move it above the panes or fold into a quiet line under the title |
| 27 | M | design N2 | conflict card | The two choices aren't weighted equally (outlined button vs borderless text) on the one screen about the reviewer choosing | Give both the same register |
| 28 | M | design F9 | comments.js | Comment box still covers the paragraph below when no gutter exists (partial fix) | Real fallback when there is no gutter to prefer |
| 29 | M | test R28 | (browser half) | No fixture with an instruction-shaped string edited through the real editor (routing + escaping are proven separately) | Add an instruction paragraph to built-doc.html + one assertion in a browser walk |
| 30 | M | code-lead 5 | index.js:363 | replay wired with no hooks: the fold-replies-first ordering guarantee is not enforced (may be intended) | Say so at the wiring point, or supply the hooks |
| 31 | M | code-lead 9 | protect.js:697 | onMutations restores every snapshot key; release evicts only the active one (latent, not live) | Scope restoration to the active region |
| 32 | M | misc | record_fixtures.js:34, protocol.js:523, progress doc | Hardcoded port literal; dead "blur" flush trigger; progress doc says 325 not 403 | Import DEFAULT_HELPER_ORIGIN; drop/ wire blur; fix the count |

## Landed and confirmed (do not regress)

Server-side checks with one call site and no branch-around; constant-time token compare (complete);
filesystem containment + symlink refusal (both halves, pinned); atomic write-beside-rename in both
writers; safe-id on review ids and reply filenames; owner-only modes; per-review tokens across
restarts; origin from header not body; closed shadow root; JSON-file agent contract; every byte-pinned
contract byte-identical; protection three layers; replay four branches; reply folding with the
revision check; the full request-check set; no token in any log line. Design: all 13 findings fixed on
screen, both conflict buttons work, handled highlight clears and repaints on reopen, scheme follows the
page.
