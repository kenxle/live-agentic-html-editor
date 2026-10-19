# Open reviews and exchange comments

## Sub-features

Open HTML or Markdown, comment on a passage, send a note, read an agent reply, and end a review.

## How to get to it (user POV)

Run `node bin/lahe.js review <file>` in a disposable state folder and open its printed URL. Select text and use `ControlOrMeta+Shift+KeyC`, type the comment, then `ControlOrMeta+Enter`. The agent drains its session and answers with `lahe reply`.

## Driving it with Playwright

Precondition: the setup and isolation checks in [verify-lahe](../SKILL.md) pass.

From the Library, open the fixture review in a new tab. Add a comment and observe the stub agent reply in the rail.

```sh
npm exec -- playwright test test/browser/catalog_library.spec.js --grep 'Open a closed review' --workers 1 --trace on --output /tmp/lahe-proof-reviews-and-comments-catalog_library
```

Exercise the footer exit control, confirmation and unfinished-work branches.

```sh
npm exec -- playwright test test/browser/end_review.spec.js --workers 1 --trace on --output /tmp/lahe-proof-reviews-and-comments-end_review
```

Observable proof: The real comment reaches the CLI and the reply appears on its card. Ending a review stops its active workflow without losing its history.

## Gotchas

The Library journey stubs the agent, not the service. Component tests in comments_highlights.spec.js inject the layer and are useful regression coverage, but do not alone prove delivery to the service.

Source anchors:

- [src/layer/comments.js](../../../src/layer/comments.js)
- [src/cli/commands/review.js](../../../src/cli/commands/review.js)
- [test/browser/catalog_library.spec.js](../../../test/browser/catalog_library.spec.js)
