# Brand

## Charter

**What belongs:** How the product talks: tone, word choice and positioning. How we describe the product. Words we use and words we avoid. Key claims and where each came from.

**What does not:** Anything visual (STYLE_GUIDE.md). What the product does (PRODUCT_BRIEF.md).

**Level of detail:** Rules a writer can apply without asking. No history of past decisions.

**Sources:**

- [README.md](../../README.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/INSTALL.md](../INSTALL.md)
- [skills/lahe/SKILL.md](../../skills/lahe/SKILL.md)
- [LIBRARY.md](LIBRARY.md)
- [DIAGRAMS_PLAN.md](DIAGRAMS_PLAN.md)
- [CLAUDE.md](../../CLAUDE.md)
- the rail's own strings in [overlay.js](../../src/layer/overlay.js), [tab_active.js](../../src/layer/tab_active.js), [tab_done.js](../../src/layer/tab_done.js), [conflict_toast.js](../../src/layer/conflict_toast.js) and [catalog/view_model.js](../../src/layer/catalog/view_model.js)

No research report in the repo backs the brand. The one research file, [element fingerprinting](../research/20260826_element_fingerprinting.md), is technical. The next step is a `research-report` run on how people who review documents with a coding agent describe the problem and the tools they use now.

First draft by Seneschal.

## How we describe Lahe

**In one line:**

> Lahe is the best collaborative editor for documents and websites.

**In one paragraph:**

> Lahe gives you focus, control, and beauty in how you edit documents and websites. You stay in flow because Lahe manages the conversation inside your document or webpage. Interactive modules and beautifully styled documents are easy with pre-shipped styles, and you can use any AI model you want, with no Lahe account and no Lahe telemetry in the middle.

Use the one-liner wherever a single sentence fits: a repo description, a link preview, the top of a doc. Use the paragraph when there is room to say why.

## Positioning

- **Lahe is a quality of life writing and review tool.** Lahe is for editing, writing and reviewing.
- **BYOA (Bring your own agent).** You can use any coding agent with Lahe. Name the hosts it supports by their product names.
- **It is local.** The page, the Lahe program and the review records stay on the reviewer's machine. Say this plainly. Users can manage how their docs are distributed but Lahe edits locally.
- **Lahe optimizes token spend.** An idle document spends no model tokens. The plumbing cares about every token that is used.
- **It works on websites and web apps.** Walk your website and give feedback. The agent edits the files underneath.
- **The user's words are gospel.** Hand edits are not rewritten automatically. Agents can give suggestions, but never overwrite user written content without asking.
- **Lahe, not LAHE.** Don't write the name in all caps.
- **Lahe is beautiful by default.** We sweat the design details, so that your documents are beautiful by default.

## Voice and writing

### Brand voice

How Lahe sounds when it describes itself: the README, the website, a launch post.

- **Confident and calm.** Say what Lahe does well, plainly. No hedging, and no shouting.
- **About the person's work.** Lead with what they get: control, flow, focus, and documents that look good.
- **Concrete.** Name a thing the person can do ("select a sentence and rewrite it") rather than a quality ("powerful editing").
- **A light touch of humor is fine in the README.** It can be a little dry and wry. The product itself stays plain.

### How to talk to the user

How the interface and the agent speak to the person using Lahe.

- **Say what happened, then what to do.** "The Library token is missing. Reload this page." Not an apology, not an explanation of the internals.
- **Reassure with facts, not adjectives.** When something fails, say where the work is: "Kept in this browser." "Nothing is lost. Both versions are on the thread." Do not write "don't worry".
- **About the document, not the tool.** An agent's response says what changed in the document in one sentence, plus one more only for a caveat or a question. It leaves out serving, reloads, rebuilds and reply files unless the user asked. See the reply checklist in [the skill](../../skills/lahe/SKILL.md).
- **Second person to the user, first person from the agent.** The interface says "your edits" and "you marked this done". An agent's response says "I made the change".
- **Quote times as written.** Text that shows a timestamp shows it as recorded. Do not turn it into "3 minutes ago" by hand.

### Default writing preferences

The defaults for any text Lahe or its agents write, unless a document asks for something else.

