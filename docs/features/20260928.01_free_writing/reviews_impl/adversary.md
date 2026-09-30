# Adversary review (implementation): free writing

**Short version.** I found six problems the other five reviews missed. Three of them hit the normal blog-post flow:

- **Undo after a proofread question does nothing to the source.** The agent has already placed the words, but the item is still "ready", so undo drops the record. The words come back on the next reload, and nothing flags it.
- **Writing after a paragraph the agent then fixes puts the reviewer's section on hold.** The reviewer never touched the anchor, but replay compares it anyway. If the agent changed it (say, to answer a comment), the run is held behind a conflict card. Both answers on that card are wrong.
- **Proofreading never stops.** Pressing "Use the fixes" brings the item back still marked `proofread: true`, so the contract tells the agent to proofread it again.

The other three:

- A take-back is never checked.
- `lahe review` on a notes file serves the notes folder, which undoes what `lahe write`'s one-page server protects.
- Every drain line carries a run's words about four times over.

Diff: `git diff 97a8270..HEAD` in `.claude/worktrees/free-writing` (HEAD e1de6d3).

I checked each finding against the code. I also ran the scripts listed at the end, against the branch's own modules, with my own state directory and ports. I did not run the browser suite. None of the six below repeats a finding from `code_reviewer.md`, `codex.md`, `code_lead.md`, `security.md` or `testing.md`. Where a finding sits next to one of theirs, I say how it differs.

---

## Findings, worst first

### A1. Undo after the agent placed the words, but before it said handled, leaves them in the source

```
severity   blocker
kind       defect
where      src/layer/editing.js:3624-3627 and :3674 (undo drops the record when canDelete says so)
           src/shared/lifecycle.js:141 (DELETABLE_FROM = draft, ready, not_handled)
           src/shared/lifecycle.js:243-245 (a question reply leaves the state as it is)
           src/shared/review_format.js:115 (the proofread contract line: place, rebuild, then reply question)
what       The proofread contract has the agent write the source and then leave the item ready. Undo
           reads "ready" as "nothing landed in the source". So it drops the record and raises no
           take-back.
why        Scenario: a 400-word section, which is exactly the blog case.
           - The agent places it and asks the proofread question.
           - The reviewer changes their mind and presses undo.
           - restoreRegion takes the blocks off the page right away, so the undo looks like it worked.
           - The record is removed. The agent is never told.
           - The next rebuild or reload shows the whole section again, and nothing on the rail explains it.
           The same happens after "Use the fixes" (ready at rev+1, with rev 1 already in the source).
           It also happens after any placement question ("Should this go under Intro?") and after
           handled_not_on_page. The comment at editing.js:3624 states the assumption the proofread
           design broke: "Dropping the record is only right when nothing landed in the source."
           This breaks brief R15 (undo asks the agent to take placed text back out).
           Checked with undo_after_question.js: after a question reply the state is "ready", and
           canDelete(ready, reviewer) is true.
fix        - Record that the agent placed the words. A question or handled_not_on_page reply on a run
             record sets something like `placed_rev`.
           - Or treat any agent reply on a run record as "may have landed".
           - When undo sees either, it raises a take-back (revertOf) instead of dropping the record.
           - Test, red first: the proofread seam case, then undo on the card. review.json then holds
             a take-back with remove_blocks. After the scripted agent acts and the page reloads, the
             blocks show zero times.
```

### A2. A run after an anchor the reviewer never changed is held as a conflict when the agent changes that anchor

```
severity   blocker
kind       defect
where      src/layer/replay.js:3110-3122 (the anchor compare runs for every non-container run)
           src/layer/replay.js:3555-3562 (keep_mine writes the anchor view over the page)
           src/layer/replay.js:3563-3573 (take_theirs records the agent's words as a reviewer reword)
what       Take the common case: "+ Write here" below a paragraph, with the paragraph left alone
           (anchor_after_html equals before_html). The anchor still goes through today's
           four-branch compare. If the page's anchor differs, the result is CONTENT_CHANGED, and
           holdRun writes nothing.
why        Scenario: the reviewer comments "tighten this" on paragraph X, then writes a section below X.
           - The agent fixes X and rebuilds while the reviewer is typing.
           - The reload waits for Esc, then runs.
           - The reviewer's section disappears from the page, and X gets a conflict card.
           - "Keep mine" writes X's old words back over the agent's fix. acceptPageText then keeps
             rewriting it on every repaint. The comment item's page check sees its fix gone and
             reopens that item as undone.
           - "Take the page's" makes a new revision whose change text says "Reworded this paragraph".
             So the agent is told the reviewer reworded the agent's own sentence.
           The same happens on a notes page the agent was asked to organize while a new sitting was open.
           Checked with anchor_moved.js: an unchanged anchor against a reworded page gives
           branch content_changed.
           This is not code_lead 3 (a short new block clashing with the next leaf). That one is about
           the run's own blocks. This one is the anchor.
fix        - When the sitting left the anchor alone (anchor_after_html equals before_html, and no
             anchor_tag_after), use the anchor only to find the place, the way a container anchor
             is used. Skip the compare and never write the anchor.
           - Still resolve it with the ladder. If the ladder cannot find it, that stays LOST.
           - Test, red first: a run after an untouched paragraph, then the source rewrites that
             paragraph, then reload. The run is placed, there is no conflict badge, and the
             paragraph shows the source's words.
```

