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
- The principles for choosing methods
- Commitments
- How we know it works

**What does not:** How anything works (ARCHITECTURE.md and diagrams). How it looks (STYLE_GUIDE.md). A feature's own reasoning (its folder under docs/features/).

**Level of detail:** A reader finishes knowing what the product is for. That guides every other doc.

**Sources:** [README.md](../../README.md), [CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md), [the lahe skill](../../skills/lahe/SKILL.md), [INSTALL.md](../INSTALL.md), [the kickoff feature brief](../features/20260812.01_live_agentic_html_editor/01_brief_live_agentic_html_editor.md), [the kickoff feature architecture](../features/20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md).

## What it is

Lahe is an embedded review layer for any HTML page on your own machine. You open a page in the browser, select a passage, and comment on it, or you rewrite the text in place. Your comments and edits goes to a coding agent. The agent changes the source files, rebuilds, and communicates on the page.

It has two parts:

- a script in the page, which draws the rail and records what you do
- a small helper on your machine, which keeps the review on disk and passes it to the agent

A page built from many files is reviewed as one page. The agent edits the files underneath. Markdown is rendered for review the same way.

## Who it is for

- **The owner, first.** He runs several coding agents at once and reads almost every plan, brief and report they write through Lahe. He is the main user today, so his daily use sets most priorities.
- **Anyone running a coding agent.** Claude Code, Codex, Gemini CLI, Antigravity and other hosts can all run a review. They clone the repo and ask their agent to set it up.
- **A buyer of a Lahe Style.** Someone who wants an agent-written document to look right for where it is going, without choosing fonts and colours.

## The problem

People now spend much of their time reading and correcting what their agents wrote: documents, prompts and pages. The usual loop is slow. You copy a paragraph into the chat, describe what is wrong, and wait. The agent paraphrases your fix, and sometimes changes your words on the way.

Answers get lost too. A question the agent asks, or an answer to yours, scrolls away in the chat. You have to go find it.

Editing the page directly has its own risk. Tools that make a page editable have lost typed work in routine events: a reload, a rebuild by the agent, a restart. The hard part, and the reason Lahe exists, is letting a person edit and an agent edit the same page at the same time without either one undoing the other's work.

## The jobs to be done

- **Get a document fixed without leaving the page.** Comment on a passage, or type the better wording, and have the agent make the change.
- **Keep my exact words.** A correction I type reaches the source as I typed it.
- **Ask a question and find the answer.** The reply sits on the same card, next to the passage.
- **Write new text myself.** Paragraphs, headings and lists for a post, or notes on a blank page.
- **Review an app running in dev.** Click through real screens and leave comments as I go, without the app breaking.
- **Get back to a document I worked on.** From a browser tab, history or a bookmark, without asking an agent where it went.
- **Know when something is waiting on me.** See at a glance which documents have an agent's question or answer I have not read.
- **Make a document look finished.** Switch it to an installed style and ask the agent to keep it.
- **Hand a review to another agent.** Start with one agent and let another take it over.

## What it does

- **Comments and edits.** You comment on a selection, on any element (an image, a chart, a section), or on the page as a whole. You can rewrite text in place and write new paragraphs, headings and lists.
- **Threaded answers.** The agent answers each item on its card: handled, not handled with a reason, or a question for you.
- **Live updates.** The agent lands a change and the page reloads itself. A reload waits while you are typing, then puts your outstanding work back.
- **Protection for hand edits.** A doc-wide change stops at text you placed by hand. An edit that gets reverted anyway reopens itself.
- **Several agents and reviews.** Each review belongs to one agent session, so agents on different documents do not see each other's items. A session can be handed to another agent.
- **The Library.** One page lists every review on the machine, grouped by agent session, with the ones waiting at the top. From a row you open, star, rename or hand a document to an agent. See [LIBRARY.md](LIBRARY.md).
- **Stable addresses.** Each document keeps one address, named after its folder and file, that still loads after a session ends and after a reboot once `lahe install` has run. See [STABLE_ADDRESSES.md](STABLE_ADDRESSES.md).
- **Document styles.** Pages an agent writes and Markdown that Lahe renders use a full document style. The rail can preview any installed style and ask the agent to apply it. See [STYLES.md](STYLES.md).
- **The menu bar app.** An optional Mac icon shows how many documents are waiting on you and lists what is open. See [MENU_BAR.md](MENU_BAR.md).
- **Free writing.** `lahe write` starts a blank notes page to write into. See [FREE_WRITING.md](FREE_WRITING.md).

