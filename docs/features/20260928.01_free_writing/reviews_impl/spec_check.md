# Spec check: free writing, integrated branch

**Summary.** The code does what the brief asks. Every brief requirement and every fix-round design call has a test that would fail if the behavior broke, and the ones I ran pass. What is left:

- One behavior gap waits on Ken: a force-quit within a few seconds of typing loses the sitting (R5, saved as typed).
- One record-keeping gap: most deviations sit only in the workstream progress files. They are not listed under "Changes from plan" on the progress page.
- The look, the user stories, a real agent, and the three-browser run are for the flow walker and the orchestrator's gate.

Checked on `feat/free-writing` at 6b0f74f, diff base 97a8270. Verdict counts are at the end, from `grep` over this file.

**What I ran:**

- `npm run gate:unit`: 1787 tests, 1785 pass, 0 fail, 2 todo. Both todos are in `anchor_cases.test.js` and are older than this feature.
- `free_writing_r14.spec.js` and `free_writing_seams.spec.js`, Chromium: 31 passed.
- `f1_editing_fixes.spec.js`, `helper_contract_layer.spec.js`, `replay_run_check.spec.js`, and `replay_run_fix_round.spec.js`, Chromium: 35 passed.

Every other browser file named below I read but did not run. The orchestrator's full run covers them.

## Brief requirements