### A3. A take-back is never checked, so an agent that ignores it closes the undo

```
severity   important
kind       defect
where      src/service/handled_check.js:469 (checkable: isRevert returns false)
           src/layer/replay.js:3680 (isRunChecked leaves out take-backs)
           src/shared/record.js:1870-1893 (the take-back's after is the anchor's words alone)
what       A run take-back's `after` is the anchor's original words. Those are still on the page
           whether or not the blocks were removed. The helper skips reverts, and the page check
           looks only for `after`. So "handled" on a take-back always passes.
why        Scenario: the reviewer undoes a placed section. The agent replies handled without editing
           the file, or removes one block of three.
           - The take-back retires.
           - Replay stops removing the blocks, because it only acts on outstanding records.
           - The undone words are back on every later load, and no card, badge or check says so.
           For an ordinary edit the page check catches this, because a take-back's `after` differs
           from the page. A run only adds text, so it never differs. This is a gap the feature
           opened, not an old one.
           Checked with takeback.js: checkable(take-back) is false, and pageCheckReasonFor with
           both blocks still on the page returns null.
           This is not code_lead 2 (the take-back carries no tag). That one is about what the
           take-back says. This one is about checking that it happened.
fix        - For a take-back with remove_blocks, the helper's check and the page check both need
             each listed block to be absent after the anchor.
           - Use the same walk (runElementsFor, or runOnPage in the helper). Held or reopened
             otherwise.
           - Test: a take-back answered handled with the source unchanged is held.
           - Update the contract's handled-check line to say take-backs are checked too, in all
             three copies.
```

### A4. "Use the fixes" brings the item back still marked proofread, so the agent proofreads again

```
severity   important
kind       defect
where      src/shared/review_format.js:516-520 (isProofread reads only the run's word count and notes)
           src/shared/review_format.js:115 (the contract line keyed on proofread: true)
           src/shared/record.js:1970-1995 (applySuggestions keeps the "Added N blocks" change text)
what       proofread is true on every revision of a run over 150 words. The revision "Use the fixes"
           makes is still over 150 words, and its change text is word for word the first
           revision's.
why        The contract gives the agent two rules that both apply at rev+1:
           - "When an item carries proofread: true, ... reply question with --proofread"
           - "the item comes back at a new rev carrying the fixed words: put them in the source"
           An agent that follows the first rule sends a second proofread question on words the
           reviewer already approved. The next "Use the fixes" gives a third, and so on.
           The same thing re-fires on every later sitting that continues an outstanding long run.
           The seam test (free_writing_seams.spec.js:710-715) never looks at `fixed.proofread`,
           and the scripted agent has no proofread branch, so the test cannot see it.
           Checked with proof_loop.js: rev 1 proofread true, and after applySuggestions rev 2 is
           proofread true with the same change text.
           This is not code_lead 4 (the fixed block inserted as a duplicate). That one is about
           placement. This one is about the flag.
fix        - proofread is false once the item's thread holds a proofread question the reviewer has
             answered. Or keep it for the first revision the agent sees, and no later one.
           - applySuggestions sets a change text such as "The reviewer took your N fixes; put them
             in the source."
           - Test: a projection test that rev+1 after applySuggestions has proofread false. Also
             assert it in the seam case.
```

### A5. `lahe review` on a notes file reuses the notes review on a folder server and serves the notes folder

