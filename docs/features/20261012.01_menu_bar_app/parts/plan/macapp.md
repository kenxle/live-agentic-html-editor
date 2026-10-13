## Step 2: The Mac app (workstream macapp, PR 2)

::: xref
Architecture: "`summary.read` response", "`summary.open` request", "Install, rebuild, and Quit", "Failure Modes", "Security & Privacy Notes". Brief: R1 to R14, R17, R18, UX Notes.
:::

### Task 2.1: The app

**Spec:** One Swift file, `macos/menubar/LaheMenuBar.swift`, using AppKit only, and an `Info.plist` with `LSUIElement` so it has no Dock icon. Arguments: `--state-dir`, passed by the login item; the port comes from `service.json`. It reads `cli-secret` and `service.json` from the state folder, connects to `127.0.0.1` at the port `service.json` names, signs every request with the `AUTH.CLI_PROOF` wire in `docs/CONTRACTS.md` (CryptoKit HMAC), drops any answer whose signature does not check, asks `summary.read` every 5 seconds and when the menu opens, and draws the icon and the menu in the brief's order. The icon is a template image drawn in code from the review layer's speech-bubble mark (`src/service/tab_icon.js`), with the count beside it. Four looks: nothing waiting, a count (to 99, then 99+), not running, can't tell.
**Files:** `macos/menubar/LaheMenuBar.swift`, `macos/menubar/Info.plist`, `macos/menubar/README.md` (what it is, how it is built, that nothing here is required).
**Acceptance:** V28, V29.

### Task 2.2: Opening, Quit, Stop, Start

**Spec:** A click calls `summary.open` and opens the returned address only when it passes the allowlist (`http`, no user part, `library.lahe.localhost` or a site name plus `.lahe.localhost`, port absent or the pages port), rebuilt from its parsed parts; `url: null` opens the Library. Hide exits with status 0. Stop writes `stopped.json` in the state folder, then runs `launchctl bootout` on the helper's label; while the file stands the menu shows "Stopped by you at <time>" and Start. Start removes the file, then runs bootstrap and kickstart. The line under Stop says agents' commands will fail until he starts it again. Labels and plist paths are constants in the app, never read from a file; tests set their own through a compile-time `-D` flag. Start does not check the plist's contents (architecture, "Install, rebuild, and Quit"). Errors go to `menubar.log` in the state folder.

Debug modes, none of which need any macOS permission: `--self-test` (the allowlist, count formatting, `proof_vectors.json`, and `--decode <file>` for a captured summary; non-zero on a failure), `--snapshot <dir>` (each icon look drawn on a light and a dark background, as PNGs), `--dump-menu` (the built menu's titles, order, enabled state and tooltips as JSON), and a flag that posts the wake notification so V29 can test it.
**Files:** the same.
**Acceptance:** V30, V31.

### Task 2.3: Build check and fake helper

**Spec:** `test/fixtures/menubar/fake_helper.js` serves the sample summaries on a temp port, signs its answers by the wire (and checks `proof_vectors.json` at start), and can answer 401, a signed 409, a timeout, an unsigned answer, or nothing, so every look and every change between looks can be shown. While building, compile the app with a throwaway local command; the committed build recipe is install's. Hand back the exact file list and compiler flags you used.
**Files:** `test/fixtures/menubar/fake_helper.js`.
**Acceptance:** V29 snapshot images and menu dumps on the progress page; the file list and flags in the hand-back.

**Step test:** the app builds, passes `--self-test`, and shows every V29 look and change against the fake helper.
