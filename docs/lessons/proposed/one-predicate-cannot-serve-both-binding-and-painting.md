---
title: A match rule that is right for replay is wrong for painting
category: layer
symptoms: [everything is highlighted, whole page highlighted after reload, highlight covers the wrong text, highlight goes away after a few seconds, page refresh highlights everything]
applies_to: [src/layer/comments.js, src/layer/anchor.js, src/shared/uniqueness.js, src/layer/index.js]
first_seen: 2026-08-23
confirmed: 2026-08-23
status: live
---

## What happens

A reviewer reloads a page under review and the entire document is highlighted. It
corrects itself about two seconds later.

## Why

Painting resolves an anchor and paints the whole resolved element, and a large
ancestor is an eligible match. `anchor.matchKind` returns `CONTAINS` for any element
whose text merely holds the probe, and `uniqueness.isEligible` accepts `CONTAINS`
deliberately, because R16 needs a region that was rewrapped or reformatted to still
bind.

The innermost-element rule normally discards ancestors, but only when a matching
descendant exists to prefer. On a page that has not finished drawing itself there is
no descendant yet, so a container holding the whole document is the innermost match.
It binds, and `selectNodeContents` on it lights up everything inside.

The correction two seconds later is the settle repaint, which resolves against the
finished page.

The mistake is one predicate doing two jobs with very different costs. Binding
slightly too wide during replay is recoverable and the tolerance is required.
Painting slightly too wide covers the reviewer's document and they stop trusting the
rail, while the cost of not painting yet is only that a highlight appears a moment
later.

## What to do instead

Keep binding and painting as separate decisions. Do not narrow
`uniqueness.isEligible` or `matchKind` to fix a paint bug; that breaks rewrapped
regions.

Painting has its own rule, in priority order: a region with no text paints its whole
element; the reviewer's own quoted words paint exactly those characters when found
exactly once; otherwise the whole element, but only while its text is at most twice
the probe; otherwise nothing this pass. A legitimate `CONTAINS` bind is incremental,
an unrendered container is twenty to two hundred times the passage, so any threshold
between them works and the loosest one that cannot fail an unedited region is the one
to pick.

A test that only checks the end state passes while this bug is live. Sample the paint
on every animation frame during load and assert no highlight ever covers more than its
own region, and assert the sampler really ran during the un-rendered window.
