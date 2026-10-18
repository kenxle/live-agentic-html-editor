# Lahe skill refactor: instruction audit

The refactor kept the main review workflow, but it left some useful guidance
hard to find or missing. I compared the [skill before the split](https://github.com/kenxle/live-agentic-html-editor/blob/cce0fb6823aa9a5f5f2b2f21494b566ce3c7b5f9/skills/lahe/SKILL.md) with the current [skill router](../../skills/lahe/SKILL.md) and its runbooks. I also checked the [last embedded review contract](https://github.com/kenxle/live-agentic-html-editor/blob/d0413e3196686e6dd4fa0cecb88b13572afbb00e/src/shared/review_format.js) before its instructions moved into the skill.

## Gaps repaired

| Guidance that was hard to find or missing | Where it lives now |
| --- | --- |
| The style switcher lets a reviewer preview a style, then asks the agent to apply it in the source. | [Main routes](../../skills/lahe/SKILL.md) and [document styles](../../skills/lahe/references/feedback.md#document-styles) |
| Save as PDF sends a ready comment. The agent exports and checks the PDF while the review can stay open. | [Main routes](../../skills/lahe/SKILL.md) and [PDF export](../../skills/lahe/references/finish.md#save-as-pdf) |
| Repeating callouts, tinted panels, bands or pull quotes makes a document harder to scan. Markdown components need separate HTML blocks, with HTML inside them. | [Documents](../../skills/lahe/references/documents.md#choose-components-before-writing-sections) |
| A framed app page needs an explicit opt-in for its own rail. Duplicate views such as speaker notes should stay unframed. | [Webapps and builds](../../skills/lahe/references/webapps.md#your-app-in-dev) |
| Earlier committed versions of a hand edit can explain what the reviewer was reaching for, but the current wording is what the agent applies. | [Handle feedback](../../skills/lahe/references/feedback.md) |
| Moving a reviewed document from a worktree to the main checkout keeps its review when the owning session serves the main copy. | [Sessions and handoffs](../../skills/lahe/references/sessions.md) |

## Coverage checked

| Earlier guidance | Current home |
| --- | --- |
| Choosing a page format, writing its title and lede, selecting components, HTML structure, links, diagrams and time stamps | [Documents](../../skills/lahe/references/documents.md) and the [component catalog](../../skills/lahe/references/components.md) |
| Choice buttons, recommendations, recording a decision and changing an answer | [Choice groups](../../skills/lahe/references/choices.md) |
| Serving a page, choosing the source, handing over its URL, monitoring and draining | [Start and watch](../../skills/lahe/references/review.md), [webapps and builds](../../skills/lahe/references/webapps.md), and the host guides linked from the review runbook |
| Locating items, preserving reviewer text, rebuilding, checking handled replies and answering on cards | [Handle feedback](../../skills/lahe/references/feedback.md) and [new writing](../../skills/lahe/references/free-writing.md) |
| Notes, slide decks, multiple pages, takeovers, Library requests, endings and connection problems | [Notes](../../skills/lahe/references/notes.md), [slides](../../skills/lahe/references/slides.md), [sessions](../../skills/lahe/references/sessions.md), [Library](../../skills/lahe/references/library.md), [finish](../../skills/lahe/references/finish.md), and [troubleshooting](../../skills/lahe/references/troubleshooting.md) |

The old repeated gotchas list was intentionally folded into the relevant
runbooks. The embedded `review.json` contract was intentionally removed: that
file now carries review data, while the skill carries agent instructions. The
old Codex instruction to hold a pending monitor call was replaced by the
[current Codex watcher](../../skills/lahe/references/host-codex.md).

This audit checks written instruction coverage. It does not prove how a fresh
agent behaves in a live review. The live comments that surfaced the style,
PDF, and catalog gaps provided direct checks of those routes.

## CI status

The [latest main gate](https://github.com/kenxle/live-agentic-html-editor/actions/runs/39169942441) is green. The previous run failed on installed-skill routing; commit
[`acc14d99`](https://github.com/kenxle/live-agentic-html-editor/commit/acc14d996fc14d25ec3fb4cb44de9ce1fd8e4417) fixed that by excluding clone-only component files from the installed runbook check. The focused local tests pass after this audit's edits. This audit changes only documentation, which the main gate's path filter does not run on.
