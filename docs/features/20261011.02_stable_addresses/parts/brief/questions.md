### Resolved

Settled by Ken on [the decisions page](../../ongoing/STABLE_ADDRESSES.md), 2026-10-11:

- **Is the always-on server acceptable?** Yes. It starts at login and stays up.
- **A port per document, or one port with a name per document?** One port, a name per document. Each name is its own browser origin, which also answers the worry about one page reading another.
- **`.lahe` or `.lahe.localhost`?** `.lahe` from the start, with `.lahe.localhost` as the fallback. `.lahe` becoming a real internet ending is unlikely; deal with it then.
- **Login item, or a Mac menu-bar app?** The login item ships with this feature. The menu-bar companion app, with its Library link, is a follow-up.
- **Is an install step acceptable?** Yes. It is for setup only; no outside packages.
- **Core platform rule:** the core is a plain server that runs on Mac, Linux, and Windows. Mac-only pieces are companions on top.
- **Deleted files:** not a concern for this feature. A plain "file is gone" page is enough.

Chosen by the brief, for Ken to overrule in review:

- **Which systems get `.lahe` now:** macOS. Linux and Windows use `.lahe.localhost`; `.lahe` there is a follow-up.
- **Worktree documents:** a gone worktree file is served from the main checkout when the same file exists there (requirement 13).

- **How long a document keeps its name after its file is gone:** forever. Names are small, and keeping them means an old bookmark still says what it was.

### Open

None.
