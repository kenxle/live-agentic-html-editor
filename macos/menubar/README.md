# Lahe menu bar app

An optional Mac extra. It puts the Lahe mark in the menu bar with a count of
the documents waiting on you, and a menu with those documents, the ones
waiting on agents, what is open and connected, recent documents, the Library,
and Hide, Stop and Start. Nothing here is required to use Lahe: the helper,
the review layer and every `lahe` command work the same without it, on every
system.

The design is in [docs/features/20261012.01_menu_bar_app/](../../docs/features/20261012.01_menu_bar_app/).
The wire it speaks is in [docs/CONTRACTS.md](../../docs/CONTRACTS.md), "The
summary routes and the signed-request wire (menu bar)".

## Files

| File | What it is |
| --- | --- |
| `LaheMenuBar.swift` | The whole app. AppKit, Foundation and CryptoKit only. |
| `Info.plist` | The bundle's plist. `LSUIElement` keeps it out of the Dock. |
| `README.md` | This file. Not part of the build. |

The build compiles exactly the first two. No Swift packages, no Xcode project.

## How it is built

`lahe install --menu-bar` builds it on your Mac with Apple's compiler, through
the one recipe in `src/service/menubar.js`, into `<state>/menubar/Lahe.app`.
The bundle is:

```
Lahe.app/Contents/Info.plist          (this folder's Info.plist)
Lahe.app/Contents/MacOS/LaheMenuBar   (the compiled binary; CFBundleExecutable)
```

The command used while building it (from the repository root, output in a
temp folder):

```
/usr/bin/xcrun swiftc -swift-version 5 -target arm64-apple-macosx13.0 -O \
  -o <out>/LaheMenuBar macos/menubar/LaheMenuBar.swift
```

The test build adds `-D LAHE_TEST_LABELS` (see below). Checked with Swift 6.3.1
on arm64. On an Intel Mac the target is `x86_64-apple-macosx13.0`.

## How it works

- The login item runs it as `LaheMenuBar --state-dir <path>`. It reads
  `cli-secret` and `service.json` from that folder and connects to
  `127.0.0.1` at the port `service.json` names, never `localhost`.
- Every 5 seconds, and when the menu opens, it asks `summary.read` with a
  signed proof (the secret itself never travels) and drops any answer whose
  `x-lahe-proof-reply` does not check. Redirects are never followed.
- The icon has four looks: the plain mark (nothing waiting), the mark and a
  count (to 99, then 99+), a struck-through outline (not running), and an
  outline with a question mark (can't tell). "Can't tell" covers a refused
  request, a timeout, an answer it cannot read, a bad signature, a version
  mismatch ("Lahe was updated; rebuilding"), and the time after a wake until
  the first fresh answer. It never shows the last number.
- It reads the secret file again after a 401 or an answer that does not check,
  so a replaced secret recovers on the next poll.
- A click on a document asks `summary.open` and opens the answer only when it
  passes the allowlist: `http`, no user or password, host
  `library.lahe.localhost` or a valid site name followed by `.lahe.localhost`,
  and no port or the pages port from `service.json`. It opens the address
  rebuilt from those parts, never the string it was given. `url: null` opens
  the Library. The Library's address goes through the same check.
- **Hide the icon** exits with status 0. The login item restarts it only after
  a crash, so it stays hidden until the next login or `lahe menubar show`.
- **Stop Lahe** writes `<state>/stopped.json` (`{"by": "menu bar", "at": ...}`)
  and then runs `launchctl bootout gui/<uid>/lahe-helper`. While the file
  stands, the menu shows "Stopped by you at <time>" and **Start Lahe**, which
  removes the file and runs `launchctl bootstrap` on
  `~/Library/LaunchAgents/lahe-helper.plist`, then `kickstart`. It does not
  check the plist's contents (architecture, "Install, rebuild, and Quit").
- The label and plist path are constants in the code, never read from a file.
- Errors go to `<state>/menubar.log`, at most once a minute for a repeating one.

## Debug modes

None needs a macOS permission.

| Command | What it does |
| --- | --- |
| `--self-test [--vectors <file>] [--decode <file>]...` | The allowlist, count formatting, every case in `test/fixtures/menubar/proof_vectors.json` (found under the current folder when `--vectors` is not given), and a decode of each captured summary. Exits 1 on any failure. |
| `--snapshot <dir> [--summary <file>]...` | Each icon look on a light and a dark menu bar, as PNGs. With summaries, also a drawing of the open menu for each, plus not running, stopped and "updated". The real menu cannot be captured without a screen recording permission. |
| `--dump-menu <summary.json>` | The menu built from that summary: titles, order, enabled state, tooltips and actions, as JSON. |
| `--dump-menu none --look <not-running\|stopped\|cant-tell\|updated>` | The menu for a look with no summary. |
| `--watch --state-dir <dir>` | The real poll loop with no icon, printing one JSON line per change of look. Reads `wake`, `poll` and `quit` from stdin; `wake` posts the system wake notification. |
| `--wake-after <seconds>` | Posts the system wake notification once, in any mode that polls. |
| `--action hide\|stop\|start\|library\|open <review>` | Test builds only: runs one menu action the way a click would, then exits. A test build prints an address instead of opening a browser. |

## Testing it

The test build swaps the helper's label for `lahe-test-<id>` (`<id>` from the
`LAHE_TEST_ID` environment variable, else the app's pid) and the plist path
for `<state-dir>/lahe-test-<id>.plist`, so no test can touch the real job.

```
/usr/bin/xcrun swiftc -swift-version 5 -target arm64-apple-macosx13.0 -O \
  -D LAHE_TEST_LABELS -o <out>/LaheMenuBar-test macos/menubar/LaheMenuBar.swift
LAHE_MENUBAR_APP=<out>/LaheMenuBar-test node --test test/unit/menubar_app.test.js
```

That runs every look and change against the fake helper
(`test/fixtures/menubar/fake_helper.js`), opening through the allowlist, and
Hide. Adding `LAHE_MENUBAR_LAUNCHD=1` also runs Stop and Start against a real
launchd job under a `lahe-test-<pid>` label, which the test unloads when it
ends. Without `LAHE_MENUBAR_APP` these tests skip, so `npm run gate:unit` and
CI do not need a Mac.
