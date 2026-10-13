---
title: The browser suite rewrites committed screenshots under docs/features
category: testing
symptoms: [worktree dirty after the gate, modified png files, png changed but I touched no images, git status shows docs/features images, unexpected diff after playwright test]
applies_to: [test/browser/**, docs/features/**]
first_seen: 2026-10-12
confirmed: 2026-10-13
status: live
---

## What happens

After a full `npx playwright test` run, `git status` shows committed PNG files under `docs/features/` as modified, in a branch that never touched them. Examples: `docs/features/20261012.01_rail_cleanup/mark_done_dark.png`, `docs/features/20260922.02_linked_docs_rail/linked_page_rail.png`.

## Why

Some specs take their screenshots straight into the feature folders, so a progress page can show the real thing. `test/browser/mark_done.spec.js`, `linked_docs_rail.spec.js` and `rebuild_not_the_agents_job.spec.js` all write there. Each run re-renders them, and a pixel of font or timing difference makes a new file.

## What to do instead

Do not stage them with your change. After the run, put them back without deleting anything:

```sh
git status --short docs/features | awk '$1=="M"{print $2}' | xargs git checkout --
```

Commit a refreshed screenshot only when the change is meant to alter what it shows.
