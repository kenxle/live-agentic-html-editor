# Answer choices on a document

## Sub-features

Press a document choice, revise the answer, use keyboard controls, and see reply and persistence states.

## How to get to it (user POV)

Open the helper-served choice-doc.md fixture. Press a button inside a `data-choice-group`, or focus it and press Enter or Space.

## Driving it with Playwright

Precondition: the setup and isolation checks in [verify-lahe](../SKILL.md) pass.

Click the lesson-css-counter promote answer, then merge. Check the newest answer in the drain and the Choice card; also exercise keyboard, reply and reload paths.

```sh
npm exec -- playwright test test/browser/choice_buttons.spec.js --workers 1 --trace on --output /tmp/lahe-proof-choices-choice_buttons
```

Observable proof: The choice stores its group and answer, a second press revises the same pending item, and the drain and visible card agree. Dev-server pages do not intercept ordinary application buttons.

## Gotchas

The group must be on a helper-served document. The spec has a negative dev-server path. The quiet spell may keep the press local before sending; wait for state, not a fixed sleep.

Source anchors:

- [src/layer/choices.js](../../../src/layer/choices.js)
- [test/browser/choice_buttons.spec.js](../../../test/browser/choice_buttons.spec.js)
- [docs/ongoing/CHOICE_BUTTONS.md](../../../docs/ongoing/CHOICE_BUTTONS.md)
