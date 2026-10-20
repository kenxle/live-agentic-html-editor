---
title: Firefox can undo a scrollBy sent right after scrollIntoView
category: browser
symptoms: ["the box opened beside its passage", comment box 40px off its passage, test fails only in Firefox, fails more often on one branch than on main, scroll position jumps back after the test scrolled]
applies_to: [test/browser/**]
first_seen: 2026-10-19
confirmed: 2026-10-19
status: live
---

## What happens

A browser test calls `scrollIntoView` and then `scrollBy(-40)` in two separate
`page.evaluate` steps, then opens a comment box. In Firefox the box sometimes
lands 40px away from its passage, and the test fails on its first placement
check, before anything it meant to test. The scroll events read, for example,
1533, 1493, 1533: the `scrollBy` happened and was then undone about 10 ms later.
A bare page with no Lahe on it does the same. The failure rate moves between
runs, so it can look like a branch made it worse.

## Why

Firefox can finish the earlier `scrollIntoView` after the `scrollBy` runs and
snap back to where `scrollIntoView` put the page. Comment boxes are placed
once, when they open (`comments.js` `positionAt`), so a box opened in that gap
is placed against a page that then moves under it.

## What to do instead

Before opening a box or measuring positions after a scroll, wait until the page
is at rest: the same `window.scrollY` for 300 ms of animation frames. That is the
state a reviewer opens a box in. See `pageAtRest` in
`test/browser/style_switcher.spec.js`. Do not loosen the placement check.
