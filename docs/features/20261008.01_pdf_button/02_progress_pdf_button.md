# PDF button: progress

**Documents:** [Decision](00_decision_pdf_button.md) · [Spec](01_spec_pdf_button.md) · **Progress**

**Review logs:** [progress](02_progress_pdf_button_review_log.md) · [spec](02_progress_pdf_button_review_log_spec.md) · [decision](02_progress_pdf_button_review_log_decision.md)

**Status:** done. Merged to main in [PR 36](https://github.com/kenxle/live-agentic-html-editor/pull/36) on 2026-10-11, and the helper was restarted on it, so the button is live in every review. Nothing is waiting on you. Closed 2026-10-11 09:44 EDT.

## What it looks like

The button sits in the rail's top bar, between the Document style button and the ⋯ menu. Clicking it opens a tray with one item.

![The tray open, light](screenshots/tray_light.png)

![The tray open, dark](screenshots/tray_dark.png)

Choosing "Save as PDF" sends the note at once. It lands as a ready card in the Active tab, and the note box below it is left alone.

![The sent note, light](screenshots/sent_light.png)

![The sent note, dark](screenshots/sent_dark.png)

The screenshots come from the same build that passed `test/browser/pdf_button.spec.js` (4 passed).

## Checks

- `test/browser/pdf_button.spec.js`: 4 passed. It covers the tray, Esc, click-outside and Tab, a ready note sent once, the switch to the Active tab, the note box left alone, and a read-only window.
- `npm run gate` on the final code: lint and the bundle check clean, unit 2469 passed and 0 failed, Chromium 840 passed.
- After main moved (PR 37), main was merged in and `npm run gate` ran again on that commit: unit 2469 passed and 0 failed, Chromium 840 passed. GitHub's check passed before the merge.
- Tried live on a preview helper: the "Save as PDF" click reached the agent, which made the PDF.
- Code review (one independent reviewer): nothing serious. Two findings, both fixed: the tray now closes when a Turbo page swap rebuilds the page, and the test now proves the switch to the Active tab. Tab also closes the tray now, as it closes the menu.
- Leftover helpers: 1 before the test runs and 1 after (the real helper), so no leaks.

## Follow-ups

Two bugs found along the way went to `docs/BULLETIN.md`:

- `LAHE-gate-rewrites-doc-screenshots`: the browser suite saves over three screenshots in other features' docs, and one slipped into this PR before it was put back.
- `LAHE-serve-restart-foreground`: `lahe serve --restart` keeps the new helper inside the command that started it.

## Cleanup

Done. The stray decision copy in the main checkout, the `pdf-button` worktree with its `node_modules` link and PR-body file, and the preview helper are all gone.

## Log

- **2026-10-11 09:44 EDT.** Shipped the PDF button (PR 36). The first design filled the note box and waited for Cmd-Enter. Ken found that confusing, so the button now opens a tray whose "Save as PDF" sends the note at once. A live preview ran on its own helper, since `lahe review` needs `--port` to reach a helper that is not on 7817. Ken's click on it reached the agent, which made the PDF.
