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

> Lahe puts a review rail on any HTML or Markdown page on your machine. Comment on it or edit it in place, and your coding agent changes the source.

**In one paragraph:**

> Reviewing a document with a coding agent usually means copying a paragraph into the chat, asking for a change, and hunting for the answer later. Lahe skips that. Open the page in your browser, select a sentence, and comment on it or rewrite it where it stands. Your comment goes to the agent you already use, which edits the real source files, even when the page is built from many of them. The answer comes back on the same card, so it is easy to find. Lahe runs on your machine with no account and no service in the middle.

Use the one-liner wherever a single sentence fits: a repo description, a link preview, the top of a doc. Use the paragraph when there is room to say why.

## Positioning

- **Lahe is a review tool, not an editor or a writing app.** The reviewer reads, comments and fixes. The agent does the work on the source. Lead with that split.
- **It works with the agent you already have.** Do not present Lahe as an agent, or as a replacement for one. Name the hosts it supports by their product names.
- **It is local.** The page, the helper and the review records stay on the reviewer's machine. Say this plainly; it is the main trust claim.
- **It costs nothing while you are quiet.** An idle review spends no model tokens. This matters to people on small plans, so state it where cost comes up.
- **It works on real pages.** Pages built from templates, includes, partials or many Markdown files are reviewed as one page. The agent edits the files underneath.
- **The reviewer's own words are kept.** A hand edit reaches the source as typed, not as the agent's paraphrase.

## Tone

- **Plain and short.** One idea per sentence. Common words. If a sentence needs a second read, rewrite it.
- **Say what happened, then what to do.** "The Library token is missing. Reload this page." Not an apology, not an explanation of the internals.
- **Reassure with facts, not adjectives.** When something fails, say where the work is: "Kept in this browser." "Nothing is lost. Both versions are on the card." Do not write "don't worry".
- **About the document, not the tool.** An agent's reply on a card says what changed in the document in one sentence, plus one more only for a caveat or a question. It leaves out serving, reloads, rebuilds and reply files unless the reviewer asked. See the reply checklist in [the skill](../../skills/lahe/SKILL.md).
- **Second person to the reviewer, first person from the agent.** The rail says "your edits" and "you marked this done". An agent's reply says "I made the change".
- **No hype.** No "seamless", "powerful", "revolutionary", "AI-powered", "magic" or "effortless".
- **No em dashes.** Not in the rail, the docs, commit messages or code comments. Use a comma, period, colon or semicolon. This is a project rule in [CLAUDE.md](../../CLAUDE.md).
- **Few absolutes.** Use "never" and "always" only for a real guarantee the code keeps, such as "a rename is never sent to an agent".
- **A light touch of humor is fine in the README, not in the product.** The README can be a little dry and wry. The rail, error text and agent replies stay plain.
- **Quote times as written.** Text that shows a timestamp shows it as recorded. Do not turn it into "3 minutes ago" by hand.

## Names

- **Lahe** in prose, with a capital L and lower case after.
- **`lahe`** in code formatting when it is the command, as in `lahe review page.html`.
- **Live Agentic HTML Editor** is the long name. Use it as the repo title and on first mention in a long piece, then say Lahe.
- **Avoid "LAHE"** in anything a user reads. Some older text still uses it; see "Where the text disagrees today" below.

## Words we use

These are the rail's own words. Use them the same way in docs, the README and agent replies.

| Word | Means | Notes |
| --- | --- | --- |
| reviewer | the person in the browser | In text shown to them, say "you". |
| agent | the coding agent doing the work | Name its kind when it matters: "claude is asking". |
| review | one document under review, with its cards | "End review" closes it. |
| rail | the panel down the side of the page | On first mention to a newcomer: "the rail, a panel down the side of the page". |
| card | one comment or edit, and its thread, in the rail | The reviewer sees cards. The agent works "items"; keep "item" out of reviewer text. |
| comment | a note on a passage or an element, for the agent to act on | Sent with Cmd-Enter. Until then it is a draft. |
| hand edit | a change the reviewer typed into the page | Not "manual edit" or "direct edit" in rail text. |
| note on the whole page | a comment tied to nothing in particular | The box at the foot of the rail. |
| Handled, Not handled, Question | the agent's three answers on a card | Capitalized as labels, lower case in a sentence. "Handled" means the change is on the reviewer's screen. |
| Active, Done | the rail's two tabs | "Mark as done" is the reviewer closing a card themselves. |
| helper | the small program on your machine that serves pages and keeps the records | Not "daemon", "backend" or "service" in user text. |
| session | one agent's run, which owns one or more reviews | Used on the Library page and in hand-overs. |
| Library | the page that lists every review on this machine | Capital L. Opened with `lahe library`. |
| address | the page's stable URL | "Addresses that stay put." |
| Document style | the rail panel that switches a page's look | |
| Lahe Styles | the paid styles | International Style is the free one. |

