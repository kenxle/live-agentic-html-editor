---
title: gh pr merge --delete-branch stops when a worktree holds the branch, and the remote branch stays
category: process
symptoms: [gh pr merge failed after merging, "cannot delete branch", "used by worktree", remote branch still on GitHub after merge, PR merged but command exited non-zero, delete-branch error]
applies_to: [".claude/worktrees/**"]
first_seen: 2026-10-15
confirmed: 2026-10-18
status: live
---

## What happens

`gh pr merge <n> --merge --delete-branch` merges the pull request, then exits
with an error while deleting the local branch, because a builder's worktree
under `.claude/worktrees/` still has that branch checked out. The command looks
failed, but the PR is merged. The remote branch is still on GitHub.

## Why

`--delete-branch` deletes the local branch first, and git refuses to delete a
branch that any worktree has checked out. gh stops at that error and never
reaches the remote delete.

## What to do instead

Merge and delete as separate steps:

```
gh pr checks <n>          # read "pass"
gh pr merge <n> --merge
git push origin --delete <branch>
```

Delete the local branch at teardown, after `git worktree remove` frees it. A
worktree Claude Code made for a subagent may also be locked by the session's
pid; `git worktree unlock` it first once the builder has finished.
