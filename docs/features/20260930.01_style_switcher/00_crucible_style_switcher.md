# Crucible: Style switcher

Date: 2026-09-30
Status: ACCEPTED. Ken asked for this to be designed without stopping for him ("don't block for me, just design it in and i'll review the implementation"). The document writer answered every question below from the code, the board and the store page, and recorded the reasoning. Ken reviews the built feature, not this page.

## The idea, as stated

Add a style switcher to the Lahe review rail. A reviewer switches the document they are reviewing between style systems, live, from the rail:

- the free International Style, which ships with Lahe
- the six paid Lahe Styles: Textbook, Folio, Poster, Ledger, Field Guide, Schematic

The public promise on the St. Clair AI store page (`agent_storefront/site/lahe.html`) is: "Can your .doc do this? One click and the entire document style system changes." The styles page adds: "Lahe ships with everything this system needs, so you can swap a style into an existing Lahe document in one step." Ken called this the next thing he wants.

## Jobs to be done

"I have a document my agent wrote. I want it to look right for where it is going (a course handout, a spec sheet, a client report) without picking fonts and colours myself and without asking the agent to restyle it by hand and hoping."

The trigger is a finished or nearly finished document that is about to leave the reviewer's hands. What they do today: accept the house look, or ask the agent to restyle, which means the agent writes new CSS and the reviewer judges it one round trip at a time.

## Who the user is

Two people, in order.

- **Ken.** He reviews agent-written documents in Lahe every day, owns all six paid styles, and built them for this. He is the first user and the only one with real usage today.
- **A Lahe Styles buyer.** Someone who already runs a coding agent and Lahe, bought a $10 style folder, and wants to see it on their own document straight away. They are technical enough to run a command their agent or the README gives them. They have not been observed: the store's checkout is not open yet ("Checkout isn't open yet ... email me and I'll send you Textbook for free").

## User context

Desktop, a browser tab with the document and the Lahe rail open beside a terminal running their agent. Mid-review: they are reading, commenting and editing. Switching style is a short aside in that flow, not a separate task, so it has to take no setup at the moment of use and must not disturb open comment boxes or an edit in progress.

## What already exists

- **No prior feature doc for a switcher.** The nearest work is `LAHE-default-doc-style` (done 2026-09-16, `docs/ongoing/DOC_STYLE_BUILD.md`), which made the International Style the default for rendered Markdown and for pages agents write. It set up the two ways a page reaches the style: inlined in rendered Markdown, and linked as `./.lahe-doc-style.css` for pages an agent writes.
- **The paid styles were built for this.** Textbook's `style.css` header says a style "has to be a folder the switcher can point at", and self-hosts its fonts from `./fonts/` for exactly that reason. All six follow the same shape: `style.css` loaded after the base, `fonts/`, `metadata.json` (name, description, palette), `DESIGN.md`.
- **The store page already sells the result.** "Designed for Lahe ... swap a style into an existing Lahe document in one step." Today that sentence is not true: there is no step.
- **Board.** No open row for a switcher. Open rows compete for time (see Roadmap priority below).
- **Research pass.** Something useful exists as a model, not as code to adopt:
  - Word's Design tab (themes and style sets): hover previews, a click applies and saves the choice in the document. This is the ".doc" the store page is teasing, and it is the model this design follows: preview first, then a deliberate apply that persists.
  - Notion's per-page style choice: one click, saved with the page.
  - Obsidian and Typora themes: a per-user preview that never reaches the file. Good for reading, useless for shipping.
  - The browser's own alternate stylesheets (`<link rel="alternate stylesheet" title>`): built in, but only Firefox exposes a menu for it, and it does not persist.
  - Nothing to install: the switch itself is swapping one `<link>` element, which needs no library. Adopting anything would break the zero-dependency rule for no gain.

## Evidence

- Ken asked for it by name and called it next.
- A public claim on the store page is currently false without it.
- Ken built six styles and paid for their design work; each one names the switcher as its purpose.
- No buyer exists yet, and checkout is closed. There is no observed buyer behaviour at all. Plainly: the evidence is the owner's intent plus a promise already made in public, not user pull.

## Status quo

Ken asks an agent to restyle a document, or copies a style's CSS into a page by hand. Either costs a round trip per look tried, and nobody would try all seven. A buyer today would have to read the style's `DESIGN.md` and wire the stylesheet into each page themselves, which is what "Usable beyond Lahe" on the store page describes, and the opposite of "one step".

## Premises

Decided by the document writer on Ken's delegation. Each is a statement Ken can disagree with at review.

1. **The switcher only acts on pages that use the Lahe document style.** A paid `style.css` is written against the base's tokens and classes. On a page with its own CSS it would half-apply and look broken. Agreed.
2. **Trying a style must be instant and must not involve the agent.** A round trip to an agent per look is the status quo this replaces. Agreed.
3. **Keeping a style must end up in the document's own source.** Otherwise the document looks different outside this browser, and "swap a style into an existing document" is not true. The library never writes the reviewed file (architecture D2), so the agent writes it. Agreed.
4. **Paid styles never ship in the public repo.** A buyer installs a downloaded folder onto their own machine. Agreed.
5. **The International Style is always available, with nothing installed.** Agreed.
6. **This is one feature, not two.** Installing a style and switching between installed styles are only useful together. Agreed.

