---
title: Two test runs at once on one machine fail each other's tests
category: testing
symptoms: [gate fails on a spec the change never touched, passes alone, flaky under load, "took 540ms", timing test over its limit, agent_liveness probe fails, session_list watcher fails, install_walk_3b fails, one_reply_box fails, unrelated red after merge]
applies_to: [test/browser/**, test/unit/**, package.json]
first_seen: 2026-10-07
confirmed: 2026-10-07
status: live
---

## What happens

`npm run gate` reports failures in tests the change never went near. Browser specs time out or miss an element (`install_walk_3b` "the reviewer's comment on that page lands in events.jsonl", `one_reply_box` "ending on a handled reply"). Unit tests with a clock in them miss their limit ("many empty elements between words clean in linear time", took 540ms against 500ms) or miss a liveness or watcher check (`agent_liveness`, `session_list`). Run alone, every one of them passes.

## Why

The suite was sharing the machine with another run: a builder's Playwright spec in a second worktree, or a browser left open for a preview check. Each Playwright run starts its own browsers and helpers. Under that load, timing limits and polling waits that hold on a quiet machine run out. The failures follow the load, not the code.

## What to do instead

- Start the full gate only when nothing else is running browser tests. If a builder is running its spec, wait for it to report, or tell it to hold until your run is done.
- When a failure shows up during overlap, rerun just those files on a quiet machine before calling it real or a flake:

  ```bash
  npx playwright test test/browser/<file>.spec.js
  node --test test/unit/<file>.test.js
  ```

- Say in the PR which failures were rerun alone and what they printed. A green rerun of the failing files is not the same as a green full run on the commit.
