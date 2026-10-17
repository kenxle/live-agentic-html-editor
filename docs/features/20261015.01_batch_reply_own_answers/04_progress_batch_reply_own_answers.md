# Progress: Batch reply and own answers

**Done.** The drain no longer hands the agent its own earlier answers, and `lahe reply --batch` answers many items in one command. Nothing is waiting on you. Shipped in [PR #70](https://github.com/kenxle/live-agentic-html-editor/pull/70). Last updated 2026-10-17 12:35.

**Docs:** [Spec](01_spec_batch_reply_own_answers.md) · [Measurement script](measure_follow_up.js) · [Review log](../20261014.02_lean_agent_output/04_progress_lean_agent_output_review_log.md) (shared with the lean agent output change, one review covered both) · Before this: [Lean agent output](../20261014.02_lean_agent_output/04_progress_lean_agent_output.md)

## Needs your attention

Nothing is waiting on you.

## Currently working on

Nothing is running.

## Phases

This ran as a whetstone change, so the rows are whetstone's steps.

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done | 2026-10-15 |
| 1 Worktree | done | 2026-10-15 |
| 2 Spec | done | 2026-10-15 |
| 3 Spec review | skipped: Ken approved both ideas on a card and asked for no spec review | 2026-10-15 |
| 4 Human gate | done on the audit page card | 2026-10-15 |
| 5 Build | done | 2026-10-15 |
| 6 Code review and verify | done | 2026-10-15 |
| 7 Ship and land | done, merged | 2026-10-15 |
| 8 Close out | done | 2026-10-17 |

## The record

### Task index

| Step | Task | Status | Outcome |
|---|---|---|---|
| 1 | Drain drops the agent's own words from threads | done | `withoutAgentWords` in `src/cli/commands/status.js` |
| 2 | `lahe reply --batch` | done | One JSON array on stdin, all or nothing |
| 3 | Skill, contract and copies | done | Changed together |
| 4 | Measurement | done | A follow-up with one earlier answer: 385 tokens before, 273 after |

### Passes

| Pass | Dispatched | Red after the check | Note |
|---|---|---|---|
| 1 | One builder, all tasks | Code review: an answered question lost its words, and a takeover agent lost turns it never saw | Fixed by the same builder in da70539d, with tests |

### Changes from plan

- The drain keeps an agent turn's `text` when it is the thread's last turn and a question. The reviewer's note is answering it.
- The drain keeps the words on turns written before the session's last takeover.
- Proofread `suggestions`, `files` and `at` stay on agent turns. The contract tells the agent to read the fixes there.
- `--batch` refuses every single-form flag and any unknown entry field.

### Follow-ups

None.

### Cleanup queue

| Path | Reason | Status |
|---|---|---|
| `.claude/worktrees/agent-a6d915fee54499941` | Builder worktree, branch merged | waiting for Ken |
| local branch `feat/batch-reply-own-answers` | Merged | waiting for Ken |

### Test results

- Builder, `npm run gate:unit`: 2,927 tests, 2,920 pass, 0 fail.
- Branch, eb6c935f, `npm run gate` alone: unit 2,920 pass, 0 fail. Browser 885 passed, 0 failed.
- Main after merge, 9d223fe1: unit 2,920 pass, 0 fail. Browser 887 passed, 0 failed.
- Helpers: 1 before and 1 after on the branch run. On main, 3 before and 3 after; the two extras were another agent's preview helper.

### Ship

Merged 2026-10-15 as 9d223fe1. CI gate passed. `npm run install-skills` ran after the merge. The first real `lahe reply --batch` answered two cards on the audit page.

## Log

- **2026-10-17 12:35.** Closed out. Board row LAHE-batch-reply-own-answers is done.
- **2026-10-15.** Ken asked whether Hold saves tokens. The answer showed per-wake calls cost more than per-item text, and found the agent's own answers coming back on follow-ups. He approved both cuts, and they shipped the same day.
