For Ken to decide in review:

::: callout-question
**Should the count include documents you do not have open?** Ken, in review: he had pictured counting only open documents, and finds flagging closed ones interesting. As written, every document counts (R5).

- **A.** Count every document, open or not. A closed document with an unread reply is the one thing nothing else tells you about. (Recommended, with the menu marking which waiting documents are open right now.)
- **C.** Count only documents open in a browser. The number stays small; a closed document waits until you open it.
:::


Settled with Ken in the crucible:

- **Which version?** The icon that says when something is waiting on him, plus recent documents and what is open and who is connected. The running indicator, Library link, and Quit stay in.
- **A real Lahe icon in the menu bar.** A SwiftBar script was ruled out (no Lahe icon), and so was a Dock badge (he keeps the Dock hidden).
- **Native Mac code is fine** as long as it is optional and the core stays cross-platform.
- **Built on his Mac with Apple's command line tools** is fine. A Mac without them gets a message and no icon.
- **A wrong count is worse than no count.** The first version counts only what Lahe knows for certain.
- **Agents do not change how they work.** The icon is another way of seeing and reaching what the helper already records.
- **Quit has two items:** hide the icon, or stop Lahe.
- **Stop holds (R14).** Ken, in review: if he clicks Stop and it immediately restarts, he would be mad. So the helper stays stopped until he clicks Start, runs `lahe install`, or logs in again, and an agent's `lahe` commands fail plainly until then. The earlier draft let agents restart it, with a warning line; the security review had flagged the same thing (SR7).

- **"Read" is the rail's own read mark (R5), and a question is not a special case.** A reply counts until its card is opened, exactly when the rail drops its "1 new" tag. Two earlier drafts gave the icon rules of its own (the page was the focused tab; a question counts until answered). Ken: it should follow the logic we already have, not have its own; the existing logic may need revisiting, but there are not two paths for what counts as read.

Chosen by the brief, for Ken to overrule in review:

- **The icon counts documents, not cards (R1).** Each one is one click.
- **Only replies after the install count (R4).** Otherwise the first day shows 45.
- **The icon shows only the "waiting on you" count (R1).** Open documents and connected agents stay in the menu.
- **Sessions are named by their Library name or document (R10),** because Lahe records no agent name today. When board row LAHE-agent-name-default lands, the menu can show "Claude" or "Codex" too.
- **Up to 8 rows per list (R12),** tuned on the real menu.
