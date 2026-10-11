# Stable addresses for documents

## Summary

**Yes, documents should have addresses that keep working.** But a fixed port number alone would not fix what you are seeing. Lahe already tries to reuse a document's old port. Your history links fail mostly because nothing is running at that address anymore, not because the number changed.

The fix that works: the helper starts when you log in and stays up, and it keeps every document's address answering, so a history link loads the page with no agent involved.

This is option D from [the Library ideas page](DOCUMENT_INDEX_IDEAS.md), which we skipped then. It is a real feature (serving, sessions, and security all change), so it would go through feature-forge.

**Needs your answer:** the three questions at the bottom.

## Why your old links fail today

Four reasons, most common first:

- **The document's page server was stopped.** Each document is served by its own small process. The helper stops it two minutes after the last window on it closes, and closing an agent session stops all of its servers. After that, nothing listens at the address. The browser shows its own "can't connect" page, and Lahe gets no chance to help.
- **The helper itself stopped.** When the last session closes and nothing has been open for a couple of minutes, the helper exits. Then even the Library is gone.
- **The port changed.** When a server comes back, it asks for its old port first. It only gets a new one if something else took the old one. This is the rare case.
- **The file moved or was deleted.** A page served from a worktree or a temp folder is gone once that folder is removed.

So "persistent port" is really "something always answering at the document's address".

## Pros of stable addresses

- Browser history, bookmarks, and "reopen closed tabs" work. You stay in the browser.
- Unsent drafts come back. The browser keeps drafts per address, and the port is part of the address. When a port changes, drafts saved under the old one are invisible on the new one.
- Links an agent pasted into chat or into another document keep working.
- Fewer trips to the Library, and fewer "find me that doc" requests to an agent.

## Cons and risks

- **The helper runs all the time.** It would start at login (a macOS login item). An idle Lahe process uses roughly 20 to 50 MB of memory going by the monitors running now, and almost no CPU when nothing is happening. Your battery trouble on 2026-10-07 was nearly two thousand leaked test helpers, not one idle one. Still worth measuring before and after. You are likely OK with this, since the helper has already been optimized.
- **Many open ports.** There are 682 reviews in your state folder. One listening port each is cheap for one process, but macOS starts a login item with a limit of 256 open files, so the helper would need that raised, or only keep addresses for recent and starred documents.
- **Port clashes with your other tools.** Lahe would reserve a range of port numbers away from the common dev-server ones. A clash is still possible; then that one document moves, as it does today.
- **A page is reachable whenever the helper is up.** Today a document's page, and the review token inside it, is reachable only while it is being served. Other websites still cannot read it (the existing host checks stay), but the security review would need to look at it again.
- **Who owns the server changes.** Today the agent session owns its page servers. With stable addresses the helper owns the address, and sessions only own the review. That touches the session docs, the diagrams, and several tests.
- **A link to a deleted file** would open a helper page saying the file is gone, with a link to the Library. Better than "can't connect", but not the document.

## The options

### A. Each document keeps its own port, and the helper answers on it (recommended)

- The first time a document is served, it gets a port from Lahe's range, and that port is recorded as the document's own.
- The helper holds that port open even when no agent is working on the document. When you visit, it serves the page.
- Comments you leave go into the store and wait for an agent, as they do with the Library's Open today.
- Each document keeps its own browser origin. That separation is why documents get separate ports in the first place: one document's page cannot read another's drafts or token.

### B. One address for everything, like `127.0.0.1:7817/r/<review>/`

- Shortest and simplest addresses.
- But every document would share one origin with the helper and the Library page. Any document's page could read every other document's drafts, and could reach the Library's controls. Fixing that is a security redesign. Not recommended.

### C. Keep things as they are, with a nicer dead-link page

- Not possible. When nothing listens on a port, the browser shows its own error page, and Lahe never sees the request.

## Side finding

While checking this, I found 63 page-server processes left running from test runs. 60 of them are from the idle-server tests (state folders named `lahe-idle-state-*`). That is a test leak of the kind CLAUDE.md's "Tests leave nothing running" rule forbids, and it costs battery. It should go on the bulletin as its own fix.

## Questions for you

1. Are you OK with the Lahe helper starting at login and staying up? Leaning yes, from your note on the cons.
2. Should every document keep a working address, or only recent and starred ones? Every document is simpler to explain; recent and starred keeps the port count small.
3. Ready for this to become a feature-forge feature, starting with the brief?
