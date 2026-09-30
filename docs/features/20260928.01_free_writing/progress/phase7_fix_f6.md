# Phase 7, fix round F6 (checkpoint gate regressions): progress

Summary: all six items are fixed on `free-writing-f6`. One was a real product regression (protection of an agent's rewrite). The rest were test problems:

- two specs checked where `contenteditable` sits, which the architecture moved on purpose
- three specs reached Ken's own installed helper on port 7817
- one Firefox spec failed on main too, from a broken noise generator

The six spec files pass in Chromium, Firefox and WebKit (69 passed, 0 failed). `npm run gate:unit` is green (1787 tests, 1785 pass, 0 fail, 2 todo). `dist/` was rebuilt for the runs and is not staged. No documented decision changed.

Baseline: main's merge base with this feature, `97a8270`, in a worktree at `.claude/worktrees/fw-baseline`. There, items 1 to 5 pass in all three browsers, and item 6 fails in Firefox (5 of 5).

| Item | Kind | Baseline on 97a8270 | Fix |
|---|---|---|---|
| 1. cp2_mid :245, an agent rewrites the block the reviewer is in | Product regression | Passes, 3 browsers | `protect.js` |
| 2. editing_two_regions :150 (R30) | Test update | Passes, 3 browsers | spec |
| 3. selection_popover :250 | Test update | Passes, 3 browsers | spec |
| 4. framed_boot :36 | Test environment | Passes, 3 browsers | spec |
| 5. rail_second_window :71 and :153 | Test environment | Passes, 3 browsers | spec |
| 6. oversized_records :101, Firefox | Test bug, not this feature, not flake | Fails in Firefox 5 of 5 (branch: also 5 of 5) | spec |

## 1. Protection lost the agent's rewrite (product regression)

Every edit session is a run session now: `editing.js` marks protection with `blocks`. The run restore (`runRestore`) rebuilt the anchor from the snapshot without first recording what the page had written there. The single-block restore always recorded it as `displaced`. So an agent rewriting the block the reviewer was in was taken off the page with no trace. The commit pass never saw the collision, so no card was flagged.

Fix: `runRestore` now records the anchor's displaced text and markup before rebuilding, by the same rule as the single-block restore. It only does this when the anchor is still the element the session is on and its words or markup differ from the snapshot. A node the repaint built fresh is the server's version, not a change made under the reviewer, so it is not recorded. Commit `b1a9d09`.

## 2 and 3. contenteditable is on the host now (test updates)

The architecture ("The editing host") makes the nearest ancestor that holds the anchor and its run editable, with a `beforeinput` guard. In both fixtures that host is `body`. So "the block has `contenteditable=true`" and "body has no `contenteditable`" test the old design.

The specs now assert what the requirement protects:

- editing_two_regions: the session's `blockId` is `alpha` and `alpha` carries `data-lahe-protected`. One host carries `contenteditable=true` and `spellcheck=false`, and it holds both paragraphs. `beta` carries only its own `id`. A keystroke aimed at `beta` changes nothing on the page and makes no record for it. The frame checks still pass after that keystroke, so the session stayed open and the guard did the refusing.
- selection_popover: the session's `blockId` is `reset-scratch`, it is the only `data-lahe-protected` element, it sits inside the edit host, and there is exactly one `contenteditable=true` element on the page.

Commit `c34a0aa`.

## 4 and 5. The "no helper" specs reached Ken's installed helper (test environment)

Ken's own `lahe` helper was running on `127.0.0.1:7817` with service contract 13. This branch's layer needs 14. `framed_boot`'s fixture names 7817, and `rail.html` with no `helper` query uses the default, which is also 7817. Since design call 9, the layer reads `/lahe/v1/health` before claiming. It found contract 13 and refused with `HELPER_CONTRACT_OLDER`. I confirmed this: the framed page's failures were exactly `["HELPER_CONTRACT_OLDER"]`. On main there is no contract check, so the same helper only caused a token failure, which these tests do not look at.

The product did what design call 9 says, so the product stays. The specs now refuse connections to `127.0.0.1:7817` through Playwright routing, the way an empty machine does. On a machine with nothing on 7817 (CI) they passed already. Commit `5b445d4`.

This affects any "no helper" spec that relies on the default port, whenever a gate runs while Ken's helper is up. Only these three failed in this gate.

## 6. Firefox image size (test bug, present on main)

The spec draws noise into a canvas. It used `seed * 1103515245`, which goes past a double's 53 bits and loses the low bits, and then took the low byte. The result had a pattern. Firefox's PNG encoder compressed it to 70,394 characters, under the test's 100,000 precondition. Chromium and WebKit did not compress it that far. It is deterministic, not flake: it failed 5 of 5 on main and 5 of 5 on the branch.

Fix: `Math.imul` and the high bits, on a 240 by 120 canvas. The image is now 131,938 to 136,346 characters across the three browsers. The rest of the test is unchanged. Commit `01cc515`.

## Commands and results

- Baseline: `npx playwright test <the six specs by line> --project=chromium --project=firefox --project=webkit` on `97a8270`: 23 passed, 1 failed (Firefox oversized).
- `--repeat-each=5 --project=firefox` on oversized :101: main 5 failed, branch before fix 5 failed, branch after fix 5 passed.
- `node scripts/build-layer.js`, then `npx playwright test test/browser/cp2_mid.spec.js test/browser/editing_two_regions.spec.js test/browser/selection_popover.spec.js test/browser/framed_boot.spec.js test/browser/rail_second_window.spec.js test/browser/oversized_records.spec.js --project=chromium --project=firefox --project=webkit`: 69 passed, 0 failed.
- `npm run gate:unit`: 1787 tests, 1785 pass, 0 fail.
- The protection change, checked against neighbouring specs in Chromium (conflict_toast, free_writing_repaint, free_writing_seams, protection_layers, rail_chips, split_not_conflict, typing_caret_vs_repaint). First run: 48 passed, 1 failed (free_writing_repaint :76 on md_render). Second run: all passed. `free_writing_repaint` with `--repeat-each=5` in all three browsers: 60 passed. I read the one failure as load-related, but the checkpoint run should watch that test.

## Cleanup needed

- `.claude/worktrees/fw-baseline`: the baseline worktree at `97a8270` (detached), with its own `node_modules` symlink and rebuilt `dist/`. Remove with `git worktree remove`.
- `node_modules` symlink in this worktree (never committed).
- `test-results/` in both worktrees (gitignored Playwright output).
- `.gate_all_output.txt` in this worktree (untracked input, not committed).
