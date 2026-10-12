# Name another file as a link: progress

**Needs you:** one call. The pull request is not open yet. The repo rules say the full browser suite runs locally first, and that suite drains your battery. Run it and open the PR, or hold?

## The problem

Agents writing documents for you name other files as bare text. The [PDF button spec](../20261008.01_pdf_button/01_spec_pdf_button.md) ended its summary with "the options weighed are in `00_decision_pdf_button.md`". You read the rendered page, so that name was a dead end: no link, and when the file sits in a worktree, hard to find.

Lahe already turns a relative link into a page you can open, rail included, even across folders. The same spec's header line did it right: `[Decision](00_decision_pdf_button.md)`. So this needed an instruction, not code.

## What changed

The rule, as agents now read it: when a document you write mentions another file the reader may want to open, write it as a link with a path relative to the document. A file name in backticks is a dead end. Code names in a builder brief can stay as code.

It lives in four places:

- **The lahe skill**, [SKILL.md](../../../skills/lahe/SKILL.md), next to "Keep the top of a working document current".
- **The review contract**, [review_format.js](../../../src/shared/review_format.js), so an agent that only reads `review.json` sees it too. Its word-for-word copies in [CONTRACTS.md](../../CONTRACTS.md) and [review_format.test.js](../../../test/unit/review_format.test.js) match, and the bundle is rebuilt.
- **Your global CLAUDE.md** (`~/.claude/CLAUDE.md`), under "Anything you want Ken to read goes in a LAHE document". This reaches agents writing feature-forge and whetstone docs before they load the lahe skill. It is outside any repo, so it has no commit.

## Status

- Branch `docs/link-named-files`, rebased onto today's main. Worktree at `lahe-worktrees/link-named-files`.
- Unit gate: 2,469 passed, 0 failed (before the rebase). The contract test file passes again after it, and the bundle is current.
- Not pushed, no PR. Waiting on your call above.
- Not touched: the PDF spec's summary sentence. That feature has since merged, so the one-line fix can ride in this branch if you want it.
