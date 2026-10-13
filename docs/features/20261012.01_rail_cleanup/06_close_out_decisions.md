# Rail cleanup: three things to decide

The rail cleanup is closed: ten pull requests merged, and the full gate on main is green. Three things wait on you. Answer on each card, with a word like "yes", "promote" or "keep".

**Docs:** [Progress page](04_progress_rail_cleanup.md) · [Shipped list and cleanup list](05_shipped_and_cleanup.md)

## 1. One lesson waiting in the queue

**The trap:** a worktree made inside the clone (under `.claude/worktrees/`) has no `node_modules` of its own, yet the test suite runs anyway, because Node finds the clone's `node_modules` one folder up. One install test checks that folder directly, so it is the only failure, and it looks like the change broke it.

**The lesson's fix:** run `npm install` in the worktree first, then put the lockfile back.

**My recommendation: promote it.** I hit this trap today, and the words in it are the words a stuck agent would search. I worked around it a simpler way: a link from the worktree to the clone's `node_modules`. That also passes the test and leaves the lockfile alone. If you want that in the lesson too, say "merge", and I will add it as a second way out.

Reply **promote**, **merge** (add the link method), or **discard**.

## 2. Files to delete

Nothing has been deleted. Say **yes** and I delete all of it in one batch, or name what to keep.

- Nine worktrees under `.claude/worktrees/` from this feature, all merged: `rail-cleanup`, `rail-r4`, `rail-cleanup-6` through `rail-cleanup-11`, and `agent-a42f70013754785a5`. Their `test-results/` folders, `node_modules` links, and scratch commit and pull request files go with them.
- Twelve local branches: `rail-cleanup`, `rail-cleanup-2` through `rail-cleanup-11`, and `remove-edits-tab`. Every one is merged into main, and the copies on GitHub are already deleted.
- Two pictures in this folder, `capture_reference.png` and `capture_reference_open.png`. The capture script makes them again on every run, and the mockup page does not use them.

The `.claude/worktrees/` folder holds 49 more worktrees from other features and agents. They are not part of this list, and I have not touched them.

## 3. The worktree teardown

This is the same thing as the first bullet above, asked on its own because removing a worktree removes its folder. Every worktree here is merged and pushed, so nothing is lost. A **yes** on item 2 covers it.
