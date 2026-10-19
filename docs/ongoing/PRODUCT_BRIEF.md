# Product brief

## Charter

**What belongs:** What the product is, who it is for, and why. The principles and commitments that hold for every feature.

Sections, in this order:

- Charter
- What it is
- Who it is for
- The problem
- The jobs to be done
- What it does
- What it is not
- The principles for making decisions
- Commitments
- How we know it works

**What does not:** How anything works (ARCHITECTURE.md and diagrams). How it looks (STYLE_GUIDE.md). A feature's own reasoning (its folder under docs/features/).

**Level of detail:** A reader finishes knowing what the product is for. That guides every other doc.

**Sources:**

- [README.md](../../README.md)
- [CLAUDE.md](../../CLAUDE.md)
- [AGENTS.md](../../AGENTS.md)
- [the lahe skill](../../skills/lahe/SKILL.md)
- [INSTALL.md](../INSTALL.md)
- [the kickoff feature brief](../features/20260812.01_live_agentic_html_editor/01_brief_live_agentic_html_editor.md)
- [the kickoff feature architecture](../features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md)

## What it is

Lahe is an embedded review layer for any HTML page on your own machine. You open a page in the browser, select a passage, and comment on it, or you rewrite the text in place. Your comments and edits goes to a coding agent. The agent changes the source files, rebuilds, and communicates on the page.

It has two parts:

- a script in the page, which draws the rail and records what you do
- a small helper on your machine, which keeps the review on disk and passes it to the agent

## Who it is for

- **Someone heavily using AI and wants a better interface than MD readers.** When users need to constantly review documentation from agents, it becomes important to have good workflows for editing, and well-designed documents to read.
- **Someone reviewing a website or app built in html.** Reviewing websites with agents is difficult because you need to constantly explain the section you are talking about. Point and click and then describe is much easier.
- **Someone who wants to make nice documents.** We now have the ability to create documentation for our fellow humans that is much more well designed than before. With agent assistance and styles, users can now create beautiful documentation to share with each other.

## The problem

Collaborative document editing with an agent is slow. Switching windows takes you out of flow. Describing what you want changed is inefficient.

Collaborative editing needs a new UI that is designed specifically for work with agents.

Editing the page directly has its own risk. Tools that make a page editable have lost typed work in routine events: a reload, a rebuild by the agent, a restart. The hard part, and the reason Lahe exists, is letting a person edit and an agent edit the same page at the same time without either one undoing the other's work.

## The jobs to be done

- **Create great content with agents**. I want to make great work, and that requires collaboration between human and agent.
- **Stay in flow**. Make changes without switching windows.
- **Agent drafting.** Agents can write drafts and content from prompts.
- **Edit by hand.** Just type exactly what you want.
- **Write from scratch.** Instead of editing AI-written docs, write paragraphs, headings, lists, or notes on a blank page.
- **Ask a question and find the answer.** Get answers without leaving the document.
- **Review a dev app.** Click through real web app screens and leave comments as I go, while keeping app functionality intact.
- **Find and open past documents.** We need to be able to find and use our past documentation in the future.
- **Know when something is waiting on me.** See at a glance which documents have an agent's question or answer I have not read.
- **Make a document look polished, easily.** Use predefined or user-defined styles to make polished documentation consistently and easily.
- **Work across agents.** Start with one agent and let another take it over.

## What it does

