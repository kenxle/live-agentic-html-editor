# Close-out decisions: lean agent output

Both token cuts have shipped: [PR #69](https://github.com/kenxle/live-agentic-html-editor/pull/69) (one comment from 1,320 to 326 tokens) and [PR #70](https://github.com/kenxle/live-agentic-html-editor/pull/70) (batch replies, and the agent's own earlier answers dropped from the queue check). One call is left: the merge-rule change for CLAUDE.md, below. [PR #77](https://github.com/kenxle/live-agentic-html-editor/pull/77) is merging at your yes: main moved, so its full gate is running again first. Last updated 2026-10-18 12:54.

**Docs:** [Progress, PR #69](04_progress_lean_agent_output.md) · [Progress, PR #70](../20261015.01_batch_reply_own_answers/04_progress_batch_reply_own_answers.md) · [Review log](04_progress_lean_agent_output_review_log.md)

## PR #77: the Stop hook test (merging)

**What it does.** A unit test checks that the Stop hook's message, the review contract and the skill describe the same steps. If one copy changes and the others don't, the test fails. You chose this over a reminder in CLAUDE.md.

**What it found.** The three copies disagreed on main. My PR #69 review fix taught the hook "drain first if the watcher woke you and you haven't drained since". The skill still said "no drain", and the contract said to run the hook's command "and only that". The PR adds the drain-first step to the contract, its two copies, the skill and the command docs. The new test fails on main and passes on the branch.

**A second fix inside it.** Main's CI has been red since b65deb9f, from another agent's option-card work. That commit changed the page style without updating a test's saved copy of a rendered page. The PR refreshes that copy. Only the option-card style lines changed.

**Tests.** On my machine, lint and the unit tests show 0 failed, and the browser suite shows 893 passed and 0 failed. GitHub's CI passes.

Yes merges it, and then I rerun the full gate on main and reinstall the skill.

## CLAUDE.md: merge, then delete the branch, as two steps

**Proposal.** In the same file, section "CI runs mail Ken", change the merge bullet to:

> - Check, then merge, as two steps. Run `gh pr checks <n>`, read "pass", then run `gh pr merge <n> --merge`. Delete the remote branch with `git push origin --delete <branch>`. Do not pass `--delete-branch` while a builder's worktree still holds the branch: gh merges, fails on the local branch, and leaves the remote branch behind.

**Why.** Merging PR #69 with `--delete-branch` merged it and then stopped with an error, because the builder's worktree held the branch. The remote branch was still on GitHub until I deleted it by hand.

