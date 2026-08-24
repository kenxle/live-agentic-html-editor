---
title: The browser suite runs the bundle on disk, not the source you just edited
category: testing
symptoms: [browser test fails but the source looks right, the failure does not move when I change the code, it passed after I rebuilt, stashing my change made it pass, gate:builder is green but gate is red, reverting the suspect commit fixed nothing, fails identically in all three lanes]
applies_to: [dist/**, test/browser/**, src/layer/**, package.json]
first_seen: 2026-08-24
confirmed: 2026-08-24
status: live
---

## What happens

A browser spec boots a real page, and the page loads the layer from
`dist/lahe-layer.js`, served at `/.lahe-library/lahe-layer.js`. Nothing in the test
path builds that file. `npm run test:browser` is bare `playwright test`, and
`gate:builder` is `lint && test:unit && test:browser`, which omits `check:layer` on
purpose so builders never have to stage a generated file.

So the browser suite measures whichever bundle happens to be on disk. Two shapes
follow, and the second is the expensive one:

- A layer edit that was never built is invisible. The suite is green about code
  nobody is running.
- A bundle built from a broken intermediate state keeps failing after the source is
  fixed. The failure does not move, which reads as "the cause is somewhere else."

That second shape defeats the two moves an agent reaches for next, and defeats them
in opposite directions:

- **Stashing looks like confirmation.** `git stash` reverts `src/` and `dist/`
  together. The stashed run is green, and that looks like proof your edit is the
  cause. It only shows the pair was consistent, not which half was at fault.
- **Reverting the suspect commit looks like exoneration.** The revert changes source
  and rebuilds nothing, so the same stale bundle produces the same failure, and the
  commit looks innocent.

Two agents can reach opposite wrong conclusions about the same failure this way, one
from each move, and both feel evidence-backed.

## Why

`dist/lahe-layer.js` is generated but committed, and builders are forbidden from
staging it, so no one's inner loop refreshes it. `check:layer` is the only thing that
notices staleness, and it lives in `gate` and `gate:all`, which the orchestrator runs,
not in `gate:builder`, which is the one a builder is told to run.

## What to do instead

**Build before you measure.** Any browser run meant to test a `src/layer/` edit gets
`npm run build:layer` first. It takes about a second.

```
npm run build:layer && npx playwright test <spec>
```

**Check before you believe a bisect.** `npm run check:layer` answers whether the
bundle matches the source. If it reports stale, every browser result you have so far
is about a different program, including the ones that shaped your hypothesis.

**Do not conclude from a stash.** Rebuild and re-run instead, changing one thing at a
time: source built from your edit, then source built without it.

**Still do not stage `dist/`.** Rebuild locally and leave it unstaged. The rule is not
the problem here; not knowing the suite depends on the artifact is.
