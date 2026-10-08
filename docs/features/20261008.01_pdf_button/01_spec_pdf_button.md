# PDF button: spec

**Summary:** a button in the rail's top bar that starts a "make a PDF of this page" request to the agent. It fills the note box at the foot of the rail with that sentence and puts the cursor there. The reviewer can add to it and send it with Cmd-Enter. The decision and the options weighed are in `00_decision_pdf_button.md`.

## Problem, user, and context

Turning a reviewed page into a PDF is one of the most common things Ken asks for. He does it by typing "make a PDF of this" into the rail, and the agent runs its PDF tool. Nothing on screen tells a new reviewer this is possible, so they never ask.

The button is an affordance. It does not make the PDF itself. It writes the request for the reviewer, the same way they would have typed it, so they learn the rail is where you ask the agent for things like this.

## Requirements

1. **A PDF button in the top bar.** An icon button in the rail's head, beside the Document style button and before the ⋯ menu. It is always shown, on every page the rail is on. Its hover label and screen-reader name is "Ask the agent for a PDF".
2. **Clicking fills the note box.** The rail switches to the Active tab, the note box at its foot gets the words "Make a PDF of this page.", and the cursor is placed at the end of those words.
3. **It never sends on its own.** The note stays a draft until the reviewer presses Cmd-Enter, exactly like a note they typed. They can add to it first ("one long page", "letter size").
4. **It never erases what the reviewer typed.** If the note box already holds words, the sentence is added after them on a new line. If the box already says "Make a PDF of this page.", the click only moves the cursor there.
5. **A read-only window does nothing.** When this window cannot write to the review (another window holds it), the button is disabled, like the note box itself.

## Approach

No real design call. One new icon in the head and one action on the rail's existing action seam (the same one Copy and Export use). The boot code wires the action to the Active tab's note box. The words are typed into the box through its normal input path, so the draft is saved like any other keystroke.

The icon is Heroicons 2.2.0 `document-arrow-down` (MIT), vendored under `vendor/heroicons/` beside the two icons already there and inlined as path data, the same way.

## Tasks

| # | Task | Files |
| --- | --- | --- |
| 1 | Vendor the icon and record it in the folder's README | `vendor/heroicons/` |
| 2 | Draw the button in the head and send a `pdf` action on click | `src/layer/overlay.js` |
| 3 | Wire the `pdf` action: open the Active tab, fill the note box, place the cursor; disabled while read-only | `src/layer/index.js`, `src/layer/tab_active.js` |
| 4 | Browser test, then screenshots light and dark | `test/browser/pdf_button.spec.js` |

### Verification

| Behavior | Proof | What failure looks like |
| --- | --- | --- |
| Button is in the head on a normal page (requirement 1, the button in the top bar) | browser test finds it by its label | no button, or only on styled pages |
| Click fills an empty note box and focuses it (requirement 2, clicking fills the box) | test reads the box text and the focused element | box empty, or focus elsewhere |
| Nothing is sent without Cmd-Enter (requirement 3, never sends on its own) | test checks the item is still a draft after the click | a ready item appears |
| Existing words are kept (requirement 4, never erases) | test types first, clicks, reads both lines | reviewer's words gone |
| Second click does not double the sentence (requirement 4) | test clicks twice, counts the sentence once | sentence twice |
| Cmd-Enter after the click sends a ready note | test presses Cmd-Enter, sees a ready item with the words | note never reaches ready |
| Read-only window (requirement 5, does nothing when read-only) | test puts the rail read-only, checks the button is disabled | box opens in a window that cannot write |

## Acceptance criteria

- Every row in the verification table passes in `npm run gate`.
- Screenshots of the head with the button, and of the filled note box, light and dark, on the progress page.
- No analytics: the tool has none. No flag: the button is small and safe to ship on.
- No contract or skill change. The request arrives as an ordinary note, which agents already handle.

## Open questions

- None. The wording "Make a PDF of this page." is Ken's own phrasing from how he asks today; change it here if he wants different words.
