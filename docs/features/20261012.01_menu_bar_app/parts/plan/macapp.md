## Step 2: The Mac app (workstream macapp, PR 2)

::: xref
Architecture: "`summary.read` response", "`summary.open` request", "Install, rebuild, and Quit", "Failure Modes", "Security & Privacy Notes". Brief: R1 to R14, R17, R18, UX Notes.
:::

### Task 2.1: The app

**Spec:** One Swift file, `macos/menubar/LaheMenuBar.swift`, using AppKit only, and an `Info.plist` with `LSUIElement` so it has no Dock icon. Arguments: `--port`, `--state-dir`, and the helper's login item label, all passed by the login item. It reads `cli-secret` from the state folder, asks `summary.read` every 5 seconds and when the menu opens, and draws the icon and the menu in the brief's order. The icon is a template image drawn in code from the review layer's speech-bubble mark (`src/service/tab_icon.js`), with the count beside it. Four looks: nothing waiting, a count (to 99, then 99+), not running, can't tell.
**Files:** `macos/menubar/LaheMenuBar.swift`, `macos/menubar/Info.plist`, `macos/menubar/README.md` (what it is, how it is built, that nothing here is required).
**Acceptance:** V28, V29.

### Task 2.2: Opening, Quit, Stop, Start

**Spec:** A click calls `summary.open` and opens the returned address only when it passes the allowlist; `url: null` opens the Library. Hide exits with status 0. Stop runs `launchctl bootout` on the helper's label; Start runs bootstrap then kickstart. Labels are checked by the same safe-label rule as `src/service/login_item.js`. Errors go to `menubar.log` in the state folder. A `--self-test` flag runs the allowlist, label check and count formatting and exits non-zero on a failure.
**Files:** the same.
**Acceptance:** V30, V31.

### Task 2.3: Build check and fake helper

**Spec:** `scripts/check_menubar.js` compiles the app with `swiftc` into a temp folder and runs `--self-test`; elsewhere than macOS it prints that it skipped. `test/fixtures/menubar/fake_helper.js` serves the sample summaries on a temp port and can answer 401, 409, a timeout, or nothing, so every look can be shown and screenshot. `npm run check:menubar` runs the build check.
**Files:** `scripts/check_menubar.js`, `test/fixtures/menubar/fake_helper.js`. The orchestrator adds the npm script.
**Acceptance:** V28, V29 screenshots on the progress page, light and dark.

**Step test:** `npm run check:menubar` green on a Mac; screenshots of each look against the fake helper.
