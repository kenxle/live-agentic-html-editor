# Feature Brief: Style switcher

## Problem, User, and Context

A reviewer in Lahe cannot see their document in another style without asking the agent to restyle it, one round trip per look. Lahe ships one house style (the International Style). Ken has built six paid Lahe Styles (Textbook, Folio, Poster, Ledger, Field Guide, Schematic) and the store page already promises: "One click and the entire document style system changes", and "swap a style into an existing Lahe document in one step". Today there is no click and no step.

**Who.** First Ken, who reviews agent-written documents in Lahe daily and owns all six styles. Then a Lahe Styles buyer: someone who runs a coding agent with Lahe, downloaded a style folder, and wants it on their own document now.

**Where.** Desktop browser, the document and the rail open beside a terminal running the agent, mid-review. Switching is a short aside that must not disturb open comment boxes or an edit in progress.

**Outcome.** The reviewer tries every installed style on the real document with one click each, keeps the one they want, and the document carries that style from then on.

Prior work: the crucible (`00_crucible_style_switcher.md`), the house style build (`docs/ongoing/DOC_STYLE_BUILD.md`), and the style folders in Ken's personal repo (`lib/templates/styles/`).

```mermaid
flowchart LR
    I["Install a style folder<br/>(once per machine)"] --> P["Click a style on the rail<br/>page changes at once"]
    P --> P
    P --> K["Use this style<br/>one request to the agent"]
    K --> A["Agent sets the style<br/>in the document's source"]
    A --> D["Document shows that style<br/>wherever Lahe serves it"]
```

## Non-Goals

::: callout-nongoal
- Not restyling pages that carry their own CSS. The switcher only acts on pages that use the Lahe document style.
- Not a style editor. Nobody tunes colours or fonts from the rail.
- Not selling, licensing or checking a purchase. A style on the machine is a style the reviewer may use.
- Not shipping any paid style in the Lahe repo.
- Not a dark mode. Every style today is light.
- Not recolouring Mermaid diagrams per style. They keep the house palette.
- Not a style for a whole folder review in one action. Each page is kept one at a time.
- Not an uninstall command. A style is removed by deleting its folder.
- Not adding a runtime dependency. Lahe still runs from a clone with nothing installed, and its tests use a made-up style.
:::

## Solution Outline

1. **Install.** The reviewer (or their agent) runs one Lahe command on a downloaded style folder. Lahe copies it into its own storage on the machine. The International Style is always there with nothing installed.
2. **Try.** On a page that uses the Lahe document style, the rail offers a style control. It lists the International Style and every installed style. One click restyles the whole page at once. The reviewer can flip through all of them. Nothing goes to the agent.
3. **Keep.** One more deliberate action, "use this style", sends the agent one ordinary request on the Active tab. The agent adds one line to the document's source. The page reloads in that style, and the preview is no longer needed.
4. **Share.** The document now carries its style. Anywhere Lahe serves it, and in a rendered Markdown file saved to disk, it shows that style.

## Requirements

### Trying a style

::: callout-req
**R1. The control appears only where it works.** The rail offers the style control on every page that uses the Lahe document style, rendered Markdown and agent-written HTML alike. On any other page it is absent.
:::

::: callout-req
**R2. It lists what is available.** The International Style is always first and needs nothing installed. Every installed style follows by its own name. The style the page shows now is marked.
:::

::: callout-req
**R3. One click restyles the whole page.** No reload, no agent, no waiting. Open comment boxes, an edit in progress, highlights and anything being typed are untouched.
:::

::: callout-req
**R4. A preview survives a reload.** The agent's rebuilds reload the page, so a preview holds for that page of that review in that browser. It ends when the reviewer picks another style, chooses "back to the document's style", or the document itself comes to carry the previewed style.
:::

::: callout-req
**R5. The rail is honest about a preview.** When the page shows a style the document does not carry, the rail says so in plain words and offers the way back to the document's own style.
:::

### Keeping a style

::: callout-req
**R6. Keeping is one deliberate action.** "Use this style" sends the agent exactly one request, shown as an ordinary item on the Active tab. Flipping through previews sends nothing. The rail shows the request as waiting until the agent answers, and pressing the action again for the same style while one is waiting sends nothing new.
:::

::: callout-req
**R7. The agent applies it correctly from its instructions alone.** The instructions say what to write for an HTML page and for a Markdown file, how to replace a style the page already has, and how to go back to the International Style.
:::

::: callout-req
**R8. A kept style stays with the document.** Once applied, the document shows its style wherever Lahe serves it. A rendered Markdown file saved to disk carries the style's stylesheet and fonts beside it, as it carries the house fonts today, so it still shows the style with no Lahe running.
:::

### Installing styles

::: callout-req
**R9. One command installs a style folder.** The reviewer or their agent points one Lahe command at a downloaded style folder, and the style appears on the rail the next time the control is opened. Installing the same style again replaces it. A companion listing shows what is installed. Removing a style is deleting its folder by hand.
:::