| id | verdict | evidence (test, then code) | gap |
|---|---|---|---|
| R1 write where none exists | pass | `free_writing_empty.spec.js` "hovering a gap shows the line... starts after the right block", "the empty notes page opens ready..."; `free_writing_seams.spec.js` notes tests. Code: `editing.js` `gapAt`, `openAfter`, `openEmptyPage` | Only a notes review can start on an empty page (fix-round design call 2). An empty page opened with plain `lahe review` has no way in: `gapAt` returns null with no blocks and `openEmptyPage` needs the notes flag. This was decided in FIX_ROUND but is not under Changes from plan. |
| R2 feels like today's edit | pass (behavior) | `free_writing_empty.spec.js` "Cmd-Shift-E with the caret in no block shows the bar and its hint"; `regions_gestures.test.js` "Cmd-Shift-E with the caret in no block enters edit state". Code: `editing.js` `buildBar`, label "Editing" | Whether it looks like the same frame and bar is for the walker. |
| R3 paragraphs, headers, lists | pass | `free_writing_types.spec.js` "new text: {type} by {route}" and "an existing block: {type} by {route}", covering all six types by menu, hotkey and shortcut; `regions_gestures.test.js` chord tests. Code: `gestures.js` `BLOCK_TYPES`, `editing.js` type menu | Firefox and WebKit are confirmed only by `gate:all`. |
| R4 page styling | pass | `free_writing_types.spec.js` "new blocks match the page's own computed spacing and type", "a split tail matches... while writing and after commit", "a paragraph retyped to {tag} matches...", on `blog.html` and `md_render.html`. Screenshots in `progress/shots/` (light and dark) | A new `h2` on Markdown compares type only (fonts), since its section rule waits for the rebuild. The acceptance line allows this. |
| R5 saved as typed | **fail (Ken to decide)** | `free_writing_seams.spec.js` "reload mid-sitting...", "crash mid-sitting, renderer", "sigkill-late"; `free_writing_repaint.spec.js`. All pass | The "sigkill" case accepts losing the whole sitting: the test only checks that whatever survived is a prefix of what was typed. Main's progress page gives the cause: long writing now saves after a short pause instead of on every keystroke (the CR 5 fix). This is on main's progress page under "Needs your attention" ("Losing text on a hard kill"). |
| R6 words stay as typed | pass | `free_writing_seams.spec.js` "special characters: the page's text is the typed text..." (checks `< & * _ \` # 1. " ' --` in the record, the source and the page); `free_writing_undo.spec.js` "Cmd-Z right after 1. gives back the typed characters"; `fix_round_f3_projection.test.js` "a projected block's text resolves entities" | The spec's comment about entities in `text` is out of date since F3. It is harmless: the unescape it does is a no-op now. |
| R7 reload mid-writing | pass | `free_writing_seams.spec.js` "rebuild mid-sitting: the reload waits while the sitting is open...", "reload mid-sitting: ... Cmd-Shift-E on a run block reopens it"; `free_writing_repaint.spec.js` "keeps every run block, and the caret's block and offset" | Built to the PQ4 default (what a reload does mid-writing), as Ken decided. |
| R8 agent tells new from changed | pass | `projection_review_json.test.js` "a run's new blocks are projected with their derived words", "a split tail keeps its from_anchor mark", "a run over 2000 characters is projected whole..."; `run_record.test.js` fixture tests. Code: `record.js`, `review_format.js` | none |
| R9a contract says how to place (scripted agent) | pass | `review_format.test.js` "the restated contract in docs/CONTRACTS.md matches the source line for line", "the skill carries the free-writing rules the contract carries"; the scripted agent in `free_writing_seams.spec.js` places runs from `review.json` alone, in Markdown and HTML (`blog.html` worked example) | `npm run install-skills` has not run yet. The installed skill differs from the branch's copy. That is Task 3.6. |
| R9b real agent places correctly | unverified | none automated | The walker has a real agent place a run from `review.json` in both an HTML and a Markdown source. |
| R10 handled is checked | pass | `handled_check_run.test.js` (a missing block is held open whether or not the source was written; the skipped run; raw HTML); `free_writing_seams.spec.js` three "handled check: a real run..." tests. Code: `handled_check.js` | none |
| R11a proofreading (scripted) | pass | `projection_review_json.test.js` "run_words of 150 gives proofread false, and 151 gives true"; `reply_proofread.test.js`; `agent_replies.spec.js` proofreading tests; `free_writing_seams.spec.js` three "proofreading..." cases, including the long run | Deviation, recorded only in `phase7_fix_f3.md`: once the thread holds a proofread question, `proofread` stays false for good. A later sitting that adds more than 150 words to the same record is not offered proofreading. |
| R11b proofreading (real agent) | unverified | none automated | The walker writes more than 150 words, lets a real agent place them, and checks that a proofread question comes back and the source words are unchanged. Then press each button. |
| R12 blank document from the CLI | pass | `write_command.test.js` "lahe write creates a new, empty Markdown file and serves it", "a notes page's served script tag carries data-lahe-notes"; `free_writing_seams.spec.js` "notes page: three sittings on an empty lahe write page..." (the page opens ready to type) | The walker checks that the rail shows on the empty page. |
| R13 notes in a named file | pass | `write_command.test.js` "the one-page server 404s a sibling file, a dotfile sibling, and another review's rendered page", the symlink and hard-link refusals, "lahe review on a notes file keeps the one-page server"; seams "notes page with front matter: ... source keeps its front matter byte for byte" | none |
| R14 bold and italic survive | pass | `free_writing_r14.spec.js`: the lone paragraph, FIRST and SECOND ("held open" plus "comes back bold"); the header line, by click and by Esc (exactly one `p` below the sheet-head); bold two words, correct agent and do-nothing agent. `replay_run_check.spec.js` "R14, as run records" | Only bold is exercised. No R14 test covers italic, although the brief and the acceptance line both say "bold and italic". Italic shares the same `cleanBlock` path, so this is a coverage gap, not a known bug. |
| R15 undo | pass | `free_writing_undo.spec.js` "undo of a committed run... stays gone after two reloads", "undo of a handled run raises a take-back with remove_blocks"; seams "undo a handled run: the agent removes the blocks... nothing is reinserted"; `f1_editing_fixes.spec.js` undo after the agent acted | none |

## Brief decisions

| id | verdict | evidence | gap |
|---|---|---|---|
| The agent writes the notes file | pass | `write_command.test.js` creates an empty file; the seams notes tests show the scripted agent filling it | none |
| Lists in the first cut | pass | `free_writing_types.spec.js` ul and ol routes, "on an existing list: Numbered swaps the whole list..."; seams "list: Enter at the end of an existing bullet..." | none |
| No rich paste | pass | `free_writing_host.spec.js` "a paste of formatted HTML arrives as plain paragraphs", "a rich drop into a run block arrives as plain text". `LAHE-rich-paste` is in `docs/BULLETIN.md` | none |
| Larger edits covered | pass | the split and retype style tests in `free_writing_types.spec.js`; seams "split..." and "retag and undo..."; R14 cases on existing text | none |
| One sitting is one edit | pass | `free_writing_capture.spec.js` "the worked example" and "a second sitting on the run continues the same record"; `rail_run_cards.test.js` "Edit of ... plus new text" | none |
| Wireframe direction A | unverified | `editing.js` `buildBar` appends the type menu after the label, before the format buttons. There is no gutter "+" in `src/layer` | No test checks that the menu sits before B and I. The walker checks this, and that "+ Write here" is the only pointer way into empty space. |

