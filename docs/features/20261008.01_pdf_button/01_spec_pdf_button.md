# PDF button: spec

**Documents:** [Decision](00_decision_pdf_button.md) · **Spec** · [Progress](02_progress_pdf_button.md)

**Summary:** a button in the rail's top bar opens a small tray with one choice, "Save as PDF". Choosing it sends the agent the note "Make a PDF of this page." right away, the same note a reviewer would type. The decision and the options weighed are in `00_decision_pdf_button.md`.

## Problem, user, and context

Turning a reviewed page into a PDF is one of the most common things Ken asks for. He does it by typing "make a PDF of this" into the rail, and the agent runs its PDF tool. Nothing on screen tells a new reviewer this is possible, so they never ask.

The button is an affordance. It does not make the PDF itself. It sends the agent the request the reviewer would have typed, and the request shows up as a card like any other note.

## Requirements

1. **A PDF button in the top bar.** An icon button in the rail's head, beside the Document style button and before the ⋯ menu. It is always shown, on every page the rail is on. Its hover label and screen-reader name is "Ask the agent for a PDF".
2. **Clicking opens a small tray.** It hangs under the button, like the ⋯ menu, and holds one item: "Save as PDF". It closes on Esc, on a click anywhere else, and when another tray opens.
3. **Choosing "Save as PDF" sends at once.** A note "Make a PDF of this page." goes to the agent as ready, with no box to fill in. The tray closes and the rail shows the Active tab, where the new card is.
4. **It leaves the note box alone.** Whatever the reviewer was typing in the note box at the foot stays there, unsent.
5. **A read-only window does nothing.** When this window cannot write to the review (another window holds it), the button is disabled.

## Approach

No real design call. One new icon and its tray in the head, and one action on the rail's existing action seam (the same one Copy and Export use). The boot code sends the note with `comments.mintReadyNote`, the call the Document style tray already uses to send its "use this style" note.

The icon is Heroicons 2.2.0 `document-arrow-down` (MIT), vendored under `vendor/heroicons/` beside the two icons already there and inlined as path data, the same way.

## Tasks

| # | Task | Files |
| --- | --- | --- |
| 1 | Vendor the icon and record it in the folder's README | `vendor/heroicons/` |
| 2 | Draw the button in the head and send a `pdf` action on click | `src/layer/overlay.js` |
| 3 | Wire the `pdf` action: send the ready note, show the Active tab; disabled while read-only | `src/layer/index.js` |
| 4 | Browser test, then screenshots light and dark | `test/browser/pdf_button.spec.js` |

### Verification

| Behavior | Proof | What failure looks like |
| --- | --- | --- |
| Button is in the head on a normal page (requirement 1, the button in the top bar) | browser test finds it by its label | no button, or only on styled pages |
| Click opens the tray with "Save as PDF"; Esc and an outside click close it (requirement 2, the tray) | test reads the tray's state and items | no tray, or it hangs open |
| Choosing it sends one ready note with the words (requirement 3, sends at once) | test finds exactly one new ready note reading "Make a PDF of this page." | no note, a draft, or two notes |
| Words in the note box survive (requirement 4, leaves the box alone) | test types in the box, sends from the tray, reads the box | box emptied or its words sent |
| Read-only window (requirement 5, does nothing when read-only) | test puts the rail read-only, checks the button is disabled | box opens in a window that cannot write |

## Acceptance criteria

- Every row in the verification table passes in `npm run gate`.
- Screenshots of the head with the button, and of the filled note box, light and dark, on the progress page.
- No analytics: the tool has none. No flag: the button is small and safe to ship on.
- No contract or skill change. The request arrives as an ordinary note, which agents already handle.
- **Changed after Ken's first read:** the first draft filled the note box and waited for Cmd-Enter. Ken found that confusing and asked for a tray that sends at once.

## Open questions

- None. The wording "Make a PDF of this page." is Ken's own phrasing from how he asks today; change it here if he wants different words.