## The case against building this

Nobody has bought a style, and nobody can yet: checkout is closed. The switcher's main value is to sell styles and to make a store claim true, so building it now is building the showroom before the shop is open. Meanwhile the board has real defects that hurt the daily reviewer: the rail never loads on minified pages (`LAHE-inject-minified-line`), in-page links in Markdown go nowhere (`LAHE-markdown-heading-ids`), and main's CI gate has been red (`LAHE-main-gate-red-rail-hold`). Evidence that would change this: a buyer waiting on the feature, or Ken showing the switcher to someone as the reason to buy. The case is weaker than it looks, because Ken himself uses these styles on his own documents, and a public claim that is false is a cost of its own.

## What happens if we do nothing

The store page keeps promising a one-step swap that does not exist. The first buyer (or the first person Ken sends a free copy to) gets a folder and no way to use it in Lahe except by hand. Ken keeps restyling documents through agent round trips. Nothing breaks; the loss is the sales story and Ken's own time per restyle.

## Approaches considered

### Approach A: Preview only, in the browser

- **Summary:** The rail lists installed styles. A click swaps one stylesheet link in the page. The choice lives in this browser's storage for that page. Nothing reaches the document.
- **Effort:** S. **Risk:** Low.
- **Pros:**
  - smallest diff
  - no agent involvement, no contract change
  - fully reversible
- **Cons:**
  - the document itself never changes, so it looks different everywhere else
  - makes the store's "swap a style into an existing document" only half true
- **Reuses:** the rail's menu and panel patterns, the static server's packaged-asset fallback.

### Approach B: Preview on click, then keep it through the agent (recommended)

- **Summary:** Approach A, plus one deliberate "Use this style" action that sends the agent a note asking it to set the page's style in the source: one stylesheet line in an HTML page, one frontmatter line in a Markdown file. A `lahe style add <folder>` command installs a downloaded style onto the machine.
- **Effort:** M. **Risk:** Medium, from the security surface of serving user-installed files and from the agent contract change.
- **Pros:**
  - one click to try, one more to keep, and the kept style lives in the file
  - respects D2 (the library never writes the file) by using the path every other change already takes
  - no new record kind: the request is an ordinary note
- **Cons:**
  - the contract, the skill and their copies all change together
  - keeping a style depends on an agent being there to apply it
- **Reuses:** notes (R18), the `.lahe-doc-style.css` serving fallback, `copyFonts`, the head menu and the end-review panel pattern.

### Approach C: The helper remembers and applies the style (lateral)

- **Summary:** The helper stores a style per page and adds the link to the page as it serves it, the same way it adds the script line. No agent step.
- **Effort:** M. **Risk:** Medium.
- **Pros:**
  - persists without an agent
  - one click is the whole act
- **Cons:**
  - hidden state: the file on disk never carries the style, so a copy, a commit or a PDF made elsewhere shows the house look
  - a second place that decides how a page looks, which is the drift the style rebuild ended

Also considered and dropped: no rail control at all, with the skill teaching agents the style link so the reviewer just types "use Textbook". Cheap, but it loses the live preview that is the whole promise.

### Do nothing

Keep the store claim false and restyle by agent round trip. We lose the sales demo and Ken keeps paying a round trip per look.

## Recommended approach

Approach B. Trying a look has to be one click and instant, which only a browser-side swap gives. Keeping a look has to reach the file, or the document is not really in that style, and D2 says only the agent writes the file. B is the smallest design that makes both halves of the store's promise true, and it adds no new record kind.

## Challenges the session leader accepted

Answered by the document writer on Ken's delegation, recorded so Ken can overturn them.

- The evidence is intent, not buyer pull. Accepted: build it anyway, because Ken is the first user and the claim is already public.
- Keeping a style must reach the source. Accepted, which rules out Approaches A and C as the whole answer.
- Pages with their own CSS are left alone. Accepted.

## Challenges the session leader rejected

- "Do the board's defects first." Rejected for this slot because Ken named this as next. The defects stay on the board.

## What we skipped and why

Nothing skipped. Every question was answered without Ken, from the code, the board, the style folders and the store pages, as he asked.

## Open questions

- Should the switcher's panel link to the store when no paid style is installed? The design says yes, as one quiet line. Ken may prefer the tool to carry no sales text.
- Mermaid diagrams keep the International palette under every style, because their colours are set in code, not CSS. Left as a known limit.

## The assignment

Write the brief for Approach B. The first real-world check once built: install Ken's six styles with `lahe style add`, open one of his own documents in Lahe, and flip through all seven from the rail.
