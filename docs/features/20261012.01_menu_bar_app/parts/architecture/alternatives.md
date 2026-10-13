### Approaches Ken ruled out in the crucible

A SwiftBar script (no real Lahe icon) and a Dock badge on the Library (he keeps the Dock hidden). See [the crucible](../../00_crucible_menu_bar_app.md).

### How the app gets its data

- **Chosen: a helper route with the CLI secret.** One place computes "waiting on you", with the helper's own projection, liveness, and window holders. Any future tray icon on Linux or Windows reads the same answer.
- **Rejected: the app reads the state folder itself.** No route to secure, but the Swift app would reimplement the projection, the liveness test, and the waiting rules in a second language. The two would drift, and a drifted count is the wrong count Ken said is worse than none.
- **Rejected: the app runs `lahe status --json` every few seconds.** No new route, but it starts a Node process every poll (tens of milliseconds and real memory each time, against R21), and `lahe status` does not know about windows.
- **Rejected: the Library token.** It is minted in memory at each helper start and handed only to the Library page, so the app could not get it without a new handout route, which is a new way to leak it.

### How the app learns something changed

- **Chosen: poll every 5 seconds, with a per-review cache in the helper.** Simple, recovers on its own after the helper restarts, and the cache keeps each poll to a stat per review file. The plan measures it against R21.
- **Rejected for now: a long-poll that the helper answers only on change.** Fewer requests, but liveness ages with time (a monitor going stale changes the answer with no event), so the helper would still need its own timer. It can replace polling later without changing the summary's shape.
- **Rejected: rebuilding the Library list per poll.** 150 ms warm on Ken's 690 reviews, every 5 seconds, is about 3 percent of a core forever.

### When "read" happens

- **Chosen: the rail's own read mark, posted to the store.** The card's "1 new" tag already knows exactly which reply Ken opened, and the rule for which replies need reading already exists. The page posts that mark as a `reply.seen` event, the shape Mark as done uses, and the rule moves to `src/shared/` so the helper runs the same one. Nothing new is asked of Ken, and the icon and the rail cannot disagree.
- **Rejected: the page is the focused tab, recorded by the helper.** The first draft. It was a second rule for "read", beside the rail's, so the icon could say 2 while the rail said "1 new" on three cards, or the reverse. Ken, in review: use the existing mechanism, do not make a new one. It also needed a new `focused` claim field and a cap on a new `page` field (SR3).
- **Rejected: per review.** In a folder review, reading one page would clear replies on another (PM review RF1).
- **Rejected: any open window.** Ken keeps tabs open for days, so replies would clear the moment they arrived (PM review RF1).

### Where the app is built and kept

- **Chosen: built on the Mac by `lahe install` into the state folder.** A program built locally carries no quarantine flag, so no Apple developer account or signing is needed, and nothing binary goes into the repo.
- **Rejected: a ready-built app in the repo or a release.** Needs signing and notarization to open without warnings, and a binary in a public repo is hard to review.
- **Rejected: `swift LaheMenuBar.swift` as a script at each login.** Compiles on every start, slow and heavy at login.
- **Rejected: AppleScript or JavaScript for Automation with AppKit.** Runs without a compiler, but a long-lived menu bar item from `osascript` is fragile, shows as "osascript" in Activity Monitor, and is hard to test.

### How Stop works

- **Chosen: a `stopped.json` marker plus unloading the helper's login item.** A plain kill is restarted at once by `KeepAlive`, so the item is unloaded; the marker is what makes the stop hold, because the CLI refuses to load the item again while it stands. Ken, in review: a Stop that restarts itself would make him mad.
- **Rejected: unload the item and let any `lahe` command load it again.** The first draft, with a warning line in the menu. With an agent listening, Stop lasted seconds (SR7, and Ken's answer above).
- **Rejected: a "paused" flag the helper reads at start and then exits.** It would fight launchd, which restarts the helper every ten seconds, and agents would see a helper that keeps dying. The marker chosen is read by the CLI before anything is loaded, so launchd never sees a dying helper.
