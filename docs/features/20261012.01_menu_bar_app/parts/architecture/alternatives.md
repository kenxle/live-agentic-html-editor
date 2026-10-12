### Approaches Ken ruled out in the crucible

A SwiftBar script (no real Lahe icon) and a Dock badge on the Library (he keeps the Dock hidden). See [the crucible](../../00_crucible_menu_bar_app.md).

### How the app gets its data

- **Chosen: a helper route with the CLI secret.** One place computes "waiting on you", with the helper's own projection, liveness, and window holders. Any future tray icon on Linux or Windows reads the same answer.
- **Rejected: the app reads the state folder itself.** No route to secure, but the Swift app would reimplement the projection, the liveness test, and the waiting rules in a second language. The two would drift, and a drifted count is the wrong count Ken said is worse than none.
- **Rejected: the app runs `lahe status --json` every few seconds.** No new route, but it starts a Node process every poll (tens of milliseconds and real memory each time, against R21), and `lahe status` does not know about windows or seen marks.
- **Rejected: the Library token.** It is minted in memory at each helper start and handed only to the Library page, so the app could not get it without a new handout route, which is a new way to leak it.

### How the app learns something changed

- **Chosen: poll every 5 seconds, with a per-review cache in the helper.** Simple, recovers on its own after the helper restarts, and the cache keeps each poll to a stat per review file. The plan measures it against R21.
- **Rejected for now: a long-poll that the helper answers only on change.** Fewer requests, but liveness ages with time (a monitor going stale changes the answer with no event), so the helper would still need its own timer. It can replace polling later without changing the summary's shape.
- **Rejected: rebuilding the Library list per poll.** 150 ms warm on Ken's 690 reviews, every 5 seconds, is about 3 percent of a core forever.

### When "looked at" happens

- **Chosen: a focused tab on that page, recorded by the helper.** The page already tells the helper whether it is the focused tab; nothing new is asked of Ken.
- **Rejected: per card.** Lahe cannot know which cards Ken read without a new gesture.
- **Rejected: per review.** In a folder review, looking at one page would clear answers on another (PM review RF1).
- **Rejected: any open window.** Ken keeps tabs open for days, so answers would clear the moment they arrived (PM review RF1).

### Where the app is built and kept

- **Chosen: built on the Mac by `lahe install` into the state folder.** A program built locally carries no quarantine flag, so no Apple developer account or signing is needed, and nothing binary goes into the repo.
- **Rejected: a ready-built app in the repo or a release.** Needs signing and notarization to open without warnings, and a binary in a public repo is hard to review.
- **Rejected: `swift LaheMenuBar.swift` as a script at each login.** Compiles on every start, slow and heavy at login.
- **Rejected: AppleScript or JavaScript for Automation with AppKit.** Runs without a compiler, but a long-lived menu bar item from `osascript` is fragile, shows as "osascript" in Activity Monitor, and is hard to test.

### How Stop works

- **Chosen: unload the helper's login item, and teach the CLI to load it again when needed.** A plain kill is restarted at once by `KeepAlive`.
- **Rejected: a "paused" flag the helper reads at start and then exits.** It would fight launchd, which restarts the helper every ten seconds, and agents would see a helper that keeps dying.