## Words that need care

- **"library".** The Library (capital L) is the page that lists every review. Older code and some install text use "library" for the script that draws the rail on a page. In anything new, call that script "the review layer" or "the rail's script", and keep "Library" for the page. In the code the Library is called `catalog`. See [LIBRARY.md](LIBRARY.md).
- **"anchor".** In this repo an anchor is how a saved comment or edit finds its spot on the page again. On an HTML page, `<a>` is also called an anchor, so the word confuses. In user text say "the passage the card is about" or "its spot on the page". In builder docs that must use the word, say once what it means. See [DIAGRAMS_PLAN.md](DIAGRAMS_PLAN.md).
- **"server".** People run their own dev servers. Say "helper" for Lahe's own program, and "your dev server" for theirs.
- **"sidebar".** Fine as a plain explanation for someone who has never seen Lahe. After that, say "rail".
- **"sync".** Say what actually happens: "the page updates itself", "it posts when the helper comes back".
- **"perform", "utilize", "leverage".** Say "do", "use".

## Key claims and where they come from

Make these claims as written. Each one has a doc behind it. Do not stretch them.

| Claim | Where it comes from |
| --- | --- |
| No Lahe account, no Lahe server, no telemetry. Feedback goes only to the agent you already use. | [README.md, "Under the hood"](../../README.md#features) |
| An idle review costs no model tokens on any supported host. | [README.md, "Which agents this works with"](../../README.md#which-agents-this-works-with) |
| No runtime dependencies. A `git clone` runs with no install step. | [CLAUDE.md](../../CLAUDE.md), [README.md, "Requirements"](../../README.md#requirements) |
| Works with Claude Code, Codex, Antigravity and Gemini CLI, and any other host that can run a command. | [AGENTS.md](../../AGENTS.md) |
| Highlighting a passage adds nothing to the page's DOM, so the page's own scripts and styles behave as before. | [docs/INSTALL.md](../INSTALL.md) |
| `lahe review` writes nothing into the page's folder. | [docs/INSTALL.md](../INSTALL.md) |
| A hand edit reaches the source as typed. | [README.md, "Features"](../../README.md#features) |
| A page built from many files is reviewed as one page, and the agent edits the files underneath. | [README.md, "Features"](../../README.md#features) |
| A `handled` reply is checked against the built page. | [skills/lahe/SKILL.md](../../skills/lahe/SKILL.md) |
| The rail shows whether an agent is watching, from the helper's own files, not from what the agent claimed. | [README.md, "When something goes wrong"](../../README.md#when-something-goes-wrong) |
| The Library reads only files on disk, and a rename or a star is never sent to an agent. | [README.md, "The Library"](../../README.md#the-library), [LIBRARY.md](LIBRARY.md) |
| Every document gets one address that keeps working after a session ends and, with `lahe install`, after a reboot. | [README.md, "Addresses that stay put"](../../README.md#addresses-that-stay-put) |
| International Style ships free. | [README.md, "Document styles"](../../README.md#document-styles) |
| MIT licensed. | [README.md, "License"](../../README.md#license) |

Claims to avoid:

- **Windows support for the installer.** The helper runs on Windows, but the `install-cli` wrapper is macOS and Linux only. Say that.
- **Security promises beyond the docs.** Describe what the helper checks; do not call it "secure" or "safe" in general.
- **Numbers with no source.** No speed, adoption or savings figures until a report backs them.
- **"Never lose work" as a blanket promise.** Name the fallbacks instead: browser storage, the outbox, the event log on disk, Copy review and Export review.

## Where the text disagrees today

A writer touching these should bring them in line with the rules above.

- The Library page says "LAHE" in several messages, such as "LAHE is not running". It should say Lahe.
- [docs/INSTALL.md](../INSTALL.md) says "LAHE" and uses "library" for the rail's script.
- One rail message says "Lahe server helper is down". It should say "helper".
- The README badge lists three agent hosts; [AGENTS.md](../../AGENTS.md) also lists Gemini CLI.
- The "End review" button's label says "End this review and perform cleanup".
