---
title: A "no helper running" test reaches the developer's real helper on the default port
category: testing
symptoms: [no helper test fails only on my machine, first.acquired is false, window lock refused with no helper, helper contract older refused, test passes in CI but fails locally, "127.0.0.1:7817"]
applies_to: [test/browser/**, test/fixtures/**]
first_seen: 2026-09-30
confirmed: 2026-09-30
status: live
---

**What happens.** A browser test meant to cover "no helper is running" loads a fixture whose script line names the helper's fixed port, 127.0.0.1:7817. On a developer machine a real helper is almost always running on that port. The page reaches it. The test then checks the real helper's behavior instead of an absent one. It can pass by luck, or fail with something like `expected first.acquired to be true`, when the local helper runs an older service contract and the layer refuses it.

**Why.** "No helper" in the test only means the test started none. The fixture still points at the default port, and nothing stops the page connecting to whatever is listening there. In CI nothing is, so the test passes there and the gap stays hidden.

**What to do instead.** Refuse the default port in every context the test opens, the way a machine with nothing running refuses it:

```js
async function refuseDefaultHelper(context) {
  await context.route(/^http:\/\/127\.0\.0\.1:7817\//, (route) => route.abort("connectionrefused"));
}
```

A test that does need a helper starts its own, on a free port and its own state directory, and never uses 7817. See `test/browser/rail_second_window.spec.js` and `test/browser/framed_boot.spec.js`.