- **Plain and short.** One idea per sentence. Common words: "do" and "use", not "perform", "utilize" or "leverage". If a sentence needs a second read, rewrite it.
- **No hype words.** No "seamless", "powerful", "revolutionary", "AI-powered", "magic" or "effortless".
- **No em dashes.** Use a comma, period, colon or semicolon. This is a project rule in [CLAUDE.md](../../CLAUDE.md).
- **Few absolutes.** Use "never" and "always" only for a real guarantee the code keeps, such as "a rename is never sent to an agent".

## Names

- **Lahe** in prose, with a capital L and lower case after. Do not use LAHE.
- **`lahe`** in code formatting when it is the command, as in `lahe review page.html`.
- **Live Agentic HTML Editor** is the inspiration for the name, and can be used in parentheticals to describe where the name comes from, but we always call it Lahe.

## Words we use

Use these words the same way in the interface, the docs, the README and agent responses.

| Word | Means | Notes |
| --- | --- | --- |
| reviewer, user | the person in the browser | In text shown to them, say "you". |
| agent | the coding agent doing the work | Name its kind in the interface: "claude is asking". |
| review | one document under review, with its threads | "End review" closes it. |
| session | one agent's run, which owns one or more reviews | Used on the Library page and in hand-overs. |
| chat bar, chat rail | the panel down the side of the page | On first mention to a newcomer: "the chat bar, a panel overlaid on the side of the page". |
| thread, response | a comment or edit and the agent's responses under it, in the chat bar | Say threads, responses, comments and edits. Keep "card" and "item" out of user text. |
| comment | a note on a passage or an element, for the agent to act on | Until sent it is a draft. |
| hand edit | a change the user typed into the page | |
| note on the page | a comment tied to nothing in particular | The input box at the foot of the rail. |
| Done, Open, Question | the three states of a thread | Capitalized as labels, lower case in a sentence. "Done" means the change is on the user's screen. |
| Active, Done | the chat bar's two tabs | "Mark as done" is the user closing a thread themselves. |
| the Lahe program | the program on your machine that serves pages and keeps the records | Say "the Lahe program" to most people. Say "the Lahe server" when the user is doing dev work. Not "helper", "daemon", "backend" or "service" in user text. Say "your dev server" for theirs. |
| Library | the page that lists every review on this machine | Capital L. Opened with `lahe library`. |
| document address | the page's stable URL | |
| Document style | the panel that switches a page's look | |
| Lahe Styles | the swappable styles | International Style is default. Additional styles can be downloaded. |

## Key claims and where they come from

Make these claims as written. Each one has a doc behind it. Do not stretch them.

| Claim | Where it comes from |
| --- | --- |
| No Lahe account, no Lahe server, no telemetry. Comments go to the agent you bring. | [README.md, "Under the hood"](../../README.md#features) |
| Clone it and go. Nothing to install but Node. | [CLAUDE.md](../../CLAUDE.md), [README.md, "Requirements"](../../README.md#requirements) |
| Bring your own agent: Claude Code, Codex, Antigravity, Gemini CLI, or any agent that can run a command. | [AGENTS.md](../../AGENTS.md) |
| Review a site built from many files as one page. Your agent edits the files underneath. | [README.md, "Features"](../../README.md#features) |
| When your agent says it's done, Lahe checks that your page shows it. | [skills/lahe/SKILL.md](../../skills/lahe/SKILL.md) |
| See at a glance whether your agent is listening. | [README.md, "When something goes wrong"](../../README.md#when-something-goes-wrong) |
| Every document you have worked on, in one Library. Your stars and names stay on your machine. | [README.md, "The Library"](../../README.md#the-library), [LIBRARY.md](LIBRARY.md) |
| Every document keeps its address, so old tabs and bookmarks still work. | [README.md, "Addresses that stay put"](../../README.md#addresses-that-stay-put) |
| Beautiful by default. International Style comes built in, and more styles are a download away. | [README.md, "Document styles"](../../README.md#document-styles) |
| Free and open source, MIT licensed. | [README.md, "License"](../../README.md#license) |

Claims to avoid:

- **Windows support for the installer.** Lahe runs on Windows, but the `install-cli` wrapper is macOS and Linux only. Say that.
- **Numbers with no source.** No speed, adoption or savings figures until a report backs them.
