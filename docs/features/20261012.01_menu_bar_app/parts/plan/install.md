## Step 3: Installing and keeping it working (workstream install, PR 2)

::: xref
Architecture: "`install.json` gains a `menubar` block", "Install, rebuild, and Quit", "Failure Modes", "Security & Privacy Notes". Brief: R14 to R20. The existing login item: `docs/ongoing/STABLE_ADDRESSES.md` and `src/service/login_item.js`.
:::

### Task 3.1: Build and the app's login item

**Spec:** `src/service/menubar.js`, macOS only: find `swiftc` with `xcrun`, copy the fixed file list from the installed clone's `macos/menubar/` into a fresh temp folder, hash it there, compile it there with `/usr/bin/xcrun swiftc` (argument arrays, never a shell), and rename the result into `<state>/menubar/Lahe.app` only on success, write `~/Library/LaunchAgents/lahe-menubar.plist` (RunAtLoad; KeepAlive only on a crash; the app's arguments pinned as absolute values), record the `menubar` block in `install.json` with the source stamp. Every system call goes through the injectable runner `login_item.js` already uses, so tests run on every system.
**Files:** `src/service/menubar.js`, tests.
**Acceptance:** V21, V22 (logic), V25.

### Task 3.2: Install, uninstall, show, rebuild

**Spec:** `lahe install` on a Mac asks once whether to add the icon; `--menu-bar` and `--no-menu-bar` answer without asking; an existing install plus `--menu-bar` adds only the icon. On Linux and Windows the flag prints that it is macOS only. `lahe uninstall` removes the icon. New `lahe menubar show` (kickstart the app's item) and `lahe menubar rebuild`.
**Files:** `src/cli/commands/install.js`, `src/cli/commands/menubar.js`, `src/cli/index.js`, tests.
**Acceptance:** V21, V22, V23, V25.

### Task 3.3: Rebuild on change

**Spec:** On macOS with the icon installed, the helper's existing 15-second timer compares the source stamp of the fixed file list in the clone named in `install.json` (never a worktree) with the recorded one and, when it changed, rebuilds in a child process and restarts the app. A failed build keeps the old app, writes the error to `menubar.log` and records it in `install.json`, and is not retried until the stamp changes again.
**Files:** `src/service/menubar.js`, the timer's call site in the helper, tests.
**Acceptance:** V24.

### Task 3.4: Starting a stopped helper, and status

**Spec:** `startThroughItem` bootstraps the helper's plist and then kickstarts when kickstart reports the job is not loaded, after checking the plist's contents are what `login_item.js` would write for the recorded install. Labels and paths are constants. `lahe status` prints one line on the icon.
**Files:** `src/service/login_item.js`, `src/cli/commands/status.js`, tests.
**Acceptance:** V26, V27.

**Step test:** `npm run gate:unit` green; on a Mac, `lahe install --menu-bar --state-dir <temp>` against the macapp branch builds and starts the app, and `lahe uninstall` leaves nothing behind.
