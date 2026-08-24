---
title: The engines disagree about what an editing gesture means, and inputType cannot tell them apart
category: browser
symptoms: [edit not recorded, edit discarded as a no-op, paragraph break became a line break, bold did nothing, click vanished with no trace, works in Chromium fails in Firefox]
applies_to: [src/layer/editing.js, src/shared/normalize.js, src/shared/gestures.js, test/browser/**]
first_seen: 2026-08-23
confirmed: 2026-08-24
status: live
---

## What happens

A reviewer performs an ordinary editing gesture and nothing is recorded. The page
changes under their cursor, the rail stays empty, and no error appears anywhere.

Measured, same keystroke, same selection, no library involved:

```
Enter mid-paragraph in a <p contenteditable>
  chromium  "...layoff.<div>&nbsp;Most of them...</div>"     nested block
  webkit    "...layoff.<div>&nbsp;Most of them...</div>"     nested block
  firefox   "...layoff.<br>&nbsp;Most of them..."            a <br>

Bold on text a page stylesheet already made bold
  all three  '<span style="font-weight: normal;">too fast</span>'

Italic off CSS-italic text
  firefox    the block is untouched; execCommand does nothing at all
```

## Why

An HTML element cannot always express the gesture, so each engine improvises. A
`<p>` cannot legally contain a `<p>`, so two engines inject a nested `<div>` and one
writes a `<br>`. There is no tag meaning "not bold", so all three reach for a style
attribute.

The normalizer is right to read a nested block as a paragraph break and a `<br>` as a
line break, and right to drop a style attribute, so the record then compares equal to
its own before text and the commit is discarded as a no-op. The reviewer's gesture is
thrown away by correct code.

`inputType` alone cannot rescue this: WebKit reports Shift-Enter as `insertParagraph`,
the same value it reports for a bare Enter, so the two gestures are indistinguishable
from the input event. The Shift state of the keydown that produced it is the only
tie-breaker, and a `beforeinput` event does not carry one.

## What to do instead

Decide what the gesture means before the engine does. Handle `beforeinput`, read the
intent from the inputType plus the modifier state parked from the keydown, call
`preventDefault`, and write canonical markup yourself. `gestures.breakIntentFor` and
`gestures.formatIntentFor` are the pure rules; `src/layer/editing.js` performs them.

When the gesture has no HTML to express it, mint a tag rather than keeping a style
attribute. `not-bold` and `not-italic` are custom element names, which the spec
guarantees will never be standardized, and they are in `normalize.STRUCTURAL_TAGS` so
the structural comparison sees them.

**Cancelling `beforeinput` cancels the `input` event with it**, and two things ride
on `input`: the protection snapshot (D7 layer three) and `captureTyping`. Without a
synchronous `protect.snapshot` after your own write, the mutation observer reads the
change as a repaint one microtask later and restores the block over it, which looks
exactly like the bug you were fixing.

Never write a browser claim into a test or a comment without running it. A standalone
Playwright script driving all three engines takes about a minute, and `--project=<lane>`
runs one lane for debugging.