::: callout-req
**R10. A bad folder is refused at install, with a reason.** A style folder is a name, one stylesheet, and optionally its fonts. A stylesheet that pulls anything from the network, or reaches for any file other than its own fonts, is refused. The message says what is wrong and what a style folder needs.
:::

::: callout-req
**R11. No paid styles still shows the control.** With nothing installed, the control offers the International Style and one line naming the command that adds a style.
:::

::: callout-req
**R12. A missing style falls back and says so.** A document that names a style this machine does not have shows in the International Style, and the rail names the style the document asked for.
:::

### Safety

::: callout-req
**R13. A style cannot expose or load anything beyond its own stylesheet and fonts.** Installing one makes nothing else on the machine readable through Lahe, and a hand-copied folder that breaks the install rules is still refused when a page asks for it.
:::

::: callout-metric
With Ken's six styles installed, one of his own documents can be shown in all seven styles in seven clicks, with no reload and no agent involved. One further action keeps the chosen style, and after the agent answers, reloading the page shows the kept style with no preview active. The same flow, run on a made-up test style, passes in the automated suite.
:::

## UX Notes

Guidance for the architecture, which may change it without reopening the brief:

- The control follows the rail's existing patterns and its own type and tokens. No new visual language.
- Each style shows its name and a small strip of its own colours, so a reviewer recognises it before clicking.
- The rail keeps its current look under every style. Only the document changes.
- Keyboard: the panel is reachable and usable from the keyboard, as the head menu is today.

## Analytics / Logging

No analytics: Lahe is a local tool with no telemetry, and this feature adds none. Logging is what a person needs to diagnose "my style does not show":

- the install command prints what it installed or exactly why it refused
- the page server writes one helper-log line, once per server, when it refuses a style file request, naming the style and the reason

## Rollout / Flags

No flag. The feature is additive: a page that names no style looks exactly as it does today, and nothing changes until a style is installed and chosen. The agent instructions change, and they travel together as the repo's rules require (the skill, the contract in the review file, and the restated copies). An agent on an older contract that receives a style request still sees a plain-language note and can ask.

## Questions and Decisions

### Resolved

- **Preview or persist? Both, in sequence.** A click previews in the browser only. "Use this style" asks the agent to write it into the source. Rejected alternatives: preview only (the document never changes, so the store's promise is half true), and the helper applying a remembered style as it serves the page (the file on disk never carries it, so every copy outside Lahe differs). Full reasoning in the crucible.
- **Per page, not per review.** A style belongs to a document, and a folder review can hold documents meant for different places. The preview is kept per page in the browser; the kept style lives in each page's own source.
- **Pages with their own styles are left alone.** A paid style is written against the house style's tokens and components, and would half-apply over someone else's CSS.
- **The request to the agent is an ordinary note, not a new kind of item.** The agent already handles notes, and the review file's contract says intent lives in a note's words.
- **No paid style installed: show the control anyway**, with the International Style and a line on adding a style, so the feature can be found.
- **International Style is the name on the rail** for the free house style, matching the store.
- **No store link in the tool.** The nothing-installed line names the command, not the store. Ken can ask for a link at implementation review.

### Open

None.

## PM Review

| # | Finding | Disposition | Rationale |
|---|---------|-------------|-----------|
| RF1 | A saved Markdown file cannot show a paid style unless its files travel with it | Accepted | R8 now says the stylesheet and fonts are carried beside the saved file |
| RF2 | Nothing covers the keep action while no agent has answered, or a double press | Accepted | R6 adds the waiting state and makes a repeat press send nothing |
| RF3 | "Valid style" was never defined | Accepted | R10 states a style folder in product terms |
| RF4 | The network rule had no testable point | Accepted | R10 refuses at install; R13 also refuses a hand-copied folder when a page asks |
| RF5 | No way to discard a preview | Accepted | "Back to the document's style" added to R4 and R5 |
| RF6 | The agent-instructions and safety requirements read as implementation | Accepted | Reworded as outcomes (R7, agent applies it from instructions; R13, a style reaches only its own files) |
| RF7 | The no-dependencies requirement was a build constraint, and the metric only ran on Ken's machine | Accepted | Moved to Non-Goals; the metric adds a made-up style run in the suite |
| RF8 | "International needs nothing" duplicated the list and nothing-installed requirements | Accepted | Folded into R2 (the list); fifteen requirements are now thirteen |
| RF9 | No way to remove a style | Accepted | Non-goal: delete the folder by hand, stated in R9 |
| RF10 | "That page" was ambiguous | Accepted | R4 says a page of a review in a browser |
| RF11 | UX Notes carried design decisions | Accepted | Marked as guidance the architecture may change |
| RF12 | The store-link question should decide itself | Accepted | Decided: no link; the line names the command. No open questions remain |
