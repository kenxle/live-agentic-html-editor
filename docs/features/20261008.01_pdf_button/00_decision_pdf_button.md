# PDF button in the rail

**Documents:** **Decision** · [Spec](01_spec_pdf_button.md) · [Progress](02_progress_pdf_button.md)

**Decided:** the button asks the agent, the same way you do today. It is an icon in the rail's top bar. Clicking it puts "Make a PDF of this page." in the note box at the foot of the rail and puts the cursor there. The reviewer can add to it ("one long page") and send it with Cmd-Enter.

It fills the box rather than sending at once, for two reasons:

- The reviewer sees what is going to the agent and learns that they could have typed it.
- A click with no agent listening does not quietly send a request nobody answers.

The options below are kept as the record of what was weighed.

---

## Options weighed

Good news first: the rail already takes itself off the page when the page prints. So any printed PDF comes out clean, with no comment highlights and no panel.

## 1. How the button makes the PDF

### A. Open the browser's print window

The button opens the same window as Cmd-P, with "Save as PDF" as the destination.

- Small change: one button and a few lines. No new parts in the helper.
- Works with no helper running, in every browser, on every machine.
- One extra click: the reviewer presses Save in the print window.
- The browser may print the date and the page address in the margins. The reviewer has to untick "Headers and footers" once (Chrome remembers it).
- No "one long page" shape, the one you use for one-sheets. It is always letter pages.

### B. The helper makes the PDF with Chrome, like to-pdf does

The button asks the helper. The helper runs Chrome in the background with the same recipe as your to-pdf skill and the browser downloads the finished file.

- Same output as the PDFs you make today: no margin headers, letter pages or one long page.
- The page can measure its own height in the browser, so "one long page" works without Playwright.
- Bigger change: a new helper route that starts Chrome, plus a security review, since a browser click would start a process on the machine.
- Needs Chrome installed. Without it, the button falls back to A.
- The recipe lives in your private skills folder today. The public repo would get its own copy of the recipe (the Chrome command line, a kept profile, wait for the file).

### C. Ask the agent to make it

The button sends the agent "make a PDF of this page," and the agent runs to-pdf.

- Uses the skill you already have.
- Only works when an agent is listening, and only for people who have that skill. Not something other people would find working.

**Recommendation: A now, B next.** A ships quickly and gives people a button they can find. B is a second change that swaps in the better output, with A kept as the fallback. If the margin headers would bother you on day one, say so and I will go straight to B.

## 2. Where the button sits

- **Its own icon in the rail's top bar**, beside the Document style button (a document-with-arrow icon). Visible without opening anything. Best for "people can find it."
- **An item in the ⋯ menu**, next to Copy review and Export review. Quieter, but hidden one click deep.

**Recommendation: its own icon in the top bar**, with the label "Save as PDF" on hover.
