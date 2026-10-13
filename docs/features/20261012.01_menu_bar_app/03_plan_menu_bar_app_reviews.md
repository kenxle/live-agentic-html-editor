# Plan review: Menu bar app

Reviewer: review-plan (orchestration and test plan). Read: the plan and its three leaves, the brief, the architecture, `CLAUDE.md`, and the code named below.

## Summary

The three-workstream shape is right. The PR split mostly works, with one exception: the plan as written breaks the day-one promise (RF3). The biggest risks sit where two builders implement one thing from prose. The signed proof is written three times, the build recipe twice, and the summary shape is held only by a hand-written fixture. The code also shows two ways the count goes wrong that no row would catch. A background tab clears answers on its first claim (RF1). The summary's cache misses a deleted document (RF2). Two tests would run against Ken's real login items, and one of them stops his live helper (RF5). The Mac screenshots need a stated fallback for when the machine refuses permission (RF11).

Six high, fourteen medium, three low.

---

### RF1 (high): a background tab's first claim marks the page as seen

- **Kind / area / where:** defect, test plan. Task 1.1, rows V3 and V19.
- **Problem:** In `src/layer/sync.js` (`claimRequest`), `quiet` is `attention !== FOCUSED && quietHeartbeatMs !== null`, and `quietHeartbeatMs` starts as `null` on every page load. So the first claim of every page says `quiet: false`, whether or not the tab is focused. The page also reloads itself in the background when its file is rebuilt (the reload path near line 2501). The common flow is: an agent edits the document and replies, the background tab reloads, and its first claim says "focused". The answer is then marked seen without Ken ever looking at it. Task 1.1 says "nothing else in the layer changes", which rules out the fix. V3 takes `quiet` at face value. V19's background case only covers a tab that was already loaded before the reply.
- **Why it matters:** This is the failure Ken named: the count clears for something he never saw (R6, R3).
- **Change to the plan:** Let Task 1.1 add an explicit `focused` field to the claim body, computed as `attentionOf(doc) === FOCUSED` at send time. The seen store reads that field, not `quiet`. A claim without it (an old bundle) falls back to V4's rule. Correct the architecture's sentence about `quiet` first, since the architecture is binding. Add a V19 case that follows `test/browser/quiet_tab_polling.spec.js`: force the page unfocused with `addInitScript` before its first claim, land an agent reply, trigger a background reload, and assert that the count stays.

### RF2 (high): the summary's cache cannot see a deleted document or a Library rename

- **Kind / area / where:** defect, test plan. Task 1.3, row V17.
- **Problem:** Task 1.3 caches each review on the stat of `events.jsonl`, `review.json` and `meta.json`. But the reader decides "missing" from the document on disk (`placeRow` in `src/service/catalog_reader.js` calls `exists(info.docPath)`), and renames live in the catalog store, not in the review folder. Deleting the document, or renaming a row in the Library, touches none of the three cached files.
- **Why it matters:** A deleted document stays under "waiting on you" until something else touches that review. That breaks R5 and R7, and makes a count that never clears (R3). A rename keeps showing the old name.
- **Change to the plan:** Have Task 1.3 recheck file existence and the catalog store's names on every request, or add their stats to the cache key. Add three V17 cases: delete the reviewed document with no other change, and the next summary drops it; rename in the Library, and the next summary shows the new name; rewrite `events.jsonl` with the same size inside the same millisecond, and the cache still rebuilds.

### RF3 (high): splitting into two PRs breaks "day one shows no number"

- **Kind / area / where:** defect, orchestration. PR slicing, rows V1 and V32.
- **Problem:** The architecture writes `seeded_at` the first time the new helper runs. That happens when PR 1 lands, which is before Ken installs the icon from PR 2. Every question and answer between the two landings counts on install day. V32 walks a copy of Ken's state folder, and that copy will already hold PR 1's `seen.json`. So V32 either fails, or the walker resets the file and hides the problem.
- **Why it matters:** It breaks R4 and the brief's first success line ("On the day it is installed, the icon shows no number").
- **Change to the plan:** Seed on the first `summary.read`, not on helper start. Marks written before that are harmless. Update the architecture's `seen.json` section before the code. V1 asserts that seeding happens on the first summary request. V32 starts from a state folder where PR 1's helper has already been running, and the walkthrough states that.

