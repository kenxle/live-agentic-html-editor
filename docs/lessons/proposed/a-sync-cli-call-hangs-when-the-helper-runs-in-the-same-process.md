---
title: A synchronous CLI call hangs when the helper runs in the same test process
category: testing
symptoms: [test hangs, spec times out, lahe review never returns, CLI waits forever on the helper, helpers pile up in the test's temp state folder, stray helper count goes up, execFileSync hangs]
applies_to: [test/browser/**, test/unit/**, bin/lahe.js, src/cli/**]
first_seen: 2026-10-17
confirmed: 2026-10-17
status: live
---

## What happens

A test starts the helper in its own process (`service.start(...)` or `sitesWorld`),
then runs the real CLI against it with `execFileSync` or `spawnSync`. The CLI
asks the helper for health and gets no answer. It decides no helper is running and
starts one of its own in the test's temp state folder. That one cannot take the
port either, so it tries again. The test sits there until its timeout, and the
helpers it started keep running after it.

## Why

A synchronous child-process call stops the parent's event loop until the child
exits. The helper answers requests on that same event loop, so it cannot answer the
child at all. The child waits on the parent, and the parent waits on the child.

## What to do instead

When the helper lives in the test's own process, run the CLI without blocking and
await it:

```js
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const out = await promisify(execFile)(process.execPath, [CLI, "review", file, "--state-dir", state, "--port", String(helper.port)], {
  encoding: "utf8",
  timeout: 30000
});
```

`execFileSync` is fine only when the helper runs in a separate process the test
spawned. `test/browser/comments_follow_move.spec.js` (its `lahe` function) is the
working example.
