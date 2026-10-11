### Resolved

Settled by Ken on [the decisions page](../../ongoing/STABLE_ADDRESSES.md), 2026-10-11:

- **Is the always-on server acceptable?** Yes. It starts at login and stays up.
- **A port per document, or one port with a name per document?** One port, a name per document. Each name is its own browser origin, which also answers the worry about one page reading another.
- **`.lahe` or `.lahe.localhost`?** `.lahe` from the start, with `.lahe.localhost` as the fallback. `.lahe` becoming a real internet ending is unlikely; deal with it then.
- **Login item, or a Mac menu-bar app?** The login item ships with this feature. The menu-bar companion app, with its Library link, is a follow-up.
- **Is an install step acceptable?** Yes. It is for setup only; no outside packages. `lahe install` is Lahe's own command, run with Node from the clone. It writes the login item file, and with `.lahe` turned on, one resolver file. Nothing is downloaded and npm is not needed, so the GitHub-only path (clone, then run) keeps working. Lahe is not published to the npm registry, so there is no second release to keep in step with GitHub.
- **Core platform rule:** the core is a plain server that runs on Mac, Linux, and Windows. Mac-only pieces are companions on top.
- **Deleted files:** not a concern for this feature. A plain "file is gone" page is enough.

Chosen by the brief, for Ken to overrule in review:

- **Which systems get `.lahe` now:** all three, as an option. The setup command does it on macOS. Linux and Windows get written steps in the install guide, and the setup command can take them on later. Ken's point: the same idea works on each system, so document it for all of them. `.lahe.localhost` works everywhere with no setup.
- **Worktree documents:** a gone worktree file is shown read-only from the main checkout when the same file exists there (requirement 13).
- **The name is per folder, not per file.** The architecture review showed per-file names break Markdown images and links, folder sites, the rail rules, and how comments are tied to files. The folder is today's isolation unit, so nothing gets weaker. The address still reads as folder plus file.
- **Other accounts on the same computer** can reach pages whenever the server runs. Recorded as a known limit; `lahe install` warns on a computer with more than one user.

- **How long a document keeps its name after its file is gone:** forever. Names are small, and keeping them means an old bookmark still says what it was.

### Open

::: callout-question
**Q1. Which ending does `lahe review` print: `.lahe.localhost` or `.lahe`?** Ken chose `.lahe`. The fix for one page reading another holds with either ending: it came from a name per document, and each name is its own browser origin under both endings. The question is only which ending costs less. Both architecture reviews found that a plain `http://name.lahe` address is not "secure" to the browser, and that costs five things:

- the address bar shows "Not secure";
- copy buttons lose the clipboard and need an older copy method;
- the guard against two tabs of one document both acting turns off;
- the browser stops sending headers the Library's safety checks rely on;
- on a machine where Lahe does not control `.lahe` lookups, someone on the network could take over a name.

`.lahe.localhost` has none of these, needs no setup on any system, and its addresses survive an uninstall.

**Recommendation:** print `.lahe.localhost`. Keep `.lahe` as an option that answers the same names, for typing by hand. If Ken still wants `.lahe` printed, the plan adds the copy, tab-guard, and header fallbacks (task 6.3), and the "Not secure" label stays.
:::

::: callout-question
**Q2. Drop the port, so an address reads `folder.lahe/file`?** Ken prefers it, even as an extra setup step. Without a port in the address, the browser goes to port 80. Lahe cannot simply listen there: on this Mac, a normal program asking for port 80 is refused (checked on 2026-10-11). So each system needs a one-time admin step that sends port 80 on this computer to Lahe's own port:

- **macOS:** a port forward on the loopback address, set up with the admin password in the same step that turns on `.lahe`. This is how other local dev tools give clean addresses.
- **Linux:** a one-time admin setting that lets normal programs use port 80, or a port forward. Either takes `sudo` once.
- **Windows:** usually allowed with no admin step, unless another program already holds port 80.

The forward only touches requests to this computer's own loopback address on port 80. Requests to websites go to their own servers and never pass through it. The only other traffic it could catch is a local program that also expects port 80 on this computer, which is the "port 80 is taken" case below.

Whatever the feature automates, `docs/INSTALL.md` writes out the steps by hand for each system, so a reader can reach `folder.lahe/file` on a system the setup command does not cover yet.

If something else on the computer already uses port 80 (Docker, a local web server), Lahe keeps printing `:7817` and `lahe status` names the program in the way. `:7817` addresses keep working either way, so a bookmark never breaks when the forward is added or removed.

Dropping the port fixes length, not the "Not secure" label. `folder.lahe/file` still carries the five costs in Q1. The only way to remove them under `.lahe` is serving HTTPS with a certificate Lahe makes and the computer trusts. That is a larger change with its own risks (a trusted certificate on Ken's machine), so it is not in this feature; it can be a follow-up.

**Recommendation:** add the port-80 forward as part of the optional setup, on macOS first, with Linux and Windows in the same feature if the spikes go cleanly. Then the printed address is either `folder.lahe.localhost/file` (secure, no "Not secure" label) or `folder.lahe/file` (shortest), which is Q1.
:::