## Plan acceptance criteria, general

| id | verdict | evidence | gap |
|---|---|---|---|
| Full suite green once at release | unverified | The orchestrator's run is in progress | Read the pass and fail counts of that run. |
| `gate` and `gate:all` green | unverified | `gate:unit` green, as above | Needs the orchestrator's `gate` and `gate:all` results. |
| Every user story walked | unverified | none | For the flow walker, all six brief stories. |
| Nothing punted | pass | No TODO in the `src/` diff. The 4 `test.skip` lines are Chromium-only mechanics, each with a reason (trusted drop, two IME tests, persistent-context crash). The beforeinput drop guard runs in every browser. The 2 unit todos are older than this feature | The seams "notes page with front matter" test still carries a "WAITING ON F1" comment, although it runs and passes. Only the comment is stale. |
| Deviations written under Changes from plan | **fail** | Main's progress page lists one item under Changes from plan (words the agent adds to a new paragraph). The worktree's copy says "None" | The deviations listed below exist only in the `progress/*.md` files. |
| Staff-designer look | unverified | Screenshots in `progress/shots/`, `phase2_replay_screens/`, `phase3_*_screens/`, `phase7_fix_f4_screens/` | For the walker. Also: `phase3_workstream_fixes.md` says the block-clash card reuses the anchor conflict's badge line, and it "reads a little off for a new block". |
| Copy matches pinned words | pass (code) | Every pinned string is in `src/`, checked by `grep -F`. Pinned in tests: `run_record.test.js`, `rail_run_cards.test.js` "the pinned words" | The plan's pinned table for `PAGE_CHECK_TAG_NOTE` is stale. The code adds "or anchor_tag_after", a deliberate F3 fix. Unpinned wording the builders chose: singular forms, "Not sent", the pure-split first line, and the tag-note rail line. |
| Reads as one feature | unverified | none | For the walker. |

## Plan acceptance criteria, this feature (beyond R1 to R15)

| id | verdict | evidence | gap |
|---|---|---|---|
| AQ1 Lahe's own code, one engine | pass (Chromium) | `free_writing_host.spec.js` Backspace and Delete merge, "arrow and Shift-arrow cross between the anchor and the run", "typing over a spanning selection leaves no inline style spans" | "In all three browsers" rests on `gate:all`. |
| AQ3 always check new blocks | pass | `handled_check_run.test.js` "two runs answered handled, one placed: the skipped one is held open"; seams "two real runs, one placed..." | none |
| AQ4 bound the record | pass | `log_run.test.js` "a record at both block ceilings with RUN_HISTORY_KEEP full entries fits the body limit", "older history entries push the record over RUN_RECORD_MAX_BYTES, and it is refused"; `run_record.test.js` history trim; `free_writing_types.spec.js` bar warning at 90 percent and the ceiling | none |
| Human reviewed and approved | pass | "Ken's decisions at the review gate (2026-09-29)" in the plan | none |

## Fix-round design calls (FIX_ROUND.md)

