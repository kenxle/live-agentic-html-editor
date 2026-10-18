# Close-out decisions: lean agent output

Both token cuts have shipped: [PR #69](https://github.com/kenxle/live-agentic-html-editor/pull/69) (one comment from 1,320 to 326 tokens) and [PR #70](https://github.com/kenxle/live-agentic-html-editor/pull/70) (batch replies, and the agent's own earlier answers dropped from the queue check). Two calls are left: whether to merge [PR #77](https://github.com/kenxle/live-agentic-html-editor/pull/77) (first section below), and the merge-rule change for CLAUDE.md. Everything else on this page is done. Last updated 2026-10-18 12:46.

**Docs:** [Progress, PR #69](04_progress_lean_agent_output.md) · [Progress, PR #70](../20261015.01_batch_reply_own_answers/04_progress_batch_reply_own_answers.md) · [Review log](04_progress_lean_agent_output_review_log.md)

## PR #77: the Stop hook test (needs your call: merge it?)

**What it does.** A unit test checks that the Stop hook's message, the review contract and the skill describe the same steps. If one copy changes and the others don't, the test fails. This is the "2" you approved on the card below, instead of a reminder in CLAUDE.md.

**What it found.** The three copies disagreed on main. My PR #69 review fix taught the hook "drain first if the watcher woke you and you haven't drained since". The skill still said "no drain", and the contract said to run the hook's command "and only that". The PR adds the drain-first step to the contract, its two copies, the skill and the command docs. The new test fails on main and passes on the branch.

**A second fix inside it.** Main's CI has been red since b65deb9f, from another agent's option-card work. That commit changed the page style without updating a test's saved copy of a rendered page. The PR refreshes that copy. Only the option-card style lines changed.

**Tests.** On my machine, lint and the unit tests show 0 failed, and the browser suite shows 893 passed and 0 failed. GitHub's CI passes.

Yes merges it, and then I rerun the full gate on main and reinstall the skill.

## CLAUDE.md: the Stop hook travels with the skill (done: replaced by PR #77)

**Proposal.** In [CLAUDE.md](../../../CLAUDE.md), section "Agent-facing docs: what is truth, and what travels together", add one line to the list of copies that change together:

> - the Stop hook's message in `src/cli/commands/hook.js`, which restates the wake and drain steps

**Why.** PR #69 changed the watcher so it no longer prints comments, only a line saying work is waiting. The Stop hook still told agents "there is no need to drain". An agent following it would have left the comments sitting unread. The code review caught it before the merge. The hook is the one copy of the workflow that the list leaves out.

## CLAUDE.md: merge, then delete the branch, as two steps

**Proposal.** In the same file, section "CI runs mail Ken", change the merge bullet to:

> - Check, then merge, as two steps. Run `gh pr checks <n>`, read "pass", then run `gh pr merge <n> --merge`. Delete the remote branch with `git push origin --delete <branch>`. Do not pass `--delete-branch` while a builder's worktree still holds the branch: gh merges, fails on the local branch, and leaves the remote branch behind.

**Why.** Merging PR #69 with `--delete-branch` merged it and then stopped with an error, because the builder's worktree held the branch. The remote branch was still on GitHub until I deleted it by hand.

## Lesson: the agent reading a drain did not write every agent turn in it (done: promoted)

**Proposed lesson:** [the-agent-reading-a-drain-did-not-write-every-agent-turn-in-it.md](../../lessons/service/the-agent-reading-a-drain-did-not-write-every-agent-turn-in-it.md).

It records the gap the PR #70 review found. Dropping the agent's words from the queue check lost the agent's question once you answered it, and lost earlier replies for an agent that took a session over. Yes promotes it into `docs/lessons/service/`. No discards it.

## Lesson: the README hero needs a real site (done: promoted)

**Proposed lesson:** [the-readme-hero-needs-a-real-site-and-no-local-one-is-safe.md](../../lessons/process/the-readme-hero-needs-a-real-site-and-no-local-one-is-safe.md).

This one is from the card edges work on 2026-10-16, not from the token work. It is still waiting in the queue, so it is here too. Yes promotes it into `docs/lessons/process/`. No discards it.

## Tear down the two builder worktrees (done: removed)

Both branches are merged into main, and both worktrees hold nothing uncommitted of mine. Yes removes these, in one batch:

- `.claude/worktrees/agent-a1f0391c928ddd99b` and its local branch `feat/lean-agent-output`
- `.claude/worktrees/agent-a6d915fee54499941` and its local branch `feat/batch-reply-own-answers`

After that I close this review session. The review history stays on disk.