### RF4 (high): a rebuild brings a hidden icon back

- **Kind / area / where:** defect, test plan. Task 3.3, rows V23 and V24.
- **Problem:** Task 3.3 rebuilds and then "restarts the app". A kickstart starts the app even after a clean exit, so a hidden icon reappears. A `git pull` in Ken's main checkout, often run by an agent, triggers that rebuild.
- **Why it matters:** R17 says nothing an agent runs brings the icon back. No row catches this.
- **Change to the plan:** After a rebuild, restart the app only if it was running (check the job's state with `launchctl print`). Otherwise swap the bundle and leave it stopped. Add to V24: with the app hidden, a stamp change rebuilds the app and does not start it.

### RF5 (high): the Mac checks run against Ken's real login items, and one stops his live helper

- **Kind / area / where:** risk, orchestration. Task 4.1, the Step 3 step test, rows V31 and V32.
- **Problem:** SR6 compiles the labels `lahe-helper` and `lahe-menubar` in as constants. Task 4.1 runs `lahe install --menu-bar` on a copy of Ken's state folder. That rewrites `~/Library/LaunchAgents/lahe-helper.plist` to point at the copy, and loads it under Ken's real label. V31's "Stop unloads the helper" runs `launchctl bootout gui/<uid>/lahe-helper` from inside the app. That is Ken's live helper, which every running agent and open review depends on. The Step 3 step test ends with `lahe uninstall`, which removes the real items.
- **Why it matters:** An agent's test run stops Ken's working tool partway through his day, and it may leave his login item pointing at a scratch folder.
- **Change to the plan:** Add a test-only label seam. `install.js` already accepts `d.label` and `d.home` (the earlier spike's unique label). The Swift app takes its labels from a compile-time `-D` flag: still constants, never read from a file, so SR6 holds. Test builds use `lahe-test-<pid>` labels and a temp `home`. State in the builder contract: no agent bootouts, rewrites or uninstalls `lahe-helper` or `lahe-menubar` under the real labels. The real-label install happens once, by Ken or with his go-ahead, at the end.

### RF6 (high): the signed proof is implemented three times from prose, with no test vectors

- **Kind / area / where:** risk, orchestration and test plan. Step 0, Tasks 1.4, 2.1 and 2.3, row V34.
- **Problem:** The summary builder writes the scheme in Node, the macapp builder writes it in Swift, and the macapp builder's `fake_helper.js` writes it a third time, in parallel and from one paragraph. The prose leaves many choices open:
  - the exact string that is signed: route name or path, separators, and the timestamp's unit and format
  - how the nonce is encoded
  - the hash of an empty GET body
  - header names
  - how `summary_version` travels on a GET, and whether the signature covers it
  - whether the key is the secret file's raw bytes or decoded text, and how a trailing newline is handled
  - what the answer's signature covers

  The macapp builder's Swift and fake helper will agree with each other, because one person wrote both. The first time anyone checks them against the real helper is Task 4.1.
- **Why it matters:** One mismatch means the app shows "can't tell" forever. It surfaces only at integration, after both builders have finished.
- **Change to the plan:** In Step 0, write the exact wire into `docs/CONTRACTS.md`: route paths, headers, the canonical string, encodings and the version transport. Commit `test/fixtures/menubar/proof_vectors.json` with a secret, inputs, and the expected request and answer signatures in hex, including a GET with an empty body. Three checks assert those vectors: a Node unit test against `auth.js`, the fake helper's own start-up check, and the Swift `--self-test`. In Task 4.1, run the app once against the real helper on a temp state folder, not only against the fake one.

### RF7 (medium): the summary's shape is held by a hand-written fixture and a shallow key check

- **Kind / area / where:** risk, test plan. Step 0, Task 1.3.
- **Problem:** The architecture's sample response leaves gaps the Step 0 fixture has to invent:
  - where `more` sits for the lists that are arrays (`open_documents`, `recent`, `sessions.connected`)
  - what `sessions.open` counts
  - where the count of open documents lives (R10 says each section "shows its count")
  - whether `library_url` carries the pages port when the port-80 forward is not installed. The app's allowlist depends on this.

  "Check its real output has the same keys" can pass on top-level keys alone. The Swift decoder is only ever tested against the hand-written file.
- **Why it matters:** A drift between Swift and Node shows up as "can't tell", or as an empty menu section, at integration.
- **Change to the plan:** Decide every field in Step 0 and write it in `docs/CONTRACTS.md` beside the proof. The summary test compares nested key paths and value types in both directions: nothing missing, nothing extra. After Step 0 the summary builder owns the fixture and every change to it. In Task 4.1, capture a summary from the real `summary.js` on a fixture state folder and have the app decode it (`--self-test --decode <file>`).

### RF8 (medium): two builders write the app's build recipe

- **Kind / area / where:** risk, orchestration. Tasks 2.3 and 3.1, the Step 3 step test.
- **Problem:** `scripts/check_menubar.js` (macapp) and `src/service/menubar.js` (install) each compile the app, so the swiftc flags, bundle layout, `Info.plist` placement and fixed file list each get written twice. The file list is a constant in install's code, but macapp decides which files exist. This Mac has Swift 6.3, so an unpinned language mode or target can change between Xcode releases. The Step 3 step test also builds "against the macapp branch", which the install builder does not have.
- **Why it matters:** `check:menubar` passes while `lahe install --menu-bar` fails, or the reverse. A file macapp adds is left out of the stamp and the build.
- **Change to the plan:** Put one `buildApp({source, out, runner})` in `src/service/menubar.js`, with the file list and pinned flags (`-swift-version 5`, an explicit `-target`). `check_menubar.js` calls it. macapp returns its file list and flags in its hand-back, and the orchestrator checks them against install's constant at Task 4.1. Move the Step 3 step test that needs macapp source into Task 4.1.

### RF9 (medium): shared files with no owner

- **Kind / area / where:** defect, orchestration. The Workstreams table.
- **Problem:**
  - The summary builder has to wire the seen store into `createReviews` and the summary into the routes. Both are built in `src/service/index.js`.
  - Install's Task 3.3 edits "the timer's call site in the helper". That is `index.js` or `self_stop.js` (`SWEEP_MS = 15 * 1000`). Neither file is owned by anyone.
  - Task 1.4 edits `src/service/auth.js`, but the table leaves it out of the summary row.
  - The table says install owns the `package.json` scripts, while Task 2.3 says the orchestrator adds `check:menubar`.
- **Why it matters:** Two parallel branches edit `index.js`, and the merge conflict appears at integration. Builders also stop to ask who owns a file.
- **Change to the plan:** Give `index.js` to the summary workstream. Install exposes one function (for example `menubar.tick(env)`), and the orchestrator adds its call when it integrates. Ask install to confirm that the always-on helper runs the 15-second sweep at all. Add `auth.js` to the summary row. The orchestrator adds `check:menubar` to `package.json` in Step 0, and no builder edits `package.json`.

### RF10 (medium): manifest entries need `planned: true`, or every builder's first gate fails

- **Kind / area / where:** defect, orchestration. Step 0.
- **Problem:** `scripts/lint.js` fails on any manifest entry with no file on disk unless it carries `planned: true`. Step 0 adds four entries for files that do not exist yet, and does not mention the flag.
- **Why it matters:** `npm run gate:unit` goes red in all three worktrees before anyone writes code.
- **Change to the plan:** Step 0 marks all four entries `planned: true`. PR 1 clears the flag on `summary.js` and `seen_store.js`. The two install files stay planned on main until PR 2, and Task 4.1 clears them. Say this in Step 0 and in Task 4.1.

### RF11 (medium): the Mac screenshots need permissions an agent may not have, and the plan has no fallback

- **Kind / area / where:** risk, test plan. Rows V29, V31, V32, Task 4.1.
- **Problem:** Capturing the menu bar with `screencapture` needs Screen Recording permission for the terminal or host app. Opening another app's status menu with a synthetic click needs Accessibility. Switching between a light and a dark menu bar through System Events needs Automation, and it flips Ken's whole Mac while he works. An agent cannot grant any of these to itself.
- **Why it matters:** V29 and the "light and dark" acceptance line cannot be done, or they get done with a mockup, which `CLAUDE.md` rules out ("a real screenshot from the built page").
- **Change to the plan:**
  - Step 0 probes once whether a capture works (take one small region and check that it is not blank) and records the result on the progress page.
  - Give the app a debug `--snapshot <dir>` mode. It renders each icon look onto a light and a dark background inside the app, which needs no permission.
  - Add `--dump-menu`, which prints the built menu's titles, order, enabled state and tooltips as JSON from a fixture. That makes R8 to R13's order a real assertion instead of a picture.
  - When a real capture is possible, open the menu from inside the app (`button.performClick`).
  - When it is not, the row reads "Ken's screenshot at the walkthrough" and shows on the progress page as waiting on Ken.

### RF12 (medium): real-data screenshots would land in a public repo

- **Kind / area / where:** risk, orchestration. Task 4.1, row V32.
- **Problem:** V32 and Task 4.1 take screenshots on a copy of Ken's state folder. Those pictures show real document titles and `~` paths, and the plan puts them on the progress page, which is committed to this public repo.
- **Why it matters:** Ken's real document names would be published.
- **Change to the plan:** Keep real-data screenshots outside the repo (under `~/Documents`, not `/tmp`) and link them from the review page. The repo's progress page carries only the fixture screenshots from V29.

### RF13 (medium): R2's real failure is a stale number, and no row tests the change from one look to another

- **Kind / area / where:** gap, test plan. Row V29.
- **Problem:** V29 shows each look on its own. The bug R2 guards against is the icon still showing "3" after the helper stops answering. "Just after wake" has no way to trigger it in a test. The architecture's "secret missing or changed: the app rereads it on each 401" has no row.
- **Why it matters:** The app could keep the last number on a timeout, or never recover after the secret changes, and every V29 screenshot would still look right.
- **Change to the plan:** Extend V29 with changes in sequence against the fake helper:
  - from 3 to a timeout, a 401, a 409 and an unsigned answer: the icon leaves "3" within one poll
  - a simulated wake, through a debug flag that posts the wake notification: "can't tell" until a fresh answer arrives
  - the secret file replaced: the app recovers on its next poll

### RF14 (medium): V19's time limits leave no room for the app's 5-second poll

- **Kind / area / where:** defect, test plan. Row V19.
- **Problem:** V19 allows 10 s for a reply to reach the summary and 15 s for it to clear. The app asks every 5 s, so the icon itself could take 15 s and 20 s.
- **Why it matters:** V19 passes while R3 fails at the icon.
- **Change to the plan:** Hold the summary to 5 s for a new reply and 10 s for clearing. Time V32 at the icon, from end to end.

### RF15 (medium): one document reviewed twice would count twice

- **Kind / area / where:** gap, test plan. Task 1.2, rows V9 and V10.
- **Problem:** The Library folds several reviews of one document into one row (`folded_from` in `catalog_reader.js`). Task 1.2 builds the summary one review at a time. Two reviews of the same document would then count as two documents.
- **Why it matters:** It breaks R1 (count documents). V10's equality with the Library's total would then fail, or be quietly loosened.
- **Change to the plan:** Fold with the Library's own rule after building each review. Add to V9: two reviews folded into one Library row count as one waiting document.

### RF16 (medium): the page key the layer sends may not match the key replies are grouped by

- **Kind / area / where:** risk, test plan. Task 1.1, rows V3, V7 and V19.
- **Problem:** Task 1.1 sends "the page's path", meaning `location.pathname`. Records are grouped by `page_origin` plus `page_path`, and `record.js` says `page_path` can be the source's path when the review knows it. V7 says an unknown page marks nothing.
- **Why it matters:** If the two strings differ, focusing a page never clears its answers. Unit tests with hand-written strings would still pass.
- **Change to the plan:** The layer sends the same page path it already stamps on records, computed by the same function. V19 runs on a Markdown review and on a multi-page site review whose path needs encoding (a space, or a mount).

### RF17 (medium): V18's measurement has no stated method, so it cannot be called red

- **Kind / area / where:** defect, test plan. Row V18, Task 4.2.
- **Problem:** The plan does not say how to isolate one browser tab's processor time, or the helper's share spent on summaries. "Measured the same way" leaves the method to whoever runs the check.
- **Why it matters:** Any number can be read as a pass.
- **Change to the plan:** Write the method into the plan:
  - the helper's processor time, from `ps -o time=`, over 10 idle minutes with the app running and again with it stopped. The difference is the summary's cost.
  - the app's own processor time over the same 10 minutes
  - one review tab's renderer process, in a Playwright Chromium with only that page open
  - battery, from `top -stats pid,power` samples

  State the pass rule as a comparison of those numbers.

### RF18 (medium): no named review owners or local gate runs per PR

- **Kind / area / where:** gap, orchestration. Workstreams and PRs.
- **Problem:**
  - PR 1 carries the new auth mode, but the plan does not say who runs the security and code reviews on it, or when.
  - Neither PR names `npm run gate` locally before opening, or again on main after merging. `CLAUDE.md` requires both.
  - `check:menubar` is in no gate, so a Swift break on main shows up only when Ken's helper fails to rebuild.
- **Why it matters:** The acceptance line about "no open blocker in the security review" has no owner. Swift regressions land on main unseen.
- **Change to the plan:** Before PR 1: one code review and one security review of the integrated diff, each with a named owner. Before PR 2: a code review and an independent check of the requirements on the integrated code. Run `npm run gate` locally before each PR and again on main after each merge. Add `check:menubar` to `npm run gate`, where it skips on systems other than macOS.

### RF19 (medium): the leak check counts only helpers

- **Kind / area / where:** gap, test plan. Row V33, the builder contract.
- **Problem:** The macapp and install work starts other things that keep running: the Swift app, `fake_helper.js`, launchd jobs, and plist files in `~/Library/LaunchAgents`. A menu bar app left behind asks for a summary every 5 seconds, indefinitely.
- **Why it matters:** This is the same battery drain `CLAUDE.md` describes, from a new kind of process.
- **Change to the plan:** Extend the before-and-after count to app processes, `fake_helper.js`, `launchctl list | grep lahe-test`, and test plists. V33 asserts that all four end where they started.

### RF20 (medium): install runs on Sonnet against a contract with gaps

- **Kind / area / where:** challenge, orchestration. Workstreams table, the install model choice.
- **Problem:** The plan calls install an extension of existing code. But it carries SR5 (build in a temp folder, then rename into place), SR6 (check the plist before bootstrap), the hide-respecting restart (RF4), a new helper timer, and real launchd behavior that has no pattern in this repo. RF5, RF8 and RF9 land on it too.
- **Why it matters:** Ken's policy uses Sonnet only against a complete contract.
- **Change to the plan:** Close RF4, RF5, RF8 and RF9 in the install packet before dispatch. If any of them stays open, run install on Opus.

### RF21 (low): the app's Start skips the plist check the CLI's start makes

- **Kind / area / where:** risk, test plan. Task 2.2, rows V27 and V31.
- **Problem:** Task 2.2's Start runs bootstrap and then kickstart. The SR6 check of the plist's contents exists only in the CLI.
- **Change to the plan:** Pick one behavior. Either the app makes the same check, or the plan records that the app does not and says why. Test whichever it is in V31.

### RF22 (low): the design review the brief promised is not in the plan

- **Kind / area / where:** gap, orchestration. Acceptance criteria.
- **Problem:** The brief's PM review (RF15) says "the design review is in the plan". The plan has none, and the "staff designer" line has no owner.
- **Change to the plan:** Add a design review of the V29 snapshots and the menu dump before PR 2, with a named owner.

### RF23 (low): small coverage gaps

- **Kind / area / where:** gap, test plan. Rows V21, V3, V14 and V17.
- **Change to the plan:**
  - V21: an existing install plus `--menu-bar` leaves the helper's plist, its process and the rest of `install.json` untouched (R15).
  - V3: a focused second window that is refused the rail still clears its own page (architecture failure mode "Two windows on one review").
  - Add a check that clicking a session row opens that session's most recent document (R10).
  - V14 and V17: use an injected clock for the 30-second window and the expiry of the nonce cache. No real waiting.

## Cleanup needed

None.