| id | verdict | evidence | gap |
|---|---|---|---|
| 1 Untouched anchor not compared | pass | `replay_run_fix_round.spec.js` "a run after an anchor the reviewer left alone" (2 tests, ran) | none |
| 2 Empty-page session only on notes | pass | `f1_editing_fixes.spec.js` "an empty page that is not a notes review stays in reading state" (ran) | See R1. |
| 3 Run-shaped once a block is added | pass | `f1_editing_fixes.spec.js` "Enter, type, Cmd-Z back to no blocks..." and "a tag changed and changed back" (ran) | none |
| 4 Take-back carries the old tag, and the helper checks it | pass | `fix_round_f3_record.test.js` take-back tests; `replay_run_fix_round.spec.js` "the take-back of a type change"; `handled_check_run.test.js` take-back tests; `replay_run.test.js` "a handled take-back is reopened while a listed block is still after the anchor" | none |
| 5 Undo after an agent reply raises a take-back | pass | `f1_editing_fixes.spec.js` "a ready run with a proofread question: undo raises a take-back" (ran) | none |
| 6 Use the fixes | pass | `agent_replies.spec.js` "the card lists every fix as from and to", "a fix aimed at the page's own words...", "the fixes are drawn as text"; `fix_round_f3_record.test.js` "applySuggestions refuses a fix to a from_anchor block"; seams long-run case (ran) | none |
| 7 `lahe review` on a notes file | pass | `write_command.test.js` "lahe review on a notes file keeps the one-page server: .env beside it is a 404" | none |
| 8 Drain size | pass | `fix_round_f3_projection.test.js` "a run's words appear at most twice on a drain line" | none |
| 9 Layer refuses an older helper | pass | `helper_contract_layer.spec.js` (ran); `fix_round_f3_sync.test.js`; `rail_focus.spec.js` "a refusal because the helper is older hides Review here instead" | A health answer with no `service_contract` is not refused (`phase7_fix_f3.md`). This is reasonable, since every helper since contract 13 reports one. |

## Test List

Each Test List line maps to a named test above, or to one in the same file. Lines worth noting:

| id | verdict | evidence | gap |
|---|---|---|---|
| Test List, old-contract agent | pass | seams "old agents (html)" and "old agents (md)" (ran) | The Test List line still says "never quietly closes the item". Task 3.4 was reworded in 9b5fe24: on HTML the old agent's result is correct, so handled is right there. The Test List line should match. |
| Test List, IME and trusted drop in all three browsers | unverified | Chromium only, by mechanism | The beforeinput guard runs in every browser. A real IME in Safari and Firefox is for the walker, if Ken wants it. |

## Fails and unverifieds, worst first

1. **R5, a force-quit loses the sitting (fail, Ken to decide).** If the browser process is killed within a few seconds of typing, nothing of that sitting survives. To pass, one of these:
   - Ken accepts the window, and the R5 acceptance line is reworded to say so.
   - Short sittings save to local storage on every keystroke, and the "sigkill" test then requires every block to survive.
2. **Deviations not rolled up (fail).** To pass, copy these onto the progress page under Changes from plan:
   - An empty page takes writing only on a notes review (design call 2).
   - Proofreading ends for good on a record once a proofread question is asked (F3).
   - A force-quit can lose a sitting (R5 above).
   - The old-agent HTML result counts as correct (plan 9b5fe24).
   - Tab reaches the block-type menu (2A).
   - The tag-note text adds "or anchor_tag_after" (F3). The plan's pinned table is stale.
   - The IME and trusted-drop tests run in Chromium only (2A).
   - `replies.js` and `store.js` were edited outside their workstreams' rows (rail, F3).
   - A take-back of a retagged run: the kernel's note is superseded by design call 4. Say so.
3. **R9b and R11b, real agent (unverified).** The walker runs a real agent on an HTML page and a Markdown page, and on a run of more than 150 words.
4. **Full suite, `gate`, `gate:all` (unverified).** These pass when the orchestrator's run reads 0 failed. That run also confirms AQ1 and R3 in Firefox and WebKit.
5. **User stories, the look, one feature, wireframe direction A (unverified).** The walker covers:
   - all six stories
   - the menu before B and I, and no gutter "+"
   - the block-clash card's borrowed badge line
6. **R14 italic (pass with a coverage gap).** To close it, add an italic variant of the lone-paragraph case to `free_writing_r14.spec.js`.
7. **Stale text (small).** Update the Test List's old-agent line and the plan's pinned tag note. Remove the "WAITING ON F1" comment in `free_writing_seams.spec.js` and the old entity comment in its special-characters test.

## Counts

46 rows in the tables above, counted by a Python pass over this file's table rows. A verdict that starts with "pass" (including "pass (Chromium)" and "pass (code)") counts as pass.

- pass: 35
- fail: 2
- unverified: 9
