For Ken to decide in review:

::: callout-question
**When should an open question stop counting?** Today 45 documents have an old unanswered agent question, and most are from work Ken has moved on from. The brief keeps what you agreed: a question counts until it is answered or the card goes away (R5), and only questions from after the install count (R4). The risk was that questions you choose not to answer pile up with no way to clear them. That way now exists: Mark as done, on the card's state chip, shipped on main and closes any outstanding card. So:

- **A.** Keep R5 as written: a question counts until you answer it or mark it done. Nothing more to build. (Recommended: it keeps a question in front of you until you deal with it, and Mark as done is one click when you decide not to.)
- **B.** A question stops counting once you have read its card, the same as any other reply. The count clears more easily, but a question you read and walked past stops nagging.
- **C.** Count a question only while its document is open in a browser. A question on a closed document waits until you open the document. The number stays small, but a closed document with a question is the one thing nothing else tells you about. (Ken, in review: he had pictured open documents only, and finds flagging closed ones interesting.)

A and C can be combined: count everything, and in the menu show which waiting documents are open right now and which are not.
:::

::: callout-question
**Should "Stop Lahe" hold while agents are connected?** As designed, the next `lahe` command an agent runs starts Lahe again, and a listening agent runs one within seconds. So with an agent connected, Stop barely stops anything. The menu line under it will say so plainly. The security reviewer points out that people reach for Stop when something looks wrong.

- **A.** Keep it as designed: agents can start Lahe again, and the menu warns. Nothing an agent is doing breaks. (Recommended: you rarely stop Lahe, and a stop that breaks your agents mid-review costs more than it saves.)
- **B.** Stop holds until the next login. Agent commands refuse to start it and tell the agent you stopped Lahe. Only Start in the menu, or a command you run, brings it back.
:::

Settled with Ken in the crucible:

- **Which version?** The icon that says when something is waiting on him, plus recent documents and what is open and who is connected. The running indicator, Library link, and Quit stay in.
- **A real Lahe icon in the menu bar.** A SwiftBar script was ruled out (no Lahe icon), and so was a Dock badge (he keeps the Dock hidden).
- **Native Mac code is fine** as long as it is optional and the core stays cross-platform.
- **Built on his Mac with Apple's command line tools** is fine. A Mac without them gets a message and no icon.
- **A wrong count is worse than no count.** The first version counts only what Lahe knows for certain.
- **Agents do not change how they work.** The icon is another way of seeing and reaching what the helper already records.
- **Quit has two items:** hide the icon, or stop Lahe until next login.

- **"Read" is the rail's own read mark (R6), not a new rule.** A reply counts until its card is opened, exactly when the rail drops its "1 new" tag. An earlier draft invented its own rule (the page was the focused tab); Ken asked for the existing mechanism instead.

Chosen by the brief, for Ken to overrule in review:

- **The icon counts documents, not cards (R1).** Each one is one click.
- **Only replies after the install count (R4).** Otherwise the first day shows 45.
- **The icon shows only the "waiting on you" count (R1).** Open documents and connected agents stay in the menu.
- **Sessions are named by their Library name or document (R10),** because Lahe records no agent name today. When board row LAHE-agent-name-default lands, the menu can show "Claude" or "Codex" too.
- **"Stop Lahe until next login" can be undone early by an agent (R14).** An agent's `lahe review` asks for a helper, and refusing would break that agent. The menu says so.
- **Up to 8 rows per list (R12),** tuned on the real menu.
