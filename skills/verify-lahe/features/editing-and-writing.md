# Edit text and write new blocks

## Sub-features

Edit an existing passage, add headings and lists, format text, undo, recover through reload, and start a blank notes page.

## How to get to it (user POV)

On the reviewed page, place the caret in a paragraph and press `ControlOrMeta+Shift+KeyE`. Type, use Enter for a new block and Escape to commit. For blank notes use `node bin/lahe.js write <file.md>`.

## Driving it with Playwright

Precondition: the setup and isolation checks in [verify-lahe](../SKILL.md) pass.

Type the worked example, let the scripted agent place it in Markdown, wait for the automatic rebuild, and confirm handled state after reload.

```sh
npm exec -- playwright test test/browser/free_writing_seams.spec.js --grep 'placement: a header' --workers 1 --trace on --output /tmp/lahe-proof-editing-and-writing-free_writing_seams
```

Start from an empty notes page and exercise new writing and later revisions.

```sh
npm exec -- playwright test test/browser/free_writing_seams.spec.js --grep 'notes page:' --workers 1 --trace on --output /tmp/lahe-proof-editing-and-writing-notes
```

Edit through page morphs and reload; confirm replay and unaffected neighboring content.

```sh
npm exec -- playwright test test/browser/cp2_walk.spec.js --workers 1 --trace on --output /tmp/lahe-proof-editing-and-writing-cp2_walk
```

Observable proof: Typed blocks reach review.json and the drain. Source placement produces each block once with its tags and bold text. The reply is handled and the page does not reopen it.

## Gotchas

The map includes blank notes as a distinct entry point. The seed placement test does not cover it. Never force a reload to hide a failed automatic rebuild. Use scripted_agent only as the documented agent boundary.

Source anchors:

- [src/layer/editing.js](../../../src/layer/editing.js)
- [src/layer/replay.js](../../../src/layer/replay.js)
- [src/service/handled_check.js](../../../src/service/handled_check.js)
- [test/browser/free_writing_seams.spec.js](../../../test/browser/free_writing_seams.spec.js)