- **Comments and edits.** Leave comments on text, html elements (an image, a chart, a section), or on the page as a whole. Rewrite text in place and write new paragraphs, headings and lists.
- **Protection for hand edits.** If you wrote it, the agent will not change it without asking. A doc-wide change recognizes text you placed by hand. If agents do change your work without asking, there are checks that find the changes and revert to your wording.
- **Threaded answers/conversations.** Comments and edits are answered and confirmed by the agent, and the comments are threaded for easy navigation.
- **Smart live updates.** The agent lands a change and the page automatically reloads. You don't have to think about this, and any additional edits you have made are not destroyed. You just work and updates are merged in seamlessly.
- **Multi-file editing.** A page may be built from many files and reviewed as one page, and the agent edits the files underneath.
- **Multi-agent and multi-document considerations.** One agent may run many documents, but each document has only one agent at a time, and agents don't see other documents unless they explicitly take them over. A session can be handed to another agent.
- **Edit webpages unobtrusively.** Allow a user to use their dev web app and walk through real functionality locally, all while leaving comments for an agent, or making direct edits.
- **The Library.** One page lists every review on the machine, grouped by agent session, with the ones waiting at the top. The library allows you to manage and open documents. See [LIBRARY.md](LIBRARY.md).
- **Stable addresses.** Each document keeps one address. Browser tabs don't show as broken, even if the agent disconnects. See [STABLE_ADDRESSES.md](STABLE_ADDRESSES.md).
- **Document styles.** Make it easy to beautifully style your documents. See [STYLES.md](STYLES.md).
- **The menu bar app.** An optional Mac icon shows information and has links to open documentation. See [MENU_BAR.md](MENU_BAR.md).
- **Free writing.** `lahe write` starts a blank notes page to write into. See [FREE_WRITING.md](FREE_WRITING.md).

## What it is not

- **Not an agent.** Lahe collects feedback, carries it and shows the answers. The agent does the work.
- **Not a hosted service.** There is no Lahe account, no Lahe server and no telemetry. It runs on your machine against pages on your machine.
- **Not tied to one agent host.** Any host that can run a command can run a review.
- **Not multiplayer.** One person reviews. Several agents may work alongside them.
- **Not tied to any one workflow or set of skills.** Any agent or skill can put a page under review.

## The principles for making decisions

- **Velocity, then dogfooding, then security.** For decisions about how the project runs, weigh them in that order. [CLAUDE.md](../../CLAUDE.md) states this. A real security hole still blocks. Velocity of completed work and completed features is the top priority.
- **Don't waste tokens.** This is additional infrastructure and a chat window is also running. Sloppy infrastructural design easily wastes tokens. We respect users on low budgets and this tool does not waste tokens.
- **Don't cause no-ops**. Another for not wasting tokens. We do not want to have an idle document constantly waking an agent and burning tokens when there's nothing to do.
- **Zero runtime dependencies.** The tool runs from a `git clone` with no install step. Third-party files are vendored, not installed. When a library would help, borrow its technique and leave the library out. The one exception is pandoc, an optional system tool Ken allowed on 2026-10-17: when it is installed, Markdown renders through it so fenced divs match the document builds, and without it everything still works.
- **The record is the truth and the page is a view.** Each finished comment or edit becomes a durable record the moment it exists. Nothing on screen can take a record back.

## Commitments

- **Lahe is model agnostic.** You can use any agent with Lahe, including locally run models.
- **No lost work.** Comments and edits survive a reload, a closed tab, a restart and a laptop sleep, etc.
- **The user doesn't need to leave the page.** They can take action, ask questions, do design work, copy work, and dev work all from the page. The agent will communicate on the page. Questions, answers, negotiation go to the chat bar threads, not the terminal window.
- **The users hand-written edits are gospel.** Don't automatically change something the user wrote. Ask if you see grammar and spelling errors.
- **Make edits surgically.** Do not rewrite the whole document.
- **An item is done only when the user can see it.** A `handled` reply on a hand edit is checked against the built page before the item retires.
- **Reviews are kept.** This historical data is useful to analyze.
- **Clone and go.** `dependencies` in `package.json` stays empty, and nothing is fetched at runtime.
- **Tests leave nothing running.** A test stops every process it starts, and a test that leaks fails.
- **A website still works with Lahe.** Links, buttons, forms and scripts behave as they did before Lahe. This outranks the convenience of editing. Highlights are drawn without adding anything to the page.
- **The core stays cross-platform.** The helper and the layer run on macOS, Linux and Windows. Mac-only pieces, like the menu bar app, are optional companions.

## How we know it works

- **Dogfooding.** Use it constantly and make updates.
- **Robust Testing.** See [TESTING.md](TESTING.md).
- **A clean clone on GitHub.** CI runs lint, the bundle check and the unit tests with no install step. That proves a fresh clone works on a clean Linux machine.
- **No leaked processes.** After a run, no test helper may still be running. Builders count running helpers before and after their tests.
- **Screenshots for visual changes.** A change to anything drawn on screen ships with a screenshot taken from the built page after the test that proves it.
