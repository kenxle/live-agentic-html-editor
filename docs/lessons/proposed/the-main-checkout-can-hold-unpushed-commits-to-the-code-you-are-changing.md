---
title: The main checkout can hold unpushed commits to the code you are changing
category: process
symptoms: [old code gives numbers that make no sense, before and after comparison looks wrong, "main is ahead of origin/main", rebase conflict in a file nobody else touched, worktree branch off origin/main misses a fix, two fixes for the same bug]
applies_to: [".claude/worktrees/**", src/**]
first_seen: 2026-10-19
confirmed: 2026-10-19
status: live
---

## What happens

A worktree is branched from `origin/main`. Meanwhile an agent in another repo,
often Codex, hits the same Lahe bug and commits a fix straight to Lahe's main
checkout without pushing it. Nothing tells you. The first sign is a "before"
measurement run against the main checkout that disagrees with the code you
read: the old code seems to behave in a way its source on your branch does not
explain. Later the branch conflicts on rebase, in the same function.

## Why

`origin/main` and the main checkout's `main` are two refs. Agents in other repos
run `lahe` from the main checkout, so they find Lahe bugs and sometimes fix them
there. A worktree made from `origin/main` never sees that commit, and code
loaded from the main checkout is not the code your branch started from.

## What to do instead

Before measuring against the main checkout, and again before shipping, compare
the two refs:

```
git -C <main checkout> log --oneline origin/main..main
git -C <main checkout> status --short
```

If `main` is ahead, read those commits. If they touch your code, rebase your
branch onto them and ship both in one pull request. Merge it with
`gh pr merge <n> --merge`, not squash or rebase, so the other commit keeps its
id and the main checkout fast-forwards cleanly after the merge. Say in the PR
body that it carries the other commit.