```
severity   important
kind       defect (security)
where      src/cli/commands/review.js:233-247 (the one-page server only when the command is write)
           src/cli/commands/review.js:249-285 (the folder path registers the Markdown asset mount)
           src/service/markdown.js:369 (assetRoot is the .md file's own folder)
           docs/CLI.md:32 ("lahe review <document> --session <id> brings the page back")
what       The one-page guarantee holds only when the command is literally `lahe write`. After
           `lahe write notes.md`, a plain `lahe review notes.md --session <id>` reuses the notes
           review ("reused, matched by path"). It then starts an ordinary server with
           /.lahe-source/<hash>/ mounted on the notes folder.
why        Scenario: an all-day notes page.
           - The reviewer closes the tab at lunch, and the helper stops the server two minutes later.
           - To bring it back, the reviewer or the agent runs the command CLI.md documents for
             exactly this: `lahe review <document> --session <id>`.
           - From then on the notes folder (a home, Desktop or Documents folder, which is the case
             SR4 was about) is served, dotfiles included.
           Reproduced in an isolated state dir: after write, then review --session, these returned
           200 with their contents:
           - curl /.lahe-source/bfaa54a8ea7b3a08/.env
           - curl /.lahe-source/bfaa54a8ea7b3a08/diary.txt
           Nothing printed a warning. The output switched from "scope this page only" to "root ...
           the rail follows links onto any page under that root".
           This is not code_lead 23, which covers a missing render at restart and a second notes
           reader.
fix        - Decide page mode from the review, not the command. When the review `add` would reuse
             is a notes review (isNotesReview), `lahe review` takes the notes path: its own
             one-page server, no mounts.
           - Test: write, then review --session on the same file. The mount is absent and /.env is
             a 404.
           - Say in CLI.md and the skill that either command brings a notes page back.
```

### A6. A run's words reach the agent about four times per drain line, on every drain

```
severity   important
kind       risk
where      src/shared/review_format.js:507-513 (projectBlocks: html and text for each block)
           src/shared/review_format.js:567 and :586 (after_full and after_html are uncut for a run)
           src/cli/commands/status.js:432 (drainLine copies all of it under `page`)
what       One run is projected as new_blocks[].html, new_blocks[].text, after_full and after_html.
           Each of the four holds the whole sitting.
why        Measured with drain_size.js on projectItem:
           - a 3,000-word post: 15,225 bytes of block markup, 67,123 bytes of projected item (4.41x)
           - a 10,080-word run: 213,563 bytes (4.17x)
           - a 30,000-word notes run, still under NEW_BLOCKS_MAX_BYTES: 625,578 bytes (4.11x)
           The drain prints every unanswered item on every wake. So a long notes item that waits
           for the agent, or is held by the handled check, is reprinted until it closes. At the
           run ceiling that is a large share of an agent's context on each wake. The repo's own
           memory note "Repeated context steers agents" is about this kind of cost. Code_lead 25
           noted the seven null run fields on each line, not the repeated words. Code_lead 6
           covers the stored record, not what the agent reads.
fix        - For a run record, project after_full and after_html cut at BEFORE_MAX, as before the
             feature. new_blocks already carries every block with its tag. That changes the
             architecture's old-agent line, so it goes to Ken on a page.
           - Or leave `text` out of the drain line (the agent can read the html) and keep one
             uncut copy.
           - Test: a projection test that a run's words appear at most twice in the drain line.
```

---

## What the reviewers shared and did not test

- **"Ready means nothing is in the source."** Undo, deletion and withdrawal all rest on it. The proofread contract is the first flow that has the agent write the source before it closes the item. No reviewer traced undo against a question reply (A1).
- **"The anchor compare is today's compare."** Every review took "the anchor keeps today's four branches" from the architecture. None asked what a compare means for an anchor the reviewer did not change (A2).
- **"The handled check covers new text."** It covers new_blocks. A take-back of new text is the one run record it never looks at (A3).
- **"lahe write gets its own server."** It does. The reviews tested the command, not the review it makes. The review then outlives the command (A5).
- **The scripted agent knows rules the contract does not state.** Code_lead 4 found one, the history rewrite. The agent also has no proofread branch at all, which is why A4 passes the seam test.

## Scripts

All in `/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-live-agentic-html-editor/234088e7-1201-4ed5-93c2-cee1b5ec5b8c/scratchpad/adv/`. Run each with `REPO=<worktree> node <script>`.

- `undo_after_question.js` (A1)
- `anchor_moved.js` (A2)
- `takeback.js` (A3)
- `proof_loop.js` (A4)
- `drain_size.js` (A6)
- `pagecheck_anchor.js`, `pagecheck_anchor2.js`: checks I ran that came back clean. The page check does not reopen a placed run when its anchor is reworded later.
- A5 was reproduced by hand with `LAHE_STATE_DIR=.../adv/w1/state`, helper port 47931, and then `lahe session close`. A second world (`w2`, port 47932) confirmed the reverse order, `lahe review` then `lahe write`, mints a fresh notes review correctly.

## Cleanup needed

- None in the repo. The scratch folders above are under `/private/tmp`, so the OS removes them.
- Not mine, noted in passing: `src/shared/record.js:1394` holds a literal NUL byte (`run.tag + "\0" + run.text` written raw). It is older than this feature (it is in 97a8270). Because of it, `grep` treats the file as binary and prints nothing for any search. Every reviewer who grepped record.js without `-a` got "no match". Worth a one-line fix to `"\u0000"`.