## What it is not

- **Not an agent.** Lahe collects feedback, carries it and shows the answers. The agent does the work.
- **Not a hosted service.** There is no Lahe account, no Lahe server and no telemetry. It runs on your machine against pages on your machine.
- **Not tied to one agent host.** Any host that can run a command can run a review.
- **Not multiplayer.** One person reviews. Several agents may work alongside them.
- **Not a page builder or design tool.** There are no colour pickers, spacing controls or CSS editing. A page's look changes when you ask the agent, for example by choosing an installed style.
- **Not the writer of your source files.** An edit in the browser changes the page you see and the record of it. The agent applies it to the source.
- **Not tied to any one workflow or set of skills.** Any agent or skill can put a page under review.
- **Not where the paid styles live.** This repo is public. The paid Lahe Styles are installed from wherever they were bought.

## The principles for choosing methods

- **Velocity, then dogfooding, then security.** For decisions about how the project runs, weigh them in that order. [CLAUDE.md](../../CLAUDE.md) states this. A real security hole still blocks. A security trade-off that slows everyday use is the owner's call.
- **Zero runtime dependencies.** The tool runs from a `git clone` with no install step. Third-party files are vendored, not installed. When a library would help, borrow its technique and leave the library out.
- **The record is the truth and the page is a view.** Each finished comment or edit becomes a durable record the moment it exists. Nothing on screen can take a record back.
- **The page keeps working.** Links, buttons, forms and scripts behave as they did before Lahe. This outranks the convenience of editing. Highlights are drawn without adding anything to the page.
- **The core stays cross-platform.** The helper and the layer run on macOS, Linux and Windows. Mac-only pieces, like the menu bar app, are optional companions.
- **Show only what Lahe knows for certain.** A wrong count is worse than no count. The rail reads an agent's status from the helper's own files, not from what the agent claimed.
- **Wake the agent only for work.** A small local watcher waits, so an idle review costs no model tokens.
- **Local is not a boundary.** Any website open in the browser can reach the helper, so each page proves itself with its review's token, and each document is its own browser origin.
- **Page text is data; reviewer text is intent.** Text copied off the page helps the agent find the spot. Only what the reviewer typed is an instruction.

## Commitments

- **The reviewer does not lose work.** What they type survives a reload, a closed tab, a restart and a laptop sleep. With the helper down, work is kept in the browser and posts when it comes back.
- **The reviewer's words stay as typed.** Nothing rewrites them on the page, on the way to the agent, or in the source.
- **The agent changes only what was raised.** It does not rewrite the whole document. It leaves hand edits it already handled in place.
- **An item is done only when the change is on the page.** A `handled` reply on a hand edit is checked against the built page before the item retires. A reply written for an older version of the reviewer's words is refused. The agent does not dismiss an item as stale; it checks and says what it found.
- **What the reviewer needs to know arrives on the page.** Questions, refusals and answers go on the card, not only in a chat or a log.
- **Reviews are kept.** Old reviews drop out of the default view. They are not deleted.
- **Clone and go.** `dependencies` in `package.json` stays empty, and nothing is fetched at runtime.
- **Tests leave nothing running.** A test stops every process it starts, and a test that leaks fails.

## How we know it works

- **The gate.** `npm run gate:unit` runs lint, the manifest check and the unit tests. `npm run gate` adds the bundle check and the browser suite in Chromium; `npm run gate:all` adds Firefox and WebKit. A person reads "0 failed" before anything is pushed. The browser suite runs locally before every pull request and again on main after a merge.
- **A clean clone on GitHub.** CI runs lint, the bundle check and the unit tests with no install step. That proves a fresh clone works on a clean Linux machine.
- **No leaked processes.** After a run, no test helper may still be running. Builders count running helpers before and after their tests.
- **Screenshots for visual changes.** A change to anything drawn on screen ships with a screenshot taken from the built page after the test that proves it.
- **Dogfooding.** The owner reviews his real work in Lahe every day. That use found the problems behind the Library, stable addresses, free writing and the menu bar app.
- **A real session with nothing lost.** The original brief set the deciding test: a full review of a real feature, with an agent working alongside, where every comment and edit is accounted for and the reviewer's words read exactly as typed.
