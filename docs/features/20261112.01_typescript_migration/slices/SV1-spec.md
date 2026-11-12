---
read-when: Building or reviewing slice SV1 of the TypeScript migration.
---

# SV1 spec: the server's leaves, rebuilt under `src/server/`

SV1 converts the eight server files that import no other server file, and moves the pandoc filter beside its runner. Together they are the bottom of the server's import graph: where the helper keeps its files, the login item and everything around it, the source-age check, the pandoc runner, the tab icon, the healer that puts a stripped script line back, the `.lahe` name server, and the "is anything holding this file open" probe.

The slice also carries one deliberate fix that people will notice: board row LAHE-install-over-loaded-item, where `lahe install` failed with launchd error 5 and its rollback left no server running (section 6, D1 and D2).

## 1. Scope

### Old files

Counted by `count_lines.py` (first-non-space comment definition: a line starting `//`, `/*` or `*`, or `--` in Lua). The counting scripts named in this spec (`count_lines.py`, `callers.py`, `exports.py`, `tests.py`) ran from the spec writer's scratchpad on 2026-11-12 and are not kept; rerun the same scans if a count matters.

| File | Lines | Comment | Blank | Code |
| --- | --- | --- | --- | --- |
| `src/service/heal.js` | 293 | 109 | 24 | 160 |
| `src/service/login_item.js` | 895 | 229 | 64 | 602 |
| `src/service/name_server.js` | 172 | 42 | 10 | 120 |
| `src/service/pandoc.js` | 329 | 103 | 24 | 202 |
| `src/service/lahe_render.lua` | 457 | 75 | 38 | 344 |
| `src/service/source_stamp.js` | 161 | 82 | 11 | 68 |
| `src/service/state_dir.js` | 562 | 195 | 51 | 316 |
| `src/service/tab_icon.js` | 105 | 53 | 8 | 44 |
| `src/service/watchers.js` | 203 | 87 | 11 | 105 |
| total | 3,177 | 975 | 241 | 1,961 |

### New modules

All under `src/server/`, which may import `src/contract/` and `src/domain/` only. `login_item.js` does five unrelated jobs, so it splits into six modules inside its target folder, as the target layout allows.

| New module | From | Job |
| --- | --- | --- |
| `src/server/sites/heal.ts` | `heal.js` | Put a stripped script line back into a rebuilt static page, and the mtime the reload trigger reads |
| `src/server/sites/name-server.ts` | `name_server.js` | Answer DNS queries for names under `.lahe` on 127.0.0.1 |
| `src/server/system/login-item.ts` | `login_item.js` | What a login item is on each system: labels, the program it runs, its file's text, its service-manager commands, writing the file |
| `src/server/system/service-manager.ts` | `login_item.js` | Running service-manager commands: the runner, loading an item (the error 5 fix), and starting the helper through an installed item |
| `src/server/system/install-record.ts` | `login_item.js` | `install.json`: where it is, reading, writing, the typed view of the fields the server reads, and when a reinstall is due |
| `src/server/system/stop-hold.ts` | `login_item.js` | `stopped.json`: the menu bar's Stop hold, its one-line message, and whether launchd started this process |
| `src/server/system/admin-steps.ts` | `login_item.js` | The two macOS root steps: the `.lahe` resolver file, the port 80 forward, and the constant scripts `sudo` runs |
| `src/server/system/quiet-moment.ts` | `login_item.js` | Waiting for a moment when no review's log is being written |
| `src/server/system/source-stamp.ts` | `source_stamp.js` | Whether a running helper is older than the code on disk |
| `src/server/rendering/pandoc.ts` | `pandoc.js` | Find pandoc and render Markdown through it, or say why not |
| `src/server/rendering/lahe_render.lua` | `lahe_render.lua` | Moved with `git mv`, byte for byte unchanged |
| `src/server/rendering/tab-icon.ts` | `tab_icon.js` | The fallback tab icon, the Library's icon, and the rule that a page's own icon wins |
| `src/server/store/state-dir.ts` | `state_dir.js` | Where the helper keeps its files, the path-safety rules on that folder, and owner-only writes |
| `src/server/sessions/watchers.ts` | `watchers.js` | Whether anything on the machine holds a file open, cached off the poll path |

### Forwarders

Each old `.js` path becomes a one-line CommonJS forwarder, listed in `FORWARDERS` in `src/shared/manifest.js` (owner `TypeScript SV1`) and removed from `NON_BUNDLE_FILES`. None of these files is in the browser bundle, so no registration is needed.

```js
// src/service/heal.js
module.exports = require("../server/sites/heal.ts");
// src/service/login_item.js
module.exports = Object.assign({}, require("../server/system/login-item.ts"), require("../server/system/service-manager.ts"), require("../server/system/install-record.ts"), require("../server/system/stop-hold.ts"), require("../server/system/admin-steps.ts"), require("../server/system/quiet-moment.ts"));
// src/service/name_server.js   -> ../server/sites/name-server.ts
// src/service/pandoc.js        -> ../server/rendering/pandoc.ts
// src/service/source_stamp.js  -> ../server/system/source-stamp.ts
// src/service/state_dir.js     -> ../server/store/state-dir.ts
// src/service/tab_icon.js      -> ../server/rendering/tab-icon.ts
// src/service/watchers.js      -> ../server/sessions/watchers.ts
```

The six modules behind `login_item.js` must not export the same name twice, because `Object.assign` would let the later one win silently. `lahe_render.lua` gets no forwarder (nothing requires it; `pandoc.ts` finds it beside itself). Its manifest entry stays in `NON_BUNDLE_FILES` with the path changed to `src/server/rendering/lahe_render.lua`, because lint's completeness check skips only `.ts` and project files.

### New tests

One `.ts` file per module with behavior, under `test/unit/server/<folder>/<module>.test.ts`. `test/unit/login_item.test.js` moves with `git mv` to `test/unit/server/system/login-item.test.ts` and `test/unit/name_server.test.js` to `test/unit/server/sites/name-server.test.ts`; every other old file keeps the cases that drive unconverted modules (section 5), and the builder removes from it only the cases it carried.

### Folder docs

New: `docs/ongoing/code/server-system.md`, `server-rendering.md`, `server-store.md`, `server-sessions.md`. Extended: `server-sites.md` (two sections). Drafts are in section 9.

## 2. Behavior

Each statement is something a caller, a person or an agent can observe, and a test can check. Exact strings are exact. "Refused" means an `Error` is thrown with the message given.

### `sites/heal.ts`

- **B1.** `isStaticPage(file)` is true exactly when the file's extension is `.html` or `.htm`, in any letter case. `page.HTML` is true; `page.md`, `page`, a folder name with no extension, and `page.html.bak` are false.
- **B2.** `fileMtimeIso(file)` returns the file's modification time as an ISO string when the path is a regular file, and `null` when it is missing, unreadable or a directory. It reads and writes nothing else.
- **B3.** `createHealer({ log, bundle, now })` returns a healer with its own memory; two healers never share what they have seen. `now` defaults to `Date.now`; the stability window and `lastHealAt` are both measured on it.
- **B4.** `healer.consider(page)` returns `null` when `page.path` is missing or not a regular file, writes nothing, and creates no file at that path.
- **B5.** For a regular file that is not a static page (B1), `consider` returns its mtime ISO string and never reads or writes the file.
- **B6.** The first time a healer sees a given mtime for a path, `consider` returns that mtime and does nothing else, even when the file has no script line.
- **B7.** A later call that finds the same mtime acts only once at least `STABLE_MS` (500) has passed on the healer's clock since that first sighting. Before that it returns the mtime and does nothing. A call that finds a different mtime is a new first sighting (B6), however long the earlier version sat still.
- **B8.** Once stable, when `page.servedBy()` answers true, nothing is written and `servedBy` is not asked again until the file's mtime changes. `servedBy` is not asked on a first sighting.
- **B9.** Once stable, a file whose first script line carries `page.review` is left alone, and is not looked at again until its mtime changes.
- **B10.** Once stable, a file whose first script line carries a different review id is left alone, and the healer logs exactly once for that mtime: `review <review>: not healing <path>, it carries review <other> now, so it was re-attached somewhere else on purpose`.
- **B11.** Once stable, a file with no script line gets one. The tag is `scriptTag({ src: <helperOrigin> + "/lahe-layer.js", review, token, helper: <helperOrigin>, fallback: <basename of bundle> })`, placed by `placeScriptLine`. Every other byte of the file is kept. The tag carries no `data-lahe-document` attribute.
- **B12.** The write is atomic: the new contents go to a temp file in the same folder named `.<file name>.lahe-<12 hex characters>`, which is renamed over the file. No temp file is left behind, whether the rename succeeds or fails.
- **B13.** After writing the line, the healer copies the file at `bundle` into the page's folder under the bundle's basename, and logs `review <review>: a rebuild stripped the script line out of <path>, so it was put back <where>`, where `<where>` is `placeScriptLine`'s phrase (for example `just before </body>`).
- **B14.** When the copy fails (the bundle is missing, say), the line stays in the file and the healer logs `review <review>: the script line is back in <path> but the fallback copy beside it was not refreshed (<error message>)`, then the B13 line.
- **B15.** After a heal, `consider` returns the file's new mtime, which the page's reload trigger reads. Later calls that find that same mtime never read or write the file again: one heal, one mtime bump.
- **B16.** When the write fails, the file is unchanged, the healer logs `review <review>: could not put the script line back into <path> (<error message>)`, `consider` returns the mtime from before the attempt, and nothing is tried again until the file's mtime changes.
- **B17.** When the file cannot be read after it is stable, `consider` returns its mtime, logs nothing, and the next call tries again.
- **B18.** `healer.lastHealAt(review)` is `null` until that healer has healed a page for that review, then the ISO time of the latest heal, on the healer's clock.

### `sites/name-server.ts`

- **B19.** `respond(packet)` answers a standard query (QR clear, opcode 0, exactly one question) for a name of one or more labels ending in `lahe`: the reply keeps the query's id and question, sets QR and AA, echoes RD, sets no RA, and has RCODE 0.
- **B20.** For such a name, type A gets one answer `127.0.0.1` and type AAAA one answer `::1`, each with a name pointer to the question, class IN and a TTL of 5 seconds. Names match without regard to letter case.
- **B21.** For such a name, any other type gets RCODE 0 and no answer.
- **B22.** Any other name gets RCODE 5 (REFUSED) and no answer: `example.com`, `lahe.example.com`, `a.lahe.localhost`, the bare `lahe`, `evil-lahe`. So does class other than IN for a `.lahe` name.
- **B23.** `respond` returns `null` (no reply at all) for a packet that is not one well-formed standard query: shorter than the 12-byte header, a response, a non-zero opcode, a question count other than one, a name cut off, a question cut off before its type and class, a label longer than 63 bytes, a compression pointer in the name, or a name longer than 255 bytes.
- **B24.** `isLaheName(name)` is true for one or more non-empty labels followed by exactly `lahe` (case-sensitive; callers pass lowercased names), and false for `lahe`, `a..lahe`, `.lahe` and `a.lahe.`.
- **B25.** `createNameServer({ port, onQuery, log })` returns a server whose `start()` binds UDP on 127.0.0.1 only (port 0 or no port picks a free one) and rejects when the bind fails. `port()` is the bound port, or `null` before start and after close.
- **B26.** A running server answers each query as `respond` does, and calls `onQuery` with the question's name, lowercased, for every well-formed query before it answers. Malformed packets get no reply and no `onQuery` call. A throw from `onQuery` does not stop the answer.
- **B27.** A socket error after start is passed to `log` as `name server error: <message>`; a throw from `log` is ignored and the server keeps answering. `close()` resolves, and resolves again when called a second time.
- **B28.** `ENDING` is `"lahe"`, `TYPE` is `{ A: 1, AAAA: 28 }` and `RCODE` is `{ NOERROR: 0, REFUSED: 5 }`.

### `system/login-item.ts`

- **B29.** `systemFor(platform)` is `"macos"` for `darwin`, `"linux"` for `linux`, `"windows"` for `win32`, and `null` for anything else.
- **B30.** `helperArgs({ node, entry, port, stateDir })` is `[node, entry, "serve", "--always-on", "--port", String(port), "--state-dir", stateDir]`, with spaces kept inside each argument.
- **B31.** `LABEL` is `"lahe-helper"` and `MENUBAR_LABEL` is `"lahe-menubar"`. `parseLabel(value)` accepts a string of ASCII letters, digits, `.`, `_` and `-` that does not start with `.`, and refuses anything else (`../x`, `a b`, `""`, a non-string) with `not a login item label: <JSON of the value>`.
- **B32.** `knownLabel(value)` accepts only `lahe-helper`, `lahe-menubar`, or a label matching `lahe-test` or `lahe-spike` optionally followed by `-` and letters, digits, `_` or `-`. It refuses a label that fails B31 with B31's message, and any other valid label with `` install.json names <JSON>, which is not a label lahe install writes; run `lahe install` again ``.
- **B33.** `describe(spec)` for macOS gives `path` `<home>/Library/LaunchAgents/<label>.plist` (label defaults to `LABEL`; it must pass B31), `domain` `gui/<uid>`, `load` `[["launchctl", "bootstrap", "gui/<uid>", <path>]]`, `start` `[["launchctl", "kickstart", "gui/<uid>/<label>"]]` and `unload` `[["launchctl", "bootout", "gui/<uid>/<label>"]]`.
- **B34.** The macOS `contents` is `plistText(label, helperArgs(spec), <stateDir>/login-item.log)`, and `plistText` writes exactly these lines joined by `\n`, with a final newline: `<?xml version="1.0" encoding="UTF-8"?>`; `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`; `<plist version="1.0">`; `<dict>`; `  <key>Label</key>`; `  <string><label></string>`; `  <key>ProgramArguments</key>`; `  <array>`; one `    <string><arg></string>` per argument; `  </array>`; `  <key>RunAtLoad</key>`; `  <true/>`; `  <key>KeepAlive</key>`; `  <true/>`; `  <key>StandardOutPath</key>`; `  <string><log></string>`; `  <key>StandardErrorPath</key>`; `  <string><log></string>`; `</dict>`; `</plist>`. Every value is XML-escaped (`&`, `<`, `>`, `"`). With `{ keepAliveOnCrash: true }` the two KeepAlive lines become `  <key>KeepAlive</key>`, `  <dict>`, `    <key>SuccessfulExit</key>`, `    <false/>`, `  </dict>`. These bytes are what installed plists on people's machines hold, and B52 compares against them, so a single changed byte refuses every existing install.
- **B35.** `describe` for Linux gives `path` `<configHome>/systemd/user/<label>.service`, where `configHome` defaults to `<home>/.config`. The `contents` are exactly `[Unit]`, `Description=Lahe helper: serves review pages at stable addresses`, blank, `[Service]`, `ExecStart=<args>`, `Restart=always`, `RestartSec=2`, blank, `[Install]`, `WantedBy=default.target`, joined by `\n` with a final newline. Each argument in `ExecStart` is wrapped in double quotes with `\` doubled, `"` escaped as `\"`, `%` doubled and `$` doubled, and the arguments are joined by one space. `load` is `systemctl --user daemon-reload` then `systemctl --user enable --now <label>.service`; `start` is `systemctl --user start <label>.service`; `unload` is `systemctl --user disable --now <label>.service`.
- **B36.** `describe` for Windows refuses any argument holding `"` with `refusing a path with a quote character: <arg>`. Otherwise `path` is `<stateDir>/login-item.xml` and the `contents` are the old module's Task Scheduler XML, byte for byte: declared `UTF-16`; a LogonTrigger for `user`; a TimeTrigger repeating every `PT1M` with `StartBoundary` set to `now` (default the current time) in local time as `YYYY-MM-DDTHH:MM:SS`; the principal `InteractiveToken` at `LeastPrivilege`; `IgnoreNew`, `Hidden` true, `ExecutionTimeLimit` `PT0S` and `RestartOnFailure` every `PT1M` up to 999 times among its settings; and one action running `conhost.exe` with arguments `--headless` followed by each argument quoted by B37, the whole XML-escaped. `load` is `schtasks /Create /TN <label> /XML <path> /F` then `schtasks /Run /TN <label>`; `start` is `schtasks /Run /TN <label>`; `unload` is `schtasks /End /TN <label>` then `schtasks /Delete /TN <label> /F`.
- **B37.** `windowsQuote(arg)` leaves a non-empty argument with no space, tab, newline or `"` bare. Otherwise it wraps the argument in `"`, doubles backslashes only where they come before a `"` or the closing quote, and escapes each `"` as `\"`. Examples: `serve` to `serve`; `C:\a b\c` to `"C:\a b\c"`; `a\"b` to `"a\\\"b"`; `trail\ ` to `"trail\ "`; `end\` to `end\`; `sp end\` to `"sp end\\"`; the empty string to `""`.
- **B38.** `startCommands({ system, label, uid })` checks the label with B32 before building anything, and gives `[["launchctl", "kickstart", "gui/<uid>/<label>"]]` on macOS (uid defaults to this process's), `[["systemctl", "--user", "start", "<label>.service"]]` on Linux and `[["schtasks", "/Run", "/TN", <label>]]` on Windows. Any other system is refused with `install.json names no system this clone knows: <JSON>`.
- **B39.** `writeItem(item)` creates the item's folder if needed and writes its contents at `item.path` with mode 0644: UTF-8 for macOS and Linux, and for Windows UTF-16LE with a byte-order mark (`FF FE`).

### `system/service-manager.ts`

- **B40.** `runCommands(commands, runner)` runs each command in order through the runner, as a program and an argument list with no shell, and stops at the first one whose status is not 0. It then answers `{ ok: false, failed, notLoaded }`, where `failed` is `<the command's words joined by spaces> exited <status>`, followed by `: <output, trimmed, first 400 characters>` when there was output. Otherwise it answers `{ ok: true, failed: null }`.
- **B41.** `notLoaded` is true when the failing command's status is 113, or its output contains `could not find service` in any letter case: launchd's answer for a label it has no record of.
- **B42.** `defaultRunner(command, args)` runs the program without a shell and with no window, and answers `{ status, output }` with stdout followed by stderr. A program that cannot be spawned answers status -1 with the error's message as output. Every command has a 30-second limit except `sudo`, which has none: `runnerTimeoutMs("sudo")` is 0 and `runnerTimeoutMs("launchctl")` is 30000.
- **B43.** (New, D1.) `loadItem(item, options)` on Linux and Windows runs `item.load` as B40 does, and nothing more.
- **B44.** (New, D1.) `loadItem` on macOS first runs `launchctl bootout gui/<uid>/<label>` and ignores its answer, so a label that is not loaded ("No such process", exit 3 or 113) is not a failure.
- **B45.** (New, D1.) It then runs `launchctl print gui/<uid>/<label>` until the answer says launchd has no record of the label (B41), waiting `pollMs` (default 100) between asks, for at most `goneWithinMs` (default 5000). When the label is still there at the end of that wait, it goes on anyway.
- **B46.** (New, D1.) It then runs `launchctl bootstrap gui/<uid> <path>`. When that exits 5, it waits `retryAfterMs` (default 1000) and runs the same bootstrap once more. No other status is retried, and there is never a third attempt.
- **B47.** (New, D1.) `loadItem` answers what the last bootstrap answered, in B40's shape: `{ ok: true, failed: null }`, or `{ ok: false, failed: "launchctl bootstrap gui/<uid> <path> exited <status>: <output>", notLoaded }`.
- **B48.** `startThroughItem(record, isUp, options)` refuses as B66 does, running no command, while `<record.state_dir>/stopped.json` stands.
- **B49.** It checks the record's label with B32 before any command runs, so a label like `com.apple.Finder` in `install.json` never reaches `launchctl`.
- **B50.** It uses one uid for every `launchctl` call: `options.uid`, else the record's `uid`, else this process's.
- **B51.** It runs the record's start commands (B38). When they fail on macOS with `notLoaded`, it looks for the plist only at `<options.home, else the user's home>/Library/LaunchAgents/<label>.plist`, never at the path `install.json` records.
- **B52.** When that plist is missing, or differs by any byte from what `describe` writes for the record's `node`, `entry`, `port` and `state_dir` (all four present, port a number), nothing is loaded and it refuses with B54's sentence, with no wait part, carrying `` it is not loaded, and <plist path> is not what `lahe install` writes for this install, so it was not loaded; run `lahe install` to write it again ``.
- **B53.** When the plist matches, it loads it with `loadItem` (B44 to B47) and then runs the start commands again. (Changed by D1: the old sequence was bootstrap then kickstart.)
- **B54.** It then waits for `isUp()` to answer anything other than `null`, `undefined` or `false`, asking every 100 ms for up to `options.waitMs` (default 20000). A probe that does not settle counts as "not up yet" after what is left of the wait plus one second, so a probe that never answers cannot hold the wait. When the helper never comes up it refuses with `the login item <label> did not start the helper on 127.0.0.1:<port> within <whole seconds> seconds`, then ` (<failed>)` when a command failed, then `; <reinstall reason>` when B59 gives one, then `. Its log is <state_dir>/login-item.log` when the record names a state folder, then `` . `lahe uninstall` goes back to starting the helper on demand. ``. B52's sentence has the same start without ` within <n> seconds`.

### `system/install-record.ts`

- **B55.** `installPath(dir)` is `<dir>/install.json`.
- **B56.** `readInstall(dir)` returns the parsed JSON object, every field as written, or `null` when the file is missing, unreadable, not JSON, or holds something other than an object (an array, `null`, a number). (Arrays and `null` changed by D7.)
- **B57.** `writeInstall(dir, record)` creates the folder if needed and writes the record as two-space-indented JSON plus a newline, owner-only (0600), through a temp file `install.json.tmp-<pid>` renamed into place. `readInstall` then returns a record deep-equal to the one written.
- **B58.** `installedFor(dir, port)` returns the record when its `port` is exactly that number, and `null` otherwise (no file, or another port, or a port written as a string).
- **B59.** `reinstallReason(record)` is `null` for no record, or when its `node` and `clone` both exist on disk or are absent. When `node` is named and missing, it is `` the Node at <node> is gone; run `lahe install` again ``. Otherwise, when `clone` is named and missing, it is `` the clone at <clone> is gone; run `lahe install` again from the clone you use ``.

### `system/stop-hold.ts`

- **B60.** `STOP_FILE` is `"stopped.json"`. `readStopMarker(dir)` is `null` when `<dir>/stopped.json` does not exist.
- **B61.** When it exists, `readStopMarker` returns `{ by, at }`. `by` is the file's `by` when that is a string of 1 to 40 ASCII letters, digits, spaces, `.`, `_` or `-`, and `"menu bar"` otherwise, so a newline or an instruction in it is never repeated. `at` is the file's `at` when that is a string a date parser reads, and `null` otherwise.
- **B62.** A marker file that cannot be read for any reason other than not existing, or that is not JSON, still stands: it reads as `{ by: "menu bar", at: null }`.
- **B63.** `clearStopMarker(dir)` removes the file, does nothing when there is none, and lets any other failure through.
- **B64.** `localTime(at)` is `YYYY-MM-DD HH:MM` in this computer's local time, or `an unknown time` for `null` or a string no date parser reads.
- **B65.** `stopMessage(marker)` is exactly `` Lahe is stopped: the person using this computer stopped it from the <by> at <localTime(at)>. Nothing starts it until they click Start in the Lahe menu or run `lahe install`. ``, always one line.
- **B66.** `refuseWhileStopped(dir)` returns while no marker stands, and otherwise refuses with B65's message on an error whose `stopped` property is `true`.
- **B67.** `startedByLoginItem(record, launch)` is true only when the record's `system` is `"macos"`, its `label` is a non-empty string, the environment's `XPC_SERVICE_NAME` equals that label, and the parent pid is 1. A `null` record, another system, another name or another parent gives false. `launch` defaults to this process's environment and parent pid.

### `system/admin-steps.ts`

- **B68.** `MARKER` is `# lahe-managed`, and `hasMarker(text)` is true when the text contains it. The fixed paths are `RESOLVER_PATH` `/etc/resolver/lahe`, `FORWARD_RULE_PATH` `/etc/pf.anchors/lahe`, `FORWARD_DAEMON_PATH` `/Library/LaunchDaemons/lahe-port80.plist`, `LINUX_RESOLVER_PATH` `/etc/systemd/resolved.conf.d/lahe.conf`, and `NAME_SERVER_PORT` is 7853.
- **B69.** `resolverText(port)` is exactly `# lahe-managed: .lahe names, written by lahe install. lahe uninstall removes it.\nnameserver 127.0.0.1\nport <port>\n`. `forwardRuleText(port)` is the marker line `# lahe-managed: port-free addresses, written by lahe install. lahe uninstall removes it.`, then `rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port <port>` and `rdr pass on lo0 inet6 proto tcp from any to ::1 port 80 -> ::1 port <port>`, each line ending in a newline. Both refuse a port that is not an integer from 1 to 65535 (70000, 0, 1.5) with `not a port number: <JSON>`.
- **B70.** `forwardDaemonText()` is a launchd plist carrying the marker in an XML comment that holds no `--`, the label `lahe-port80`, `RunAtLoad` true, and the program `/bin/sh -c "/sbin/pfctl -E 2>/dev/null; /sbin/pfctl -a com.apple/lahe -f /etc/pf.anchors/lahe"` (the `>` escaped as `&gt;`), byte for byte as the old module wrote it.
- **B71.** `ROOT_TEXT_FUNCTIONS` is shell text defining `lahe_port_ok`, `lahe_resolver_text`, `lahe_rule_text` and `lahe_daemon_text`. Run by `/bin/sh` with a port as `$1`, the three printers print byte for byte what B69 and B70 return. `lahe_port_ok` fails for the empty string, anything that is not all digits, a leading zero, and anything above 65535, and succeeds for `1483`.
- **B72.** `ROOT_SCRIPTS` holds four constant scripts. `installResolver` and `installForward` check `$1` with `lahe_port_ok` before anything else, exit 3 with `<file> was not written by Lahe; leaving it` when a file they would replace lacks the marker, and write each file through a temp file chowned `root:wheel`, chmodded 0644 and moved into place. `installForward` also boots out and bootstraps the `system/lahe-port80` daemon. `removeResolver` and `removeForward` delete a file only when it carries the marker, two files for `removeForward`. No script holds `${`, a backtick, `$(`, or `$1/`.
- **B73.** `rootCommand(name, port)` is `["sudo", "/bin/sh", "-c", ROOT_SCRIPTS[name], "lahe"]`, plus `String(port)` for the two install steps, whose port is checked as B69 does. The remove steps take no port.

### `system/quiet-moment.ts`

- **B74.** `waitForQuiet(dir, { quietMs, maxMs })` resolves `true` as soon as no `<dir>/reviews/<id>/events.jsonl` has been modified within the last `quietMs` (default 2000), which includes a state folder with no reviews or no logs. It resolves `false` once `maxMs` (default 10000) has passed without such a moment, and checks every 100 ms.

### `system/source-stamp.ts`

- **B75.** `helperPredatesSource(startedAt, { roots })` answers `stale: true` exactly when some regular file under the roots, at any depth, has an mtime later than the instant `startedAt` names. Symlinks are neither followed nor counted.
- **B76.** It answers `{ stale: false, helperStartedMs: null, sourceMtimeMs: null }` when `startedAt` is not a string or names no instant (`""`, `"not an instant"`, `undefined`, `null`, `17`), and `{ stale: false, helperStartedMs, sourceMtimeMs: null }` when the roots hold no file or do not exist. A check that cannot tell never says stale.
- **B77.** When not stale, `sourceMtimeMs` is the newest mtime found, which is at or before `helperStartedMs`. When stale, it is the mtime of a file newer than the start (the walk stops at the first one).
- **B78.** `roots()` is `[<clone>/src, <clone>/vendor]`, where `<clone>` is the clone the module is in, and never includes `dist/`. When `LAHE_SOURCE_DIR` holds an absolute path, it is `[that path]` instead; a relative value is ignored. `sourceRootsOf(clone)` is `[<clone>/src, <clone>/vendor]` for any clone. (`sourceRootsOf` replaces `login_item.sourceRoots`, D9.)
- **B79.** `REASON` is `the helper was older than the code in this clone`, and `reasonSentence(ending)` is `The helper was older than the code in this clone` followed by `ending`.

### `rendering/pandoc.ts`

- **B80.** `FROM` is `gfm+fenced_divs-gfm_auto_identifiers-yaml_metadata_block-tex_math_dollars-tex_math_gfm`.
- **B81.** `parseVersion(text)` reads the first line starting `pandoc` or `pandoc.exe`, whitespace, then `major.minor` and an optional third number: `pandoc 3.9.0.2` gives `{ major: 3, minor: 9, text: "3.9.0" }`, `pandoc.exe 2.19.2` gives major 2, and text with no such line gives `null`.
- **B82.** With `LAHE_MARKDOWN_ENGINE` equal to `marked` in any letter case, `render(text)` answers `{ html: null, reason: "forced", note: null }` and neither looks for nor runs pandoc. `render(text, { ignoreEnv: true })` ignores that variable.
- **B83.** `locate()` answers `{ path, version }` for a usable pandoc, and otherwise `{ path: null, reason }` with `reason` one of `missing`, `unreadable` or `too-old`. With `LAHE_PANDOC=none` it is `missing`. With `LAHE_PANDOC` an absolute path to an executable file, that file is the candidate. Otherwise the candidate is the first executable `pandoc` (`pandoc.exe` on Windows) in the absolute entries of `PATH`, then in `/opt/homebrew/bin` and `/usr/local/bin` (not on Windows). Relative and empty `PATH` entries are skipped. No candidate is `missing`.
- **B84.** A candidate whose `--version` does not exit 0 with a line B81 reads is `unreadable`, carrying the path. One whose major version is below 3, or whose `--list-extensions=gfm` does not exit 0 listing all five extension names in `FROM`, is `too-old`, carrying the version text.
- **B85.** A found pandoc is kept for the life of the process. A missing or unusable one is looked for again after 60 seconds. `reset()` forgets the found pandoc, the render cache and the filter's hash.
- **B86.** `render` runs the found pandoc once per new text with exactly these arguments: `--from <FROM> --to html5 --wrap=preserve --sandbox --data-dir <NO_DATA_DIR> --metadata lahe-nonce=<NONCE> --lua-filter <FILTER>`, the text on stdin, no shell, the system temp folder as working directory, an environment holding only `HOME`, `LANG=C.UTF-8` and whichever of `SYSTEMROOT`, `SystemRoot`, `TEMP`, `TMP` and `TMPDIR` are set, a limit of `options.timeoutMs` (default 5000 ms) after which it is killed with SIGKILL, and room for 32 MiB of output. Success answers `{ html: <stdout>, reason: null, note: null }`.
- **B87.** Text over 8 MiB in UTF-8 answers `failed` without starting pandoc, with the detail `larger than 8 MB`.
- **B88.** A pandoc that exits non-zero answers `failed` with the first non-empty line of its stderr (at most 200 characters) as the detail, or `exit <status>` (or the signal) when stderr is empty. This holds when it exits before reading all its input: the detail is its own reason, never `EPIPE`.
- **B89.** A pandoc killed at the limit answers `failed` with the detail `timed out after <seconds>s` (`0.3s` for 300 ms).
- **B90.** Every answer from a run, success or failure, is cached per (pandoc version, the filter file's contents, the text), at most 64 entries, least recently used first out. The same text never runs pandoc twice while cached, so a document that stalls pandoc stalls the helper once.
- **B91.** A pandoc that was found and has since been removed (spawn says ENOENT) answers `missing` with the missing note. The found pandoc is forgotten and the cache cleared, so the next render looks again.
- **B92.** The notes are exact. `missing`: `pandoc is not installed, so Markdown fenced divs (::: blocks) render as plain text. Install pandoc 3 or newer (pandoc.org) to draw them.` `too-old`: `pandoc <version> is older than 3.0 or lacks a gfm extension Lahe names, so Markdown fenced divs render as plain text. Install pandoc 3 or newer.` `unreadable`: `pandoc at <path> did not answer --version, so Markdown fenced divs render as plain text.` `failed`: `pandoc could not render a page (<detail>), so it was drawn with marked and its ::: blocks show as plain text.` `forced` has no note.
- **B93.** `engineKey()` is `marked:forced` while `LAHE_MARKDOWN_ENGINE=marked`, `pandoc:<path>:<version>` when pandoc is found, and `marked:<reason>` otherwise, so a page cached while pandoc was missing renders again once it is found.
- **B94.** `NONCE` is 32 lowercase hex characters, fixed for the life of the process. `FILTER` is `lahe_render.lua` in the module's own folder, and exists. `NO_DATA_DIR` is `pandoc-data-dir-deliberately-absent` in the module's own folder, and does not exist.

### `rendering/tab-icon.ts`

- **B95.** `hasTabIcon(html)` is true when some `<link>` tag has a `rel` attribute (double-quoted, single-quoted or bare, any letter case) holding a space-separated token that is `icon` or ends in `-icon`: `icon`, `shortcut icon`, `apple-touch-icon`, `mask-icon`, `ICON`. `rel="stylesheet"` on a file named `icons.css` is not one.
- **B96.** `withTabIcon(html)` returns the text unchanged when B95 holds. Otherwise it inserts a newline and `TAB_ICON_LINK` right after the first `<head ...>` tag; with no head, after the first `<html ...>` tag; with neither, after the first `<!doctype ...>`; with none of them, `TAB_ICON_LINK` and a newline go at the very start. Nothing is ever written above a doctype.
- **B97.** `withTabIcon` is idempotent: applied twice, the page carries one icon.
- **B98.** `TAB_ICON_LINK` is one `<link rel="icon" href="data:image/svg+xml,...">` tag, an inline image needing no request. `LIBRARY_ICON_URI` is a `data:image/svg+xml,` URI and `LIBRARY_LINK` is `<link rel="icon" href="` plus it plus `">`. All three strings are byte for byte the old module's.

### `store/state-dir.ts`

- **B99.** `stateDir(options)` is `options.dir` resolved when given; else `LAHE_STATE_DIR` resolved; else `<XDG_STATE_HOME resolved>/lahe`; else `<home>/.local/state/lahe`.
- **B100.** When that folder or any folder above it holds a `.git` (a folder in a clone, a file in a worktree), `stateDir` refuses with `` the helper's state directory must sit outside any checkout, and <dir> is inside the one at <checkout>. A review history committed by an ordinary `git add -A` is a real loss with no attacker involved. Point LAHE_STATE_DIR somewhere else. ``, unless `options.allowInsideCheckout` is true.
- **B101.** `flagFor(dir)` is `null` for a non-string or empty value, and for a folder that resolves to the same path the default resolution (B99, checkout refusal waived) gives. Otherwise it is the resolved path. `<state>/.` counts as `<state>`.
- **B102.** `ensureDir(dir)` creates the folder and any missing parents, and leaves the folder itself at mode 0700 even when it already existed with looser permissions. It returns the folder.
- **B103.** `assertNotSymlink(target)` returns the target when nothing is there or it is not a symlink, and refuses a symlink with `refusing to follow a symlink inside the helper's data directory: <target>`. Other failures to look pass through.
- **B104.** `resolveWithin(base, segments)` takes one segment or a list. It refuses a segment that is not a non-empty string with `resolveWithin: every path segment must be a non-empty string`, and one holding `/`, `\` or a NUL with `resolveWithin: a path segment may not contain a separator: <JSON>`. It refuses a result outside the base (a `..` segment) with `refusing a write outside the helper's data directory: <path>`. It refuses with B103's message when any existing level between the base and the result is a symlink, the last one included. Otherwise it returns the resolved path.
- **B105.** `assertSafeReviewId(id)` returns the id when it passes the contract's safe-id rule, and otherwise refuses with `review ids are path components, so they are limited to /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/. Got: <JSON>`.
- **B106.** The layout's names are exactly: `FILES` `{ ready: "service.json", helperLog: "helper.log", events: "events.jsonl", compactedIds: "events.jsonl.compacted-ids", review: "review.json", meta: "meta.json", windows: "windows.json", catalogRequests: "catalog-requests.jsonl", catalogAttach: "catalog-attach.json", catalogDelivered: "catalog-delivered.log", stopWhenQuiet: "stop-when-quiet.json", stateId: "state-id" }`; folders `reviews`, `agent-sessions`, `static-servers` (`STATIC_SERVERS_DIR`), `review-artifacts` and `styles`; `DIR_MODE` 0o700 and `FILE_MODE` 0o600.
- **B107.** These are plain joins under the state folder, with no checks: `readyPath`, `stateIdPath`, `stopWhenQuietPath`, `helperLogPath`, `windowsPath` (each `<dir>/<FILES entry>`), `reviewsRoot` (`<dir>/reviews`) and `agentSessionsRoot` (`<dir>/agent-sessions`).
- **B108.** These go through B104 and check the review id with B105: `reviewDir` (`reviews/<id>`), `eventsPath`, `compactedIdsPath`, `reviewJsonPath` and `metaPath` (`reviews/<id>/<FILES entry>`).
- **B109.** These go through B104 and check the session id with B105: `agentSessionDir` (`agent-sessions/<id>`), `agentSessionPath` (`.../session.json`), `endedDeliveredPath` (`.../ended-delivered.log`), `catalogDeliveredPath` (`.../catalog-delivered.log`), `wakeLogPath` (`.../wake.log`, the contract's `WAKE.FILE`), `monitorPath`, `activityPath` and `deliveredPath` (`.../monitor.json`, `activity.json`, `delivered.json`, the contract's `MONITOR` file names), `staticServersRoot` (`.../static-servers`), `reviewArtifactsRoot` (`.../review-artifacts`), and `staticServerPath(dir, session, server)` (`.../static-servers/<server>.json`, the server id checked too).
- **B110.** These go through B104 with no id: `catalogRequestsPath`, `catalogAttachPath` (each `<dir>/<FILES entry>`) and `stylesRoot` (`<dir>/styles`).
- **B111.** `replyFilePath(dir, review, filename)` accepts `replies.jsonl` and `replies-<safe id>.jsonl` and refuses any other name with `refusing a reply file name that is not replies.jsonl or replies-<agent>.jsonl: <JSON>` (`replies-../escape.jsonl`, `replies-.jsonl`, `replies.jsonl.bak`, `notes.jsonl`, an agent segment of 65 or more characters). The path is `reviews/<review>/<filename>` through B104 and B105.
- **B112.** `ensureReviewDir`, `ensureAgentSessionDir`, `ensureStaticServersRoot`, `ensureReviewArtifactsRoot` and `ensureStylesRoot` create every level from the state folder down with B102, owner-only, and return the deepest folder.
- **B113.** `writeAtomic(target, contents)` refuses a symlink target (B103), writes the contents to `<target>.<pid>.<ms>.tmp` with mode 0600 and renames it over the target, so a reader sees the old whole file or the new whole file and the result is 0600. It returns the target.
- **B114.** `appendLine(target, line)` refuses a symlink target, appends the text as given (it adds no newline), creates a missing file with mode 0600, and returns the target.
- **B115.** `isNotesReview(dir, review)` is true only when the review's `meta.json` parses and its `notes` is exactly `true`. A missing or broken file, or an unsafe id, gives false; it never throws.

### `sessions/watchers.ts`

- **B116.** `createWatchers({ ttlMs, probe, now })` returns a watcher with its own cache; `ttlMs` defaults to 15000, `now` to `Date.now`, and `probe` to the lsof probe (B121).
- **B117.** `listening(file)` never waits. The first ask for a file answers `null` and starts one probe. After that probe settles, `listening` answers its result (`true`, `false` or `null`) until `ttlMs` has passed since it settled; the first ask after that still answers the last result and starts a new probe. An empty file name answers `null` and starts nothing.
- **B118.** `refresh(file)` starts a probe and resolves to its result. While one probe for a file is running, every `listening` and `refresh` for that file shares it, so two asks a millisecond apart cost one subprocess.
- **B119.** A probe that rejects answers `null`, never `false`, and the next due ask probes again.
- **B120.** A probe result with `supported: false` makes the watcher stop asking for good: `unsupported()` turns true, every later `listening` answers `null`, and every later `refresh` resolves to that file's last result without running the probe.
- **B121.** The default probe runs `lsof -t -- <file>` with a two-second limit and no window. Any pid other than this process's own means `{ listening: true, supported: true }`. No pid with exit 0 or exit 1 means `{ listening: false, supported: true }`. No `lsof` on the machine (ENOENT) means `{ listening: null, supported: false }`. A run killed at the limit, or any other failure, means `{ listening: null, supported: true }`.

### `src/cli/commands/install.js` (D2, owned by this slice for the rollback only)

- **B122.** (New, D2.) When `lahe install` rolls back (the login item did not load, or the helper it started did not answer in time), it still removes the item, `install.json` and the root steps it set up, exactly as today, and prints `lahe install: nothing is left installed.` or the existing `` lahe install: still in place, because removing it failed: <list>. Run `lahe uninstall` to try again. `` line.
- **B123.** (New, D2.) It then starts a helper on demand for the same state folder and port, the way `lahe review` does with no login item (`sessionCommand.startHelper`), and prints `lahe install: the helper is running on demand again, as it does without a login item.`. The command still exits 1.
- **B124.** (New, D2.) When that start fails, it prints `` lahe install: the helper could not be started on demand (<error message>). `lahe review` starts it when it is next needed. `` and still exits 1. It never throws past the command.

## 3. Callers

Found by `callers.py` and `exports.py`: every file under `src`, `scripts`, `test` and `bin` that requires one of the old paths, with the exports it reads. **Breaks** marks a caller this spec changes; each is in the builder's owned files and changes in this slice. Everything else reaches the new modules unchanged through the forwarders.

### `heal.js`

| Caller | Uses | |
| --- | --- | --- |
| `src/service/reviews.js` | `createHealer`, and `consider({ path })` with only a path at three sites (lines 1053, 1070, 1109) | **Breaks.** Passes `bundle: path.join(__dirname, "..", "..", manifest.BUNDLE_OUTPUT)` to `createHealer` (requiring the manifest), and the three stat-only calls become `healModule.fileMtimeIso(<path>)` |
| `src/service/page_routes.js` | `BUNDLE`, `BUNDLE_BASENAME`, `isStaticPage` | **Breaks.** Spells its own `BUNDLE` and basename from `manifest.BUNDLE_OUTPUT`, as `index.js` and `add.js` already do |
| `src/service/markdown_links.js` | `isStaticPage` | |
| `src/cli/commands/status.js` | `isStaticPage` | |
| `test/unit/heal_script_line.test.js` | `BUNDLE_BASENAME` (lines 81, 88) | **Breaks.** Uses the literal `"lahe-layer.js"` |
| `test/unit/choice_kernel.test.js` | reads `heal.js`'s text | **Breaks** (section 8) |
| `src/cli/commands/add.js`, `test/unit/review_write_hardening.test.js` | the path, in a comment only | |

### `login_item.js`

| Caller | Uses | |
| --- | --- | --- |
| `src/cli/commands/install.js` | `systemFor`, `describe`, `writeItem`, `runCommands`, `readInstall`, `writeInstall`, `installPath`, `clearStopMarker`, `readStopMarker`, `hasMarker`, `rootCommand`, `LOG_FILE`, `NAME_SERVER_PORT`, `RESOLVER_PATH`, `FORWARD_RULE_PATH`, `FORWARD_DAEMON_PATH`, `LINUX_RESOLVER_PATH` | **Breaks** (D1, D2). `runCommands(item.load, ...)` at line 634 becomes `loadItem(item, { runner })`; the rollback (lines 636 to 655) gains B122 to B124 |
| `src/cli/commands/session.js` | `installedFor`, `refuseWhileStopped`, `startThroughItem`, `waitForQuiet`, `sourceRoots` | **Breaks** (D9). Line 241 becomes `sourceStamp.sourceRootsOf(installed.clone)` |
| `src/cli/commands/add.js` | `installedFor`, `refuseWhileStopped`, `startThroughItem` | |
| `src/cli/commands/serve.js` | `installedFor`, `readStopMarker`, `startThroughItem`, `startedByLoginItem`, `stopMessage` | |
| `src/cli/commands/status.js` | `localTime`, `readInstall`, `reinstallReason` | |
| `src/service/index.js` | `installedFor`, `startedByLoginItem`, `refuseWhileStopped`, `clearStopMarker` | |
| `src/service/menubar.js` | `MENUBAR_LABEL`, `knownLabel`, `plistText`, `readInstall`, `writeInstall`, `readStopMarker`, `runCommands`, `writeItem` | |
| `scripts/spike_login_item.js` | `systemFor`, `describe`, `startCommands`, `writeInstall`, `writeItem`, `defaultRunner`, `LOG_FILE` | |
| `test/unit/login_item.test.js` | most exports | moves (section 5) |
| `test/unit/stop_holds.test.js` | `startThroughItem`, `describe`, `writeItem`, `writeInstall`, `readStopMarker`, `clearStopMarker`, `stopMessage`, `localTime`, `startedByLoginItem`, `startCommands`, `LABEL`, `STOP_FILE` | **Breaks** for the bootstrap-path case (D1); its module cases move |
| `test/unit/install_command.test.js` | `LABEL`, `readInstall`, `installPath`, `ROOT_SCRIPTS`, `resolverText`, `forwardRuleText`, `forwardDaemonText`, `RESOLVER_PATH`, `FORWARD_RULE_PATH`, `LINUX_RESOLVER_PATH`, `STOP_FILE` | **Breaks** in its fake: `fakeManager` answers `launchctl print` with status 113 (launchd's "no record") for a label it has not loaded, or every macOS install waits out B45's five seconds. Gains the D2 test |
| `test/unit/always_on.test.js` | `systemFor`, `writeInstall`, `readInstall`, `installedFor`, `startCommands`, `waitForQuiet` | its `waitForQuiet` case moves |
| `test/unit/no_stray_helpers.test.js` | `startThroughItem` | its one case moves |
| `test/unit/menubar.test.js`, `menubar_cli.test.js`, `addresses.test.js` | `describe`, `readInstall`, `writeInstall`, `STOP_FILE`, `localTime` | |
| `test/browser/always_on_stale_replace.spec.js` | `systemFor`, `writeInstall` | |

### `name_server.js`

| Caller | Uses |
| --- | --- |
| `src/service/addresses.js` | `ENDING`, `createNameServer` |
| `test/unit/name_server.test.js` | `TYPE`, `RCODE`, `respond`, `createNameServer` (moves) |
| `test/unit/addresses.test.js` | `isLaheName`, `createNameServer` |

### `pandoc.js`

| Caller | Uses |
| --- | --- |
| `src/service/markdown.js` | `NONCE`, `render`, `engineKey` |
| `test/unit/pandoc_render.test.js` | `parseVersion`, `render`, `locate`, `reset`, `FILTER`, `FROM`, `NO_DATA_DIR` |
| `test/unit/markdown_links.test.js`, `mount_files.test.js`, `test/browser/markdown_pandoc.spec.js` | `locate`, `reset` (to decide whether to skip) |

### `source_stamp.js`

| Caller | Uses | |
| --- | --- | --- |
| `src/cli/commands/add.js` | `REASON`, `reasonSentence` | |
| `src/cli/commands/serve.js` | `helperPredatesSource(...).stale`, `reasonSentence` | |
| `src/cli/commands/session.js` | `REASON`, `helperPredatesSource(...).stale` | **Breaks** (D9, the `sourceRoots` line above) |
| `test/unit/helper_freshness.test.js` | `helperPredatesSource` (reads `helper_started_ms` and `source_mtime_ms` at line 158), `roots`, `REASON` | **Breaks** at line 158 (D10); that case moves |

### `state_dir.js`

No export a caller reads changes name or shape, so nothing here breaks. The callers:

- **src (36):** `src/cli/codex_monitor.js`; `src/cli/commands/` `add`, `hook`, `install`, `library`, `menubar`, `monitor`, `reply`, `review`, `serve`, `session`, `status`, `style`; `src/service/` `agent_sessions`, `catalog_actions`, `catalog_launch`, `catalog_reader`, `catalog_requests`, `catalog_store`, `index`, `log`, `markdown`, `page_routes`, `projection`, `rebuild`, `replies`, `review_writer`, `reviews`, `self_stop`, `sites`, `static_servers`, `styles`, `summary`, `wake_feed`; and `src/shared/manifest.js` (the path only).
- **scripts (3):** `compact_draft_history.js` (`STATIC_SERVERS_DIR`, `FILE_MODE` and path helpers), `measure_draft_write_cost.js`, `spike_login_item.js`.
- **tests (66):** `test/browser/rail_hold.spec.js`, `test/browser/stable_addresses_mappers.spec.js`, `test/fixtures/menubar/state.js`, `test/helpers/old_server_record.js`, and in `test/unit/`: `addresses`, `adopt_old_records`, `always_on`, `batch_reply_own_answers`, `catalog_auth`, `catalog_launch`, `catalog_lifetime`, `catalog_reader`, `catalog_requests`, `catalog_routes`, `choice_kernel`, `codex_monitor`, `each_page_comments`, `handoff_page_names`, `helper_not_replaced`, `helper_reads_only_the_tail`, `helper_self_stop`, `hook_stop`, `install_command`, `launch_by_kind`, `launch_folder`, `lean_agent_output`, `library_command`, `library_command_sites`, `library_handoff`, `library_open_sites`, `library_session_autoclose`, `library_trusted_paths`, `log_injection`, `log_run`, `mark_done`, `markdown_style`, `menubar_summary`, `monitor_command`, `mount_files`, `no_stray_helpers`, `projection_incremental`, `projection_review_json`, `rebuild_not_the_agents_job`, `reply_folding`, `reply_proofread`, `reply_seen`, `review_json_skip`, `reviews_remove_origin`, `reword_not_handled_floor`, `service_helper`, `service_paths`, `session_close_always_on`, `session_names`, `sites_mappers`, `sites_pages`, `sites_step3`, `sites_styles`, `static_site_folder`, `status_catalog`, `status_command`, `style_command`, `styles`, `summary_routes`, `unanswered_prominence`, `wake_feed`, `window_sessions_restart` (each `.test.js`).

The exports no caller reads (`RETENTION_DAYS`, `REVIEWS_DIR`, `AGENT_SESSIONS_DIR`, `REVIEW_ARTIFACTS_DIR`, `STYLES_DIR`, `checkoutAbove`) stop being exported (D11).

### `tab_icon.js`

| Caller | Uses | |
| --- | --- | --- |
| `src/service/page_routes.js` | `ensure`, `LINK` | **Breaks** (D12): `withTabIcon`, `TAB_ICON_LINK` |
| `src/service/markdown.js` | `LINK` | **Breaks** (D12): `TAB_ICON_LINK` |
| `src/service/catalog_page.js` | `LIBRARY_ICON_URI`, `LIBRARY_LINK` | |
| `test/unit/tab_icon.test.js` | `LINK`, `ensure`, `hasIcon` | its module cases move; the case it keeps **breaks** (D12) |
| `test/unit/catalog_page_csp.test.js` | `LINK`, `LIBRARY_LINK`, `LIBRARY_ICON_URI` | **Breaks** (D12): `TAB_ICON_LINK` |

### `watchers.js`

| Caller | Uses |
| --- | --- |
| `src/service/agent_sessions.js` | `createWatchers` (reads `listening` and `refresh`) |
| `test/unit/agent_liveness.test.js` | `createWatchers` (two cases move; the rest use a fake probe as setup) |
| `test/unit/session_names.test.js`, `unanswered_prominence.test.js` | `createWatchers` with a fake probe, as setup |

### The manifest and the Lua file

`src/shared/manifest.js` lists all nine paths. The eight `.js` entries move from `NON_BUNDLE_FILES` to `FORWARDERS`; the Lua entry's path becomes `src/server/rendering/lahe_render.lua`. `scripts/lint.js` finds `.lua` files by walking `src/`, so it follows the move with no change. `test/unit/lint_lua.test.js` names the path (section 8).

## 4. Module design

### Rules every module follows

- Named exports only; functions, `as const` tables and other constants; no `let` exported; no default export; no top-level `await`; no `enum`, `namespace` or parameter properties; no classes.
- Imports name the `.ts` extension and reach only `src/contract/`, `src/domain/`, `src/server/` and `node:` built-ins.
- A module that needs its own folder (pandoc's filter and data dir, the source-stamp clone root) uses `import.meta.dirname`. **Trap:** the old files sat at `src/service/`, two levels below the clone; the new ones sit three levels below (`src/server/<folder>/`), so the clone root is `import.meta.dirname` plus `../../..`. The test for B78 compares against the real clone root.
- Data read from disk, the environment, a subprocess or a socket is `unknown` until parsed at the point it enters. Inside, the types are trusted and not checked again.
- Messages people or agents read are spelled once, in the module that owns them.

### `src/server/sites/heal.ts`

```ts
import type { SafeId } from "../../contract/safe-id.ts";

export const STABLE_MS = 500;

export interface HelperLog {
  helperLog(line: string): void;
}

export interface HealerOptions {
  readonly log: HelperLog;
  readonly bundle: string;
  readonly now?: () => number;
}

export interface HealablePage {
  readonly path: string;
  readonly review: SafeId;
  readonly token: string;
  readonly helperOrigin: string;
  readonly servedBy: () => boolean;
}

export interface Healer {
  consider(page: HealablePage): string | null;
  lastHealAt(review: string): string | null;
}

export function isStaticPage(file: string): boolean;
export function fileMtimeIso(file: string): string | null;
export function createHealer(options: HealerOptions): Healer;
```

- The healer's memory per path is a two-member union instead of three fields that must stay in step: `{ phase: "seen"; mtimeMs; firstSeenAt }` (a first sighting, B6), and `{ phase: "settled"; mtimeMs }` (looked at or written, B9, B10, B15, B16). A path with no entry has never been seen. A changed mtime always replaces the entry with a new `seen`.
- `bundle` is the absolute path of the built layer. The healer no longer knows where the repo keeps it, because the only spelling of that is `manifest.BUNDLE_OUTPUT` in a `.js` file a `.ts` file may not import. The fallback name is `path.basename(bundle)`.
- Stat-only callers use `fileMtimeIso`; `consider` takes only pages it may heal, so a missing review or token is no longer a runtime case (D4). `servedBy` is required: every heal must answer whether a site serves the page (D16).
- `createHealer` no longer checks for a missing `log` (D6).
- Imports: `scriptTag` from `contract/script-tag.ts`, `route` from `contract/routes.ts`, `placeScriptLine` and `reviewAlreadyInFile` from `./script-line.ts`.

### `src/server/sites/name-server.ts`

```ts
export const ENDING = "lahe";
export const TYPE = { A: 1, AAAA: 28 } as const;
export const RCODE = { NOERROR: 0, REFUSED: 5 } as const;

export interface NameServerOptions {
  readonly port?: number;
  readonly onQuery?: (name: string) => void;
  readonly log?: (line: string) => void;
}

export interface NameServer {
  start(): Promise<void>;
  port(): number | null;
  close(): Promise<void>;
}

export function isLaheName(name: string): boolean;
export function respond(packet: Buffer): Buffer | null;
export function createNameServer(options: NameServerOptions): NameServer;
```

- The packet parser (`parseQuery`) stays inside the module, returning a `Question { id, recursionDesired, name, type, qclass, end }` or `null`. It is the boundary: a datagram is untrusted bytes. Its old export had no caller (D11).
- The socket is the only mutable state, held inside `createNameServer`.

### `src/server/system/login-item.ts`

```ts
const SYSTEM_FOR_PLATFORM = { darwin: "macos", linux: "linux", win32: "windows" } as const;
export type System = (typeof SYSTEM_FOR_PLATFORM)[keyof typeof SYSTEM_FOR_PLATFORM];

declare const labelBrand: unique symbol;
export type Label = string & { readonly [labelBrand]: true };

export const LABEL = "lahe-helper";
export const MENUBAR_LABEL = "lahe-menubar";
export const LOG_FILE = "login-item.log";

export type Command = readonly [program: string, ...args: string[]];
export type LaunchdDomain = `gui/${number}`;

export interface HelperProgram {
  readonly node: string;
  readonly entry: string;
  readonly port: number;
  readonly stateDir: string;
}

interface SpecBase extends HelperProgram {
  readonly home: string;
  readonly label?: string;
}

export type ItemSpec =
  | (SpecBase & { readonly system: "macos"; readonly uid: number })
  | (SpecBase & { readonly system: "linux"; readonly configHome?: string | null })
  | (SpecBase & { readonly system: "windows"; readonly user: string; readonly now?: Date });

interface ItemBase {
  readonly label: Label;
  readonly path: string;
  readonly contents: string;
  readonly load: readonly Command[];
  readonly start: readonly Command[];
  readonly unload: readonly Command[];
}

export type LoginItem =
  | (ItemBase & { readonly system: "macos"; readonly domain: LaunchdDomain })
  | (ItemBase & { readonly system: "linux" })
  | (ItemBase & { readonly system: "windows" });

export interface StartTarget {
  readonly system: string;
  readonly label: unknown;
  readonly uid?: number;
}

export function systemFor(platform: string): System | null;
export function parseLabel(value: unknown): Label;
export function knownLabel(value: unknown): Label;
export function helperArgs(program: HelperProgram): string[];
export function plistText(label: Label, args: readonly string[], logPath: string, options?: { readonly keepAliveOnCrash?: boolean }): string;
export function windowsQuote(arg: string): string;
export function describe(spec: ItemSpec): LoginItem;
export function startCommands(target: StartTarget): readonly Command[];
export function writeItem(item: LoginItem): void;
```

- `Label` is branded because a label goes into a file name and a `launchctl` target, and an edited `install.json` must not be able to name another job. `parseLabel` and `knownLabel` are the only ways to get one. `parseLabel` replaces the unexported `checkedLabel`.
- `LoginItem` is a union on `system`, so `loadItem` switches on it, and only the macOS variant carries a `domain`.
- `StartTarget.system` is a plain string and `label` is `unknown`, because `startCommands` is fed from `install.json` (B38's refusal stays).
- The plist, unit and task text builders, `xmlEscape` and `systemdQuote` stay inside. `xmlEscape` and `systemdQuote` had no caller outside the module (D11); B34 to B36 test them through `describe`.

### `src/server/system/service-manager.ts`

```ts
import type { JsonObject } from "../../contract/json-object.ts";
import type { Command, LoginItem } from "./login-item.ts";

export interface CommandResult {
  readonly status: number | null;
  readonly output: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => CommandResult | Promise<CommandResult>;

export type RunResult =
  | { readonly ok: true; readonly failed: null }
  | { readonly ok: false; readonly failed: string; readonly notLoaded: boolean };

export interface LoadTiming {
  readonly goneWithinMs: number;
  readonly pollMs: number;
  readonly retryAfterMs: number;
}

export const LOAD_TIMING: LoadTiming = { goneWithinMs: 5000, pollMs: 100, retryAfterMs: 1000 };
export const START_WAIT_MS = 20000;

export interface LoadOptions {
  readonly runner?: CommandRunner;
  readonly timing?: Partial<LoadTiming>;
}

export interface StartOptions extends LoadOptions {
  readonly waitMs?: number;
  readonly home?: string;
  readonly uid?: number;
}

export function runnerTimeoutMs(command: string): number;
export function defaultRunner(command: string, args: readonly string[]): CommandResult;
export function runCommands(commands: readonly Command[], runner?: CommandRunner): Promise<RunResult>;
export function loadItem(item: LoginItem, options?: LoadOptions): Promise<RunResult>;
export function startThroughItem(record: JsonObject, isUp: () => Promise<unknown>, options?: StartOptions): Promise<void>;
```

- `loadItem` is new (D1) and is the one way an item is loaded: `install.js` calls it, and `startThroughItem`'s bootstrap path calls it.
- `startThroughItem` takes the raw `install.json` object its JavaScript callers pass, and reads it through `install-record.ts`'s view. `isUp` answers `Promise<unknown>` because its callers resolve to a health object or `null`; B54 says what counts as up.
- The "is the plist what install writes" check (B52) builds the expected text with `describe` for the record's fields; it stays inside.
- `waitForQuiet` is not here: it is about reviews' logs, not the service manager.

### `src/server/system/install-record.ts`

```ts
import type { JsonObject } from "../../contract/json-object.ts";
import type { System } from "./login-item.ts";

export const INSTALL_FILE = "install.json";

export interface InstalledView {
  readonly system: System | null;
  readonly label: string | null;
  readonly port: number | null;
  readonly stateDir: string | null;
  readonly node: string | null;
  readonly clone: string | null;
  readonly entry: string | null;
  readonly uid: number | null;
}

export function installPath(dir: string): string;
export function readInstall(dir: string): JsonObject | null;
export function writeInstall(dir: string, record: JsonObject): void;
export function installedFor(dir: string, port: number): JsonObject | null;
export function installedView(record: JsonObject): InstalledView;
export function reinstallReason(record: JsonObject | null): string | null;
```

- **Why the record stays a `JsonObject`.** `install.json` holds fields this slice never reads (`pages_port`, `lahe_names`, `resolver`, `port_80`, `by_hand`, the `menubar` block and more) that `install.js`, `menubar.js`, `index.js` and `status.js` read and rewrite. A typed record that dropped unknown fields would erase them on the next read-modify-write. So the file round-trips whole, and the server code reads the fields it needs through `installedView`, which narrows each one (a field of the wrong type reads as `null`). The menubar block is SV2's to type.
- `readInstall` parses with the contract's `isJsonObject`, which is the boundary (D7).

### `src/server/system/stop-hold.ts`

```ts
import type { JsonObject } from "../../contract/json-object.ts";

export const STOP_FILE = "stopped.json";

export interface StopMarker {
  readonly by: string;
  readonly at: string | null;
}

export type StoppedError = Error & { readonly stopped: true };

export interface Launch {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly ppid?: number;
}

export function readStopMarker(dir: string): StopMarker | null;
export function clearStopMarker(dir: string): void;
export function localTime(at: string | null): string;
export function stopMessage(marker: StopMarker): string;
export function refuseWhileStopped(dir: string): void;
export function startedByLoginItem(record: JsonObject | null, launch?: Launch): boolean;
```

- The stopped error is an `Error` with `stopped: true` made with `Object.assign`, typed `StoppedError`, so no class and no cast. Only tests read `stopped` today; the CLI prints the message.
- The old `refuseWhileStopped(dir)` took a missing `dir` as "not stopped"; the typed one takes a string, and `startThroughItem` skips the check when the record names no state folder, which is the same behavior.

### `src/server/system/admin-steps.ts`

```ts
export const MARKER = "# lahe-managed";
export const RESOLVER_PATH = "/etc/resolver/lahe";
export const FORWARD_RULE_PATH = "/etc/pf.anchors/lahe";
export const FORWARD_DAEMON_PATH = "/Library/LaunchDaemons/lahe-port80.plist";
export const LINUX_RESOLVER_PATH = "/etc/systemd/resolved.conf.d/lahe.conf";
export const NAME_SERVER_PORT = 7853;

export const ROOT_TEXT_FUNCTIONS: string;
export const ROOT_SCRIPTS: {
  readonly installResolver: string;
  readonly removeResolver: string;
  readonly installForward: string;
  readonly removeForward: string;
};

export type InstallStep = "installResolver" | "installForward";
export type RemoveStep = "removeResolver" | "removeForward";

export function hasMarker(text: string): boolean;
export function resolverText(port: number): string;
export function forwardRuleText(port: number): string;
export function forwardDaemonText(): string;
export function rootCommand(name: InstallStep, port: number): string[];
export function rootCommand(name: RemoveStep): string[];
```

- The two overloads make "an install step without a port" and "a remove step with one" compile errors. The old runtime refusal of an unknown script name goes (D11): no typed caller can reach it, and `install.js` passes literal names only.
- The port check (`checkedPort`) stays at runtime, because the port crosses to root. It rejects non-integers, so it also rejects a string a JavaScript caller might pass.
- `MARKER` is exported now because the test for B72 matches it; it was exported before too.
- The line tables and the shell printers stay inside. The printer's guard against a quote or a stray `%` in a line runs when the module loads, so a bad constant fails every test at once.

### `src/server/system/quiet-moment.ts`

```ts
export interface QuietOptions {
  readonly quietMs?: number;
  readonly maxMs?: number;
}

export function waitForQuiet(dir: string, options?: QuietOptions): Promise<boolean>;
```

It names the log file with `state-dir.ts`'s `reviewsRoot` and `FILES.events` instead of spelling `events.jsonl` again. `QUIET_MS` and `QUIET_MAX_MS` stop being exported (no caller, D11).

### `src/server/system/source-stamp.ts`

```ts
export const REASON = "the helper was older than the code in this clone";

export type SourceVerdict =
  | { readonly stale: false; readonly helperStartedMs: null; readonly sourceMtimeMs: null }
  | { readonly stale: false; readonly helperStartedMs: number; readonly sourceMtimeMs: number | null }
  | { readonly stale: true; readonly helperStartedMs: number; readonly sourceMtimeMs: number };

export interface SourceOptions {
  readonly roots?: readonly string[];
}

export function reasonSentence(ending: string): string;
export function sourceRootsOf(clone: string): string[];
export function roots(): string[];
export function helperPredatesSource(startedAt: unknown, options?: SourceOptions): SourceVerdict;
```

- `startedAt` is `unknown` because it comes off another process's `/health` answer.
- The union says what each case can hold: a stale verdict always has both numbers.
- `CLONE_ROOT`, `DEFAULT_ROOTS` and `newestMtimeMs` stop being exported (no caller, D11). `sourceRootsOf` takes over from `login_item.sourceRoots(record)` (D9), so "src plus vendor" is spelled in one place.

### `src/server/rendering/pandoc.ts`

```ts
export const FROM: string;
export const NONCE: string;
export const FILTER: string;
export const NO_DATA_DIR: string;

export interface PandocVersion {
  readonly major: number;
  readonly minor: number;
  readonly text: string;
}

export type Located =
  | { readonly path: string; readonly version: string }
  | { readonly path: null; readonly reason: "missing" }
  | { readonly path: null; readonly reason: "unreadable"; readonly detail: string }
  | { readonly path: null; readonly reason: "too-old"; readonly version: string; readonly detail: string };

export type RenderOutcome =
  | { readonly html: string; readonly reason: null; readonly note: null }
  | { readonly html: null; readonly reason: "forced"; readonly note: null }
  | { readonly html: null; readonly reason: "missing" | "unreadable" | "too-old" | "failed"; readonly note: string };

export interface RenderOptions {
  readonly ignoreEnv?: boolean;
  readonly timeoutMs?: number;
}

export function parseVersion(text: string): PandocVersion | null;
export function locate(): Located;
export function render(markdown: string, options?: RenderOptions): RenderOutcome;
export function engineKey(): string;
export function reset(): void;
```

- `path` is the discriminant callers already use (`locate().path`), so their checks keep working and narrow. The time a missing pandoc was last looked for is held beside the cached `Located`, not inside it.
- The located pandoc, the render cache and the filter's hash are module state, unexported, because the cache must be shared by every render in the helper process. `reset()` exists for tests. This is the one module in the slice with state outside a factory; the alternative (a renderer object `markdown.js` creates) would change SV3's file for no gain in behavior.
- The `run` step's raw `spawnSync` result is the boundary; it becomes a `RenderOutcome` in one function with one switch over the cases B86 to B91 list.
- `EXTRA_DIRS`, `MIN_MAJOR`, `TIMEOUT_MS` and `noteFor` stop being exported (no caller, D11).

### `src/server/rendering/lahe_render.lua`

Moved with `git mv`, unchanged, including its own header comment that says `src/service/pandoc.js runs it` (still true through the forwarder until F1, which can fix the line). The no-comments rule covers `.ts` files only.

### `src/server/rendering/tab-icon.ts`

```ts
export const TAB_ICON_LINK: string;
export const LIBRARY_ICON_URI: string;
export const LIBRARY_LINK: string;

export function hasTabIcon(html: string): boolean;
export function withTabIcon(html: string): string;
```

Renamed (D12): `LINK`, `hasIcon` and `ensure` lose the module prefix that made them readable once imported by name (`import { ensure } from ".../tab-icon.ts"` says nothing). The regexes stay inside; the `LINK_TAG` pattern is global, so `hasTabIcon` uses `matchAll` instead of resetting a shared `lastIndex`.

### `src/server/store/state-dir.ts`

```ts
import type { SafeId } from "../../contract/safe-id.ts";

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
export const FILES = {
  ready: "service.json",
  helperLog: "helper.log",
  events: "events.jsonl",
  compactedIds: "events.jsonl.compacted-ids",
  review: "review.json",
  meta: "meta.json",
  windows: "windows.json",
  catalogRequests: "catalog-requests.jsonl",
  catalogAttach: "catalog-attach.json",
  catalogDelivered: "catalog-delivered.log",
  stopWhenQuiet: "stop-when-quiet.json",
  stateId: "state-id"
} as const;
export const STATIC_SERVERS_DIR = "static-servers";

export interface StateDirOptions {
  readonly dir?: string;
  readonly allowInsideCheckout?: boolean;
}

export function stateDir(options?: StateDirOptions): string;
export function flagFor(dir: unknown): string | null;
export function ensureDir(dir: string): string;
export function assertNotSymlink(target: string): string;
export function resolveWithin(base: string, segments: string | readonly string[]): string;
export function assertSafeReviewId(id: unknown): SafeId;
```

plus every path, ensure and write function in B107 to B115, with these shapes:

```ts
export function readyPath(dir: string): string;
export function eventsPath(dir: string, reviewId: string): string;
export function staticServerPath(dir: string, sessionId: string, serverId: string): string;
export function replyFilePath(dir: string, reviewId: string, filename: string): string;
export function writeAtomic(target: string, contents: string | Uint8Array): string;
export function appendLine(target: string, line: string): string;
export function isNotesReview(dir: string, reviewId: string): boolean;
```

and the rest following the same pattern (one `dir`, then the ids the path needs, each a `string` checked by `assertSafeReviewId`).

- **Ids are `string` and checked at runtime.** These functions are where an id from an HTTP body or a file first becomes a path, so they are the boundary, and every caller is JavaScript today. Branding the ids would only move the check. `assertSafeReviewId` returns the contract's `SafeId`, so a typed caller that checks once can carry the brand.
- **The state folder is a plain `string`, not a branded type.** It is passed by 100 files, nearly all JavaScript and nearly half tests with temp folders. A brand would be worth it once the callers are TypeScript; it is not worth it now.
- `FILES` is `as const`, so a typo in `FILES.meta` is a compile error for typed callers.
- `replyFilePath`'s second refusal goes (D8).
- One module, not several: its parts (where the folder is, the path rules, the layout, owner-only writes) are one body of knowledge, about 300 lines of code.

### `src/server/sessions/watchers.ts`

```ts
export type WatchAnswer = boolean | null;

export type ProbeResult =
  | { readonly listening: boolean; readonly supported: true }
  | { readonly listening: null; readonly supported: boolean };

export type Probe = (file: string) => Promise<ProbeResult>;

export interface WatchersOptions {
  readonly ttlMs?: number;
  readonly probe?: Probe;
  readonly now?: () => number;
}

export interface Watchers {
  listening(file: string): WatchAnswer;
  refresh(file: string): Promise<WatchAnswer>;
  unsupported(): boolean;
}

export function createWatchers(options?: WatchersOptions): Watchers;
```

- `null` stays "cannot tell" rather than becoming a three-word union, because `agent_sessions.js` passes the value on into the liveness answer the rail reads; changing its shape is SV3's call.
- Each cache entry is `{ answer, at, inFlight }` with `inFlight: Promise<WatchAnswer> | null`, inside the factory.
- The instance's `TTL_MS`, and the module's `DEFAULT_TTL_MS`, `PROBE_TIMEOUT_MS` and `lsofProbe`, stop being exported (no caller, D11). The lsof probe is still the default and is tested through `createWatchers()` with a real `tail` (B121).
- The old normalizing of a malformed probe result (`result && typeof result === "object"`) goes: the probe is typed and internal.

### Names that change, and what each caller does

| Old | New | Callers to change |
| --- | --- | --- |
| `heal.BUNDLE`, `heal.BUNDLE_BASENAME` | removed; `createHealer` takes `bundle` | `page_routes.js` (spell from the manifest), `reviews.js` (pass `bundle`), `heal_script_line.test.js` (literal) |
| `healer.consider({ path })` (stat only) | `fileMtimeIso(path)` | `reviews.js`, three sites |
| `loginItem.sourceRoots(record)` | `sourceStamp.sourceRootsOf(record.clone)` | `session.js` line 241 |
| `runCommands(item.load, runner)` for a login item | `loadItem(item, { runner })` | `install.js` line 634 |
| `helperPredatesSource(...).helper_started_ms`, `.source_mtime_ms` | `.helperStartedMs`, `.sourceMtimeMs` | the moved freshness case only |
| `tabIcon.LINK`, `.hasIcon`, `.ensure` | `TAB_ICON_LINK`, `hasTabIcon`, `withTabIcon` | `page_routes.js`, `markdown.js`, `tab_icon.test.js`, `catalog_page_csp.test.js` |
| `checkedLabel` (internal) | `parseLabel` (exported) | none |

## 5. Old tests, accounted for

`tests.py` split every unit test file that loads one of these modules into its cases and listed the exports each case reads directly: 265 cases in 64 files. Reading the files whose subject is one of these modules added 46 cases that reach them through another module without naming an export. They fall in three groups:

- **Cases that test these modules: 126, in the table below** (80 of the 265, plus the 46). 69 move into the new `.ts` tests, rewritten against the statement named. 57 stay where they are, because they also drive a module another slice owns (`reviews.js`, `log.js`, `markdown.js`, the CLI); each is mapped to the statement it also exercises, so the overlap is visible. No case is dropped. Four carried cases lose assertions the types make impossible to write (marked "part").
- **Cases that use these modules only to build inputs or find a file: the other 185 of the 265,** nearly all `state_dir` path helpers (`eventsPath`, `readyPath`, `writeAtomic` and the like) in other slices' tests, plus `login_item.writeInstall` and `createWatchers` with a fake probe as setup. None reads a name or shape this spec changes, so they stay unchanged and run through the forwarders.
- **The test helpers and fixtures** that use `state_dir` (`test/fixtures/menubar/state.js`, `test/helpers/old_server_record.js`) stay unchanged.

New `.ts` test files: `test/unit/server/sites/heal.test.ts`, `sites/name-server.test.ts`, `system/login-item.test.ts`, `system/service-manager.test.ts`, `system/install-record.test.ts`, `system/stop-hold.test.ts`, `system/admin-steps.test.ts`, `system/quiet-moment.test.ts`, `system/source-stamp.test.ts`, `rendering/pandoc.test.ts`, `rendering/tab-icon.test.ts`, `store/state-dir.test.ts`, `sessions/watchers.test.ts`. A `.ts` test cannot import `test/helpers/*.js`, so the two moved cases that used `pollUntil` and `freePort` build a small poll inline.

| File | Line | Test | Covered by | What happens |
| --- | --- | --- | --- | --- |
| `heal_script_line.test.js` | 68 | a rebuild that dropped the line gets it back, identical to the one add writes | B11, B12, B13, B15 | stays (drives `reviews.js`); lines 81 and 88 use `"lahe-layer.js"` |
| `heal_script_line.test.js` | 97 | a page carrying a DIFFERENT review's line is left alone and said out loud | B10 | stays |
| `heal_script_line.test.js` | 106 | a file still being written is left until its mtime stands still | B6, B7 | stays |
| `heal_script_line.test.js` | 129 | a file the build deleted is skipped, and the poll still answers | B4 | stays |
| `heal_script_line.test.js` | 140 | a dev-server review is untouched: its target is a directory | B2, B18 | stays (now reaches `fileMtimeIso` through `reviews.js`) |
| `heal_script_line.test.js` | 156 | the helper's own write does not retrigger it: one heal, one mtime bump | B15, B18 | stays |
| `heal_script_line.test.js` | 174 | the heal is reported to lahe status through review.read | B18 | stays (drives `status.js`) |
| `login_item.test.js` | 32 | the helper is started with --always-on, the port, and the state folder | B30 | moves to `login-item.test.ts` |
| `login_item.test.js` | 45 | macOS: the plist names each argument as its own string, spaces kept, XML escaped | B33, B34 | moves; gains the whole-text comparison |
| `login_item.test.js` | 58 | macOS: load, start, and remove go through launchctl for this user | B33 | moves |
| `login_item.test.js` | 65 | Linux: the unit quotes each argument for systemd, and restarts always | B35 | moves |
| `login_item.test.js` | 85 | Linux: XDG_CONFIG_HOME moves the unit folder | B35 | moves |
| `login_item.test.js` | 90 | Windows: the task runs at logon, hidden, with each argument quoted by the Windows rules | B36, B37 | moves |
| `login_item.test.js` | 118 | Windows: a path with a quote character is refused rather than quoted into a task | B36 | moves |
| `login_item.test.js` | 125 | Windows argument quoting leaves plain words bare and doubles backslashes only before a quote | B37 | moves |
| `login_item.test.js` | 135 | write puts the file where the item says, and Windows XML as UTF-16 with a byte-order mark | B39 | moves |
| `login_item.test.js` | 150 | the install record round-trips, and the status says to reinstall when the recorded Node is gone | B57, B59 | moves to `install-record.test.ts` |
| `login_item.test.js` | 172 | installedFor answers only for the port the record names | B58 | moves to `install-record.test.ts` |
| `login_item.test.js` | 181 | a label that could leave its folder is refused | B31, B38 | moves |
| `login_item.test.js` | 191 | V56: the resolver file is fixed text with the Lahe marker and an integer port | B68, B69 | moves to `admin-steps.test.ts`; part: the string-port assertion goes (a string does not compile), `70000` stays and `1.5` is added |
| `login_item.test.js` | 203 | V74: the forward rule is fixed text with the marker, and covers only loopback port 80 | B69 | moves to `admin-steps.test.ts`; part: the string-port assertion goes, replaced by `0` |
| `login_item.test.js` | 214 | V74: the boot item that reloads the forward is fixed text with the marker, run at load | B70 | moves to `admin-steps.test.ts` |
| `login_item.test.js` | 229 | V56 and V74: each install step is one sudo call of a constant script, and its only argument is a port number | B72, B73 | moves to `admin-steps.test.ts`; part: `rootCommand("installForward", "/tmp/folder")` and `rootCommand("nope", 1)` go (neither compiles), an out-of-range integer port is refused instead |
| `login_item.test.js` | 244 | V56 and V74: root builds each file itself, from constants, byte for byte what Lahe expects | B71 | moves to `admin-steps.test.ts` |
| `login_item.test.js` | 250 | V56 and V74: the root scripts refuse an argument that is not a port number | B71, B72 | moves to `admin-steps.test.ts` |
| `login_item.test.js` | 264 | the boot item's XML comment holds no double dash, which XML forbids | B70 | moves to `admin-steps.test.ts` |
| `login_item.test.js` | 270 | V59 and V74: the removal scripts delete a file only when it carries the marker | B72 | moves to `admin-steps.test.ts` |
| `login_item.test.js` | 280 | a sudo call waits for the password as long as it takes; other commands keep their time limit | B42 | moves to `service-manager.test.ts` |
| `name_server.test.js` | 61 | an A query under .lahe gets 127.0.0.1, authoritative, same id and question | B19, B20 | moves to `name-server.test.ts` |
| `name_server.test.js` | 77 | an AAAA query under .lahe gets ::1, and names are matched without regard to case | B20 | moves |
| `name_server.test.js` | 85 | another record type under .lahe is a name with no such record: no error, no answer | B21 | moves |
| `name_server.test.js` | 92 | names outside .lahe, the bare ending, and other classes are refused | B22 | moves |
| `name_server.test.js` | 101 | malformed packets get no answer at all | B23 | moves |
| `name_server.test.js` | 132 | the server answers over UDP, reports each name it is asked, and survives garbage | B25, B26 | moves |
| `pandoc_render.test.js` | 71 | parseVersion reads pandoc's first line | B81 | moves to `pandoc.test.ts` |
| `pandoc_render.test.js` | 77 | LAHE_MARKDOWN_ENGINE=marked forces marked and says nothing | B82 | moves |
| `pandoc_render.test.js` | 83 | LAHE_PANDOC=none acts as a machine with no pandoc, with a log line | B83, B92 | moves |
| `pandoc_render.test.js` | 92 | pandoc's data folder does not exist, so no init.lua can run inside LAHE | B94 | moves |
| `pandoc_render.test.js` | 96 | the filter touches nothing outside the document: no io, os, pipe or mediabag | B94 | moves (a source-text test of the Lua file, section 8) |
| `pandoc_render.test.js` | 101 | the extensions LAHE names are spelled into one --from value | B80 | moves |
| `pandoc_render.test.js` | 128 | a pandoc that exits nonzero falls back, says why, and is not run again for the same text | B88, B90 | moves |
| `pandoc_render.test.js` | 141 | a pandoc that exits before reading its input says its own reason, not EPIPE | B88 | moves |
| `pandoc_render.test.js` | 152 | a pandoc that runs past the timeout is killed, falls back, and is not run again | B89, B90 | moves |
| `pandoc_render.test.js` | 165 | a page whose pandoc fails still renders, with marked | B88, B92 | stays (drives `markdown.js`) |
| `pandoc_render.test.js` | 175 | a pandoc uninstalled after it was found is forgotten, and the note says not installed | B91 | moves |
| `pandoc_render.test.js` | 186 | input over the cap is refused before pandoc starts | B87 | moves |
| `pandoc_render.test.js` | 196 | a pandoc that lacks a named extension counts as too old | B84 | moves |
| `pandoc_render.test.js` | 208 | the page cache key changes when pandoc goes from missing to found | B93 | stays (drives `markdown.engineKey`) |
| `pandoc_render.test.js` | 217 | a requirement run is one eyebrow label over every item, ids kept as anchors | B86 (the filter runs) | stays (drives `markdown.js` and the Lua filter) |
| `pandoc_render.test.js` | 224 | a heading or paragraph between two callouts ends the run | B86 | stays |
| `pandoc_render.test.js` | 229 | non-goals are an eyebrow and plain content, even when they open with a heading | B86 | stays |
| `pandoc_render.test.js` | 235 | each insight kind gets its panel and label; an author's label wins | B86 | stays |
| `pandoc_render.test.js` | 256 | report kinds map onto their house twins | B86 | stays |
| `pandoc_render.test.js` | 298 | a card grid becomes .cards, and a card's bold first line its name | B86 | stays |
| `pandoc_render.test.js` | 303 | an unknown kind is a plain div with its inside rendered, even when it opens with a heading | B86 | stays |
| `pandoc_render.test.js` | 308 | same-count nesting and a five-colon fence both nest | B86 | stays |
| `pandoc_render.test.js` | 314 | a ::: line inside a code fence stays literal code | B86 | stays |
| `pandoc_render.test.js` | 320 | the choice-buttons brief shape renders with no literal fence line | B86 | stays |
| `pandoc_render.test.js` | 327 | hero and one numbered sheet per top-level H2; an H2 in a div or a fence does not split | B86 | stays |
| `pandoc_render.test.js` | 351 | no # heading: the file name is the title, marked as chrome; an empty file still has its hero | B86 | stays |
| `pandoc_render.test.js` | 358 | links: relative and translated stay in the tab, external opens a new one, a missing file is inert | B86, B94 (the nonce) | stays |
| `pandoc_render.test.js` | 380 | a raw-HTML anchor faking the link tag is never classified | B94 | stays |
| `pandoc_render.test.js` | 386 | link text holding raw HTML still swaps whole when the link is inert | B86 | stays |
| `pandoc_render.test.js` | 391 | Mermaid and code blocks keep marked's markup; task items are bare checkboxes; tables scroll | B86 | stays |
| `pandoc_render.test.js` | 400 | a quote in text or inline code stays escaped, so href= in prose is never rewritten | B86 | stays |
| `pandoc_render.test.js` | 407 | an eyebrow keeps a list that follows its line; label= on two metrics keeps both labels | B86 | stays |
| `pandoc_render.test.js` | 414 | words marked shows stay words: no math, no swallowed --- block | B80 | stays |
| `pandoc_render.test.js` | 420 | frontmatter and the style line still work under pandoc | B86 | stays |
| `pandoc_render.test.js` | 429 | hasFencedDiv sees a fence line outside code only | none (markdown.js only) | stays |
| `pandoc_render.test.js` | 437 | without pandoc a page with fenced divs renders with marked and carries the rail's notice | B83, B92 | stays |
| `pandoc_render.test.js` | 449 | without pandoc a page with no fenced div is today's page: no notice, no log line | B83 | stays |
| `pandoc_render.test.js` | 460 | a forced marked never carries the notice | B82 | stays |
| `pandoc_render.test.js` | 468 | writeArtifact logs the missing-pandoc line once to the helper log | B92 | stays |
| `pandoc_render.test.js` | 483 | the house stylesheet carries the new card components | none (stylesheet) | stays |
| `pandoc_render.test.js` | 491 | pandoc's headings get the same ids as marked's | B80 | stays |
| `helper_freshness.test.js` | 149 | a helper that started after the last source change is not stale | B75, B77 | moves to `source-stamp.test.ts`; reads `sourceMtimeMs` and `helperStartedMs` (D10) |
| `helper_freshness.test.js` | 161 | a source file changed after the helper started makes it stale | B75 | moves |
| `helper_freshness.test.js` | 172 | a file in a nested directory counts: the helper loads the whole tree | B75 | moves |
| `helper_freshness.test.js` | 187 | a check that cannot tell never bounces a helper other sessions are using | B76 | moves |
| `helper_freshness.test.js` | 207 | the roots are this clone's own code, and LAHE_SOURCE_DIR replaces them | B78 | moves; computes the clone root from its own new folder (section 8) |
| `helper_freshness.test.js` | 235 | a current helper is left exactly where it is, and a stale one is restarted and said out loud | B79 | stays (drives the CLI) |
| `helper_freshness.test.js` | 300 | session reopen replaces a stale helper and says why | B79 | stays |
| `tab_icon.test.js` | 14 | a page that declares its own icon keeps it, in every relation an author uses | B95, B96 | moves to `tab-icon.test.ts` |
| `tab_icon.test.js` | 30 | a link that merely mentions icons is not an icon | B95 | moves |
| `tab_icon.test.js` | 36 | the fallback goes inside head, and never above the doctype | B96 | moves |
| `tab_icon.test.js` | 54 | ensure is idempotent, so a page served twice grows one icon and not two | B97 | moves |
| `tab_icon.test.js` | 60 | a rendered Markdown document carries the same icon the module spells | B98 | stays (drives `markdown.js`); uses `TAB_ICON_LINK` and `withTabIcon` |
| `service_paths.test.js` | 32 | an unsafe review id is refused, and a safe one is not | B105, B108 | moves to `state-dir.test.ts`; part: the `null` and `7` ids go (neither compiles); the runtime check still refuses them for JavaScript callers |
| `service_paths.test.js` | 45 | a write outside the data directory is refused | B104 | moves |
| `service_paths.test.js` | 57 | a symlink inside the data directory is refused rather than followed | B103, B104 | moves |
| `service_paths.test.js` | 79 | an unsafe agent segment in a reply filename is refused | B111 | moves |
| `service_paths.test.js` | 101 | the state directory refuses to sit inside a checkout | B100 | moves |
| `service_paths.test.js` | 118 | a printed command names the state directory only when the default would miss it | B101 | moves |
| `service_paths.test.js` | 148 | the data directory and its files are owner-only | B102, B112, B113, B114 | stays (drives `reviews.js` and `log.js`) |
| `service_paths.test.js` | 161 | events are idempotent by event_id, never by (item, rev) | none (`log.js`) | stays |
| `service_paths.test.js` | 192 | a torn final line costs the last line and never the history | none (`log.js`) | stays |
| `stop_holds.test.js` | 91 | V27: with stopped.json standing, startThroughItem names who stopped Lahe and when, and starts nothing | B48, B65, B66 | moves to `service-manager.test.ts` |
| `stop_holds.test.js` | 111 | V27: a stop marker that cannot be read still holds | B62, B48 | moves |
| `stop_holds.test.js` | 122 | V27: lahe review's start path refuses while stopped, so the command exits 1 with the stop line | B66 | stays (drives `session.js`) |
| `stop_holds.test.js` | 135 | V27: clearStopMarker removes the marker, and is quiet when there is none | B60, B61, B63 | moves to `stop-hold.test.ts` |
| `stop_holds.test.js` | 145 | V27: without the marker, an unloaded item whose plist is what install writes is bootstrapped, then kickstarted | B51, B53 | moves; expected calls become kickstart, bootout, print, bootstrap, kickstart (D1) |
| `stop_holds.test.js` | 157 | V27: a plist that differs from what install writes is refused with a message to run lahe install, and is not loaded | B52, B54 | moves |
| `stop_holds.test.js` | 175 | V27: a missing plist is refused the same way | B52 | moves |
| `stop_holds.test.js` | 185 | V27: the bootstrap path reads the plist from the fixed folder, never the path install.json names | B51 | moves |
| `stop_holds.test.js` | 203 | V27 and SR6: a label in install.json that is not Lahe's own or a test label never reaches launchctl | B32, B49 | moves |
| `stop_holds.test.js` | 216 | V27: on Linux the marker holds too, and nothing else changes | B48 | moves |
| `stop_holds.test.js` | 228 | V27: a stop marker's `by` that is not plain words is not repeated, so the message stays one line | B61, B65 | moves to `stop-hold.test.ts` |
| `stop_holds.test.js` | 288 | the hold covers every start: lahe add on another port exits 1 with the stop line and spawns no helper | B66 | stays (drives the CLI) |
| `stop_holds.test.js` | 299 | the hold covers every start: lahe serve --always-on on another port exits 1 with the stop line and binds nothing | B66 | stays |
| `stop_holds.test.js` | 308 | the hold covers every start: lahe serve --always-on on the installed port, run by hand, refuses too | B66, B67 | stays |
| `stop_holds.test.js` | 326 | the hold covers every start: the helper itself refuses unless the login item started it, whatever the caller | B66, B67 | stays (drives `index.js`) |
| `stop_holds.test.js` | 345 | the hold covers every start: the login item's own start at login does start, and it alone clears the marker | B63, B67 | stays |
| `stop_holds.test.js` | 353 | startedByLoginItem: launchd's label and parent pid on a macOS install, nothing else | B67 | moves to `stop-hold.test.ts` |
| `lint_lua.test.js` | 27 | a Lua file with a syntax error is reported with its line | none (`scripts/lint_lua.js`) | stays |
| `lint_lua.test.js` | 34 | a good Lua file passes, and is never run | none | stays |
| `lint_lua.test.js` | 41 | the shipped pandoc filter passes | the moved filter compiles | stays; path changes (section 8) |
| `lint_lua.test.js` | 45 | the manifest gives the Lua filter an owner, as it does every file under src/ | the manifest entry | stays; path changes (section 8) |
| `agent_liveness.test.js` | 399 | the probe answers off a real tail, and never blocks the poll | B117, B118, B121 | moves to `watchers.test.ts` |
| `agent_liveness.test.js` | 427 | a probe that cannot run is asked once and then left alone | B120 | moves to `watchers.test.ts` |
| `always_on.test.js` | 270 | waitForQuiet: true once no review's log was written for the quiet window, false if that never comes | B74 | moves to `quiet-moment.test.ts` |
| `no_stray_helpers.test.js` | 176 | a start through the login item ends at its deadline even when the health probe never answers | B54 | moves to `service-manager.test.ts` |
| `install_command.test.js` | 200 | V72: installing again replaces the login item rather than adding a second | B44 to B47 | stays (drives `install.js`); its `fakeManager` answers `print` (section 3) |
| `install_command.test.js` | 488 | a failed install takes back what root set up, through the marker-guarded removal, and names a blocked pages port | B122 to B124 | stays; its assertions hold unchanged (it asserts the blocked-port sentence and the root removals, not the last line) |
| `catalog_page_csp.test.js` | (two cases) | the Library page has its own tab icon: an inline SVG the content policy's img-src allows; the heading carries the Library's brandmark: the favicon's own image, decorative | B98 | stay (drive `catalog_page.js`); `LINK` becomes `TAB_ICON_LINK` |
| `menubar.test.js` | 90 | V23: the app's login item restarts it only on a crash, so Hide (a clean exit) holds | B34 | stays (drives `menubar.js`) |

The `catalog_page_csp.test.js` row counts as two cases.

**New cases with no old counterpart:** B1, B2, B3 and B12; B8, B14, B16 and B17 directly on the healer (only reachable through `reviews.js` before); B24, B27 and the TTL in B20; B29 and B31's non-string; B34's whole plist and `keepAliveOnCrash` lines and B35's whole unit; B40, B41 and B42's spawn failure; B43 to B47 (D1); B50; B55, B56's array and `null`, B59's absent fields; B64's unknown time; B66's `stopped` flag outside `startThroughItem`; B74's defaults; B76's `helperStartedMs` with no source; B78's relative `LAHE_SOURCE_DIR` and `sourceRootsOf`; B83's `PATH` order and relative entries; B85's recheck; B86's arguments and environment; B93's three forms; B98's Library strings; B99; B106 to B110 as tables; B112 to B115; B116 to B119 on a fake probe; B121's "no `lsof`" answer, by running the default probe with a `PATH` that holds no `lsof` (its other answers are reached with a real `tail`, as before); B122 to B124 (D2), and D1's reinstall case in `install_command.test.js`.

## 6. Deliberate differences

Each has its own test. **Noticed** marks one a person or an agent would see; those go on the progress page as departures.

- **D1 (noticed). A login item is loaded by booting out any job with its label, waiting for launchd to forget it, bootstrapping, and retrying once on error 5.** Board row LAHE-install-over-loaded-item: on 2026-11-12 `lahe install`, moving the login item from Node 20 to Node 24, failed with `launchctl bootstrap gui/501 .../lahe-helper.plist exited 5: Bootstrap failed: 5: Input/output error`. A second run installed the helper's item but the menu bar item failed the same way, and right after, `launchctl bootout` said "No such process" while a plain `bootstrap` of the same plist succeeded. So the cause is not proven; the likeliest is launchd refusing a bootstrap right after the old job exits or right after the plist is rewritten. The fix covers both: wait until `launchctl print` no longer finds the label, then bootstrap, and give error 5 one more try after a second. What people see: an install over an existing one no longer fails on the first try in that case; on a fresh install nothing changes except one ignored bootout and one `print`. Where: `loadItem` (B43 to B47), used by `install.js` and by `startThroughItem`'s bootstrap path (B53). Tests, all with a fake runner that records calls and never touches launchd, in `service-manager.test.ts`:
  - a label that is not loaded: bootout answers 3, the first `print` answers 113, bootstrap answers 0; the calls are exactly bootout, print, bootstrap, and the result is ok;
  - a label still loaded: `print` answers 0 twice and then 113; bootstrap runs only after the third `print`;
  - bootstrap answers 5 and then 0: two bootstraps, the second after `retryAfterMs`, and the result is ok;
  - bootstrap answers 5 twice: exactly two bootstraps, and `failed` names `exited 5` and the output;
  - bootstrap answers 37: one bootstrap, no retry;
  - `print` never answers 113: bootstrap still runs once `goneWithinMs` has passed (the test sets it to 50 ms and checks the bootstrap came after);
  - Linux and Windows items: only their `load` commands, in order;
  - the moved `stop_holds` case 145: kickstart (113), bootout, print, bootstrap, kickstart.

  And in `install_command.test.js`, a reinstall over an existing install whose fake launchd answers 5 to the first bootstrap after a bootout installs, exits 0 and prints the success lines.
- **D2 (noticed). A rolled-back install leaves an on-demand helper running instead of none.** Same board row: after the error 5, the rollback printed "nothing is left installed" and nothing answered on 7817 or 1483, so every open review page lost its helper. The install had stopped the old helper to hand the port to the new login item, then removed the item, and nothing started a helper again. Now the rollback ends by starting a helper the way `lahe review` does with no login item (B122 to B124), and says which happened. What people see: the last line of a failed install changes from `` lahe install: nothing is left installed. `lahe review` starts the helper on demand, as before. `` to `lahe install: nothing is left installed.` followed by B123's or B124's line, and open pages keep working. The `install.js` lines this touches are in SV1's owned files for this change only; the CLI slice converts the file later. Tests in `install_command.test.js`, with the same fake service manager the file already uses (no real launchd, no real `/etc`), and helpers spawned through the file's `trackSpawned`, so teardown stops them:
  - a fake whose bootstrap always answers 5: the command exits 1, `install.json` and the plist are gone, a helper answers on the port with `always_on: false` for this state folder, and stderr holds B123's line;
  - a fake whose bootstrap answers 5 while another program holds the helper's port: exits 1, stderr holds B124's line naming the start's error, and no helper of this state folder answers;
  - the existing failed-install case (line 488) passes unchanged.
- **D3. The healer is told where the built layer is.** `createHealer` takes `bundle`, and `BUNDLE` and `BUNDLE_BASENAME` are no longer heal's exports, because the one spelling of the bundle's location is `manifest.BUNDLE_OUTPUT` in a `.js` file a `.ts` file may not import. `reviews.js` and `page_routes.js` spell the path from the manifest, as `index.js` and `add.js` already do. Nothing a person sees changes; `heal.test.ts` passes a temp bundle and checks B13's copy is that file's bytes.
- **D4. Stat-only callers use `fileMtimeIso`.** The old `consider` returned the plain mtime when a review, token or helper origin was missing, which is how `reviews.js` asked for a stat at three sites. Those sites call `fileMtimeIso`, and `consider` takes only healable pages. The one hidden effect of the old path, forgetting the healer's memory of a path that stopped being a file, matters only for a path that is both a stat-only target and a healed one, which no caller has. Tested by B2 and by `heal_script_line.test.js` 140 still passing.
- **D5. `lastHealAt` is on the healer's clock.** The old healer measured the stability window on the injected clock and stamped `lastHealAt` with the wall clock. One clock now. In the helper both are `Date.now`, so nothing changes; a test driving the clock now sees its own time. Tested by B18.
- **D6. `createHealer` no longer throws `createHealer: log is required`.** The type requires `log`, and its one caller always passes one. No test.
- **D7. An `install.json` holding an array or `null` reads as no install.** The old reader returned any JSON value of type object, arrays included, so `lahe install` treated a file holding `[]` as an existing install. The contract's `isJsonObject` is the boundary now. Tested by B56.
- **D8. `replyFilePath`'s "refusing an unsafe agent segment" refusal goes.** The filename pattern already embeds the safe-id rule, so a name it accepts always has a safe agent: the second check could never fire. Every unsafe name is refused with the first message, which the old test's pattern also accepted. Tested by B111's list.
- **D9. "src plus vendor" is spelled once.** `login_item.sourceRoots(record)` and `source_stamp`'s default roots both built `[<clone>/src, <clone>/vendor]`. `sourceRootsOf(clone)` in `source-stamp.ts` replaces the first; `session.js` line 241 calls it. Tested by B78.
- **D10. The source verdict's keys are camelCase** (`helperStartedMs`, `sourceMtimeMs`). They were snake_case with no reason: they never leave the process, and only one test read them.
- **D11. Exports nobody reads are no longer exported:** `heal.STABLE_MS` on the healer instance; `login_item`'s `QUIET_MS`, `QUIET_MAX_MS`, `systemdQuote` and `xmlEscape`; `name_server.parseQuery`; `pandoc`'s `EXTRA_DIRS`, `MIN_MAJOR`, `TIMEOUT_MS` and `noteFor`; `source_stamp`'s `CLONE_ROOT`, `DEFAULT_ROOTS` and `newestMtimeMs`; `state_dir`'s `RETENTION_DAYS` (read by nothing at all), `REVIEWS_DIR`, `AGENT_SESSIONS_DIR`, `REVIEW_ARTIFACTS_DIR`, `STYLES_DIR` and `checkoutAbove`; `watchers`' `DEFAULT_TTL_MS`, `PROBE_TIMEOUT_MS`, `lsofProbe` and the instance's `TTL_MS`. Also gone: `rootCommand`'s runtime refusal of an unknown script name, which the overloads make unreachable. `exports.py` found no reader of any of them in `src`, `scripts`, `test` or `bin`. No test.
- **D12. The tab icon's exports are renamed** `TAB_ICON_LINK`, `hasTabIcon` and `withTabIcon`, and their four callers change (section 4). Behavior is unchanged; B95 to B98.
- **D13. A watcher's probe result is no longer normalized.** The old code turned a non-object or a stray `listening` value into `null`. The probe is typed and only the module's own lsof probe or a test's fake supplies it. No test.
- **D14. The healer needs `servedBy`.** The old one treated a missing `servedBy` as "not served". Every heal call in `reviews.js` passes it, and the type now makes a forgotten answer to "does a site serve this page" a compile error rather than a heal into someone's working tree. No test beyond B8.

## 7. Fixed behavior tests touched

These pin what people and agents see. They must pass unchanged in what they assert; the only edits allowed are the renamed calls and the fake's `print` answer listed in section 3.

- **Skill-wording tests** (users of `test/support/skill.js`): `add_command.test.js`, `mark_done.test.js`, `no_stale_excuse.test.js`, `reply_command.test.js`, `review_format.test.js`, `session_fixes.test.js`, `stable_addresses_docs.test.js`, `status_command.test.js`. None pins a string this slice owns; `add_command`, `mark_done`, `reply_command`, `session_fixes` and `status_command` drive the CLI, which uses `state_dir`, `login_item` and `source_stamp` through the forwarders.
- **`review_format.test.js` and `export_text.test.js`:** neither loads any module in this slice. They are listed so the reviewer can see they were checked.
- **CLI output tests:** `install_command.test.js` (every install and uninstall line except the rollback's last line, D2); `stop_holds.test.js`'s six cases that stay (the stop line from `lahe add`, `lahe serve` and the helper); `helper_freshness.test.js`'s two command cases (`REASON` in the restart line); `always_on.test.js`; `menubar_cli.test.js` (`localTime` and the stopped line in `lahe status`); `status_command.test.js` and `status_catalog.test.js` (state paths); `heal_script_line.test.js` 174 (the heal line in `lahe status`).
- **Browser specs that exercise these modules** (run at the checkpoint, not by the builder):
  - `auto_reload.spec.js`: "a rebuild that stripped the script line heals itself, with no CLI call in between" (heal through `reviews.js`, D3 and D4), and "the tab icon loads under the page's content policy, with no policy errors" (`TAB_ICON_LINK` through `page_routes.js`, D12);
  - `markdown_pandoc.spec.js` (requires `pandoc.js` for `locate` and `reset`);
  - `always_on_stale_replace.spec.js` (`systemFor`, `writeInstall`);
  - `rail_hold.spec.js` (`wakeLogPath`) and `stable_addresses_mappers.spec.js` (`ensureStaticServersRoot`, `staticServerPath`);
  - `rail_agent_liveness.spec.js` (watchers through the helper);
  - `catalog_page.spec.js` (the Library's icon);
  - and, indirectly, every spec that starts a helper, since the helper finds its state folder through `state-dir.ts`.

## 8. Source-text tests

| Test | Reads | Change |
| --- | --- | --- |
| `test/unit/choice_kernel.test.js:393-402` (the plan's table says 448-456; the case has moved up since) | `src/service/heal.js` | Read `src/server/sites/heal.ts` instead. After this slice `heal.js` is a one-line forwarder, so the old path would pass while checking nothing. Nothing else in the case changes. B11's "no `data-lahe-document`" now pins the same promise as behavior, so the CLI slice can drop the text check for heal when it touches this case for `add.js`. |
| `test/unit/lint_lua.test.js:41-43` | `src/service/lahe_render.lua` by path | The path becomes `src/server/rendering/lahe_render.lua`. |
| `test/unit/lint_lua.test.js:45-50` | the manifest's lists | Expects `src/server/rendering/lahe_render.lua`. The list it reads (`LAYER_FILES`, `NON_BUNDLE_FILES`, `CATALOG_PAGE`) still holds the Lua entry, in `NON_BUNDLE_FILES`. |
| `pandoc_render.test.js:96` (moves to `pandoc.test.ts`) | the Lua filter's text, through `FILTER` | Unchanged: the filter moves byte for byte and `FILTER` names its new place. |
| `helper_freshness.test.js:207` (moves to `source-stamp.test.ts`) | compares `roots()` to `<repo>/src` and `<repo>/vendor` | Computes `<repo>` from its own new folder (`test/unit/server/system/`, four levels down). |

No other test reads these files' text. `test/unit/review_write_hardening.test.js` names `src/service/heal.js` in a comment only.

## 9. Comments to move

The sections below are drafts for the folder docs. Each new doc opens the way `docs/ongoing/code/server-sites.md` does: `read-when` and `not-for` frontmatter, a title naming the folder, one sentence on what it holds, and the line that source files carry no comments except their header. The builder adds only these sections.

### `docs/ongoing/code/server-sites.md` (extended)

#### `heal.ts`: putting a stripped script line back

A rebuild regenerates a page's HTML, and the lahe script line goes with it, so the reviewer's page comes back with no rail. Telling agents to rerun `lahe add` after every rebuild did not hold: they forgot. A rule an agent has to remember is not a mechanism. The helper already stats each review's target about once a second for the reload trigger, so it is the thing that can notice the line is gone and put it back, and the page's own reload then lands on the healed file.

Five rules keep it from doing harm:

1. **Stable first.** A build writes a file in pieces. Reading it mid-write would find no line in a half-written page and "heal" a file the build is about to overwrite. So a new mtime is looked at only after it has stood still for one poll interval (500 ms; the library polls once a second and the mtime read behind it is cached for 500 ms).
2. **Atomic write.** A temp file beside the target, then a rename, so no reader sees half a page and a crash leaves the original whole.
3. **Another review's line is not ours.** A file carrying a different review's line was re-attached on purpose (`lahe add --new`, or a second review). It is logged and left alone.
4. **No loop.** The heal's own write bumps the mtime once, and that bump is the reload the page is waiting for, so it is not suppressed. What is suppressed is looking at it again: the post-write mtime becomes the baseline.
5. **A served page is never healed.** When a site serves the page, its script line goes into the HTTP response, so writing it into the file would put a review id and a per-review token into the reviewer's working tree. That tree is usually a git checkout; `git add -A` commits both, and a deployed copy then loads the review rail for every visitor. The question is asked before the file is read, because a served page never needs reading.

Everything fails soft. This runs under a route the reviewer's page depends on, and a page that cannot poll is worse than a page missing its rail. A write that fails is reported once and not retried until the file changes again, so a file nothing can write does not fill the log once a second.

Only `.html` and `.htm` files are healed: the pages `lahe add` writes a line into. A dev-server review records a folder, never a file, and a printed-snippet review records a template in the application's code, which `add` refuses to edit and so does this. `fileMtimeIso` answers only for a regular file for the same reason: a folder's mtime moves on every `npm install`, checkout and stray `.DS_Store`, and stays still when the page itself is edited, so the reload fired on churn and never on the change it exists for.

The fallback copy of the built layer beside the page is refreshed exactly as `add` refreshes it, because that is what the line's `onerror` loads. A missing bundle is not a reason to leave the page without its line, so the copy is best effort. The healer is handed the bundle's path rather than knowing where the repo keeps it; `manifest.BUNDLE_OUTPUT` is the one spelling until the manifest goes.

#### `name-server.ts`: answering `.lahe` names

`lahe install --lahe-names` writes `/etc/resolver/lahe`, which sends every `.lahe` lookup on the Mac to 127.0.0.1 at the port `install.json` records, and this module answers them.

It answers as little as it can. A name under `.lahe` gets 127.0.0.1 or ::1, marked authoritative; another record type gets no error and no answer; anything else, the bare `lahe` included, gets REFUSED; a packet that is not one well-formed standard query gets nothing at all. It only has to make `<name>.lahe` reach this computer. The helper still checks every Host against its registry, and refuses `.lahe` Hosts until it has proved this server is what answers `.lahe` lookups here (`addresses`). That proof is why the server reports each name it is asked.

It binds 127.0.0.1 only, never another interface. A compression pointer in a query's name is refused rather than followed: a query never needs one, and following one is how a parser is made to loop.

### `docs/ongoing/code/server-system.md` (new)

#### `login-item.ts`: what a login item is on each system

The login item makes the helper start at login and restart if it stops. `lahe install` writes one and `lahe uninstall` removes it. One item per system: on macOS a LaunchAgent plist (RunAtLoad, KeepAlive), loaded with `launchctl bootstrap gui/<uid>`; on Linux a `systemd --user` unit with `Restart=always`, enabled with `systemctl --user enable --now`; on Windows a Task Scheduler task imported from XML, run at logon plus a once-a-minute trigger that starts it again if it stopped (a running task ignores it) and restart on failure.

**The item pins everything.** A service manager does not start programs with the user's shell environment, so the item names the Node that ran the install, the clone's `bin/lahe.js`, the port and the resolved state folder, all as absolute paths. Nothing is read from `PATH` or `LAHE_STATE_DIR` at login.

**Every argument is quoted by its own format's rules:** a plist `<string>` per argument, systemd's double-quote rules with `%` and `$` doubled, and the Windows command-line rules (the ones `CommandLineToArgvW` and the C runtime read back: backslashes are literal unless they come before a quote) inside XML. Windows paths cannot hold a quote, so an argument with one is refused rather than trusted to the quoting. On Windows the task runs `conhost --headless`, because `node.exe` is a console program and started directly at logon it would open a window.

**The plist's bytes are a contract with machines already installed.** `startThroughItem` loads an unloaded item only when the plist on disk is exactly what `describe` writes for the record, so changing a byte of the plist text makes every existing install refuse until it is reinstalled. Change it only with that in mind.

The menu bar app's item uses the same plist with `keepAliveOnCrash`: KeepAlive restarts it only after a crash, so Hide (a clean exit) stays hidden until the next login. The helper's item restarts on any exit.

A label is a file name and a service name. Only Lahe's own two labels, and test labels starting `lahe-test` or `lahe-spike`, pass `knownLabel`, so an edited `install.json` cannot point a `lahe` command at another job.

#### `service-manager.ts`: running service-manager commands

Commands are argument arrays for `spawnSync`, never a shell line. Each has a 30-second limit except `sudo`, which waits for a person to type a password; a slow typist is not a failed admin step.

**Loading an item on macOS** boots out any job with the same label, waits until `launchctl print` no longer finds it, bootstraps, and tries once more if bootstrap exits 5. An install that moved the login item from one Node to another failed with `Bootstrap failed: 5: Input/output error`, and a second attempt moments later succeeded; the cause is not proven, and the likeliest is launchd refusing a bootstrap right after the old job exits or its plist is rewritten. If error 5 comes back after this, look at the timing first (board row LAHE-install-over-loaded-item).

**Starting through an installed item.** The CLI never spawns its own helper when a login item is installed: a second copy would hold the port, and the service manager's own restart would then loop on it. It asks the item, and waits. An item launchd has no record of (unloaded by hand, or a stale install) is loaded from its fixed path first, and only when that plist is exactly what install writes for the record; the path comes from the home folder and the label, never from the record, so an edited `install.json` cannot have a file somewhere else loaded. One uid is used for every `launchctl` call, the caller's, else the record's, else this process's; using the record's in one call and the machine's in another once made a test see the wrong one. launchd will not start a job again within ten seconds of its last start, which is why the wait is twenty. A health probe that never answers cannot hold the wait past its deadline: it gets what is left of the wait plus a second.

#### `install-record.ts`: `install.json`

The CLI reads `install.json` to know it must ask the login item for a helper instead of spawning one. The record holds more than the server reads (the admin steps, the menu bar block), so it is kept and rewritten whole, and the server reads its own fields through `installedView`. The item names the Node that ran the install and the clone it ran from, so removing either means installing again, and `lahe status` says which.

#### `stop-hold.ts`: the menu bar's Stop

The menu's Stop writes `<state>/stopped.json` and then unloads the helper's login item, because a plain kill would be restarted at once. The file is the hold, for every port on that state folder: `startThroughItem`, the CLI's own spawn of `lahe serve`, and the helper's own start all refuse while it stands, so an agent's `lahe` command fails in one line and starts nothing. Three things end it: the menu's Start and `lahe install`, which remove the file, and the login item starting the helper at login, the one helper start that removes it. Nothing else removes it, so a running helper always means a person started it.

A marker that cannot be read still holds: the file existing is the hold, and its time is only what the message says. Its `by` field goes into a one-line message an agent reads, so only plain words are repeated; anything else reads as "menu bar".

"Started by the login item" means launchd's own child (parent pid 1) with `XPC_SERVICE_NAME` set to the job's label; a command run from a terminal has neither. Only macOS: the marker is written by the Mac menu bar app, and elsewhere only `lahe install` ends it.

#### `admin-steps.ts`: the two macOS root steps

`lahe install --port-80` and `--lahe-names` each make one `sudo` call. **Root never reads a file the user owns:** the root script builds each file's text itself from constants in the script and writes it into a root-owned folder. Its one argument is a port number, and the script refuses anything else before it writes anything. The script is a constant; nothing is spliced into it. Every file carries the marker `# lahe-managed`, and both the install and the removal scripts leave alone a file without it.

The shell printers in `ROOT_TEXT_FUNCTIONS` are generated from the same line tables as `resolverText`, `forwardRuleText` and `forwardDaemonText`, and a test runs them as the user, printing only, to check they match byte for byte. That is why no line may hold a single quote or a `%` other than the port's placeholder.

The forward is a pf rule in the `com.apple/lahe` anchor. macOS's own `/etc/pf.conf` already has `rdr-anchor "com.apple/*"`, so no system file is edited. A launchd daemon loads the anchor again at every boot. The daemon's XML comment holds no double dash, which XML forbids. On Linux the `.lahe` resolver is a systemd-resolved drop-in the person writes by hand (`docs/INSTALL.md`).

#### `quiet-moment.ts`: waiting for a quiet moment

An always-on helper older than its code is replaced even with review windows open: the address and port do not change, and the layer rides out a helper restart. It waits for a moment when no review's log is being written, so a comment is not in flight while the helper goes. A comment that is still lands anyway, from the page's outbox on reconnect; the wait only makes that rare.

#### `source-stamp.ts`: a helper older than its code

The helper is deliberately shared and long-lived: one process serves every project, agent and session on the machine. That is what makes `lahe review` one command, and it is how a helper ends up running since before the clone was last edited, silently writing the old behavior. It happened: a change to the agent instructions in `review.json` did not reach agents for two days, because the helper held its modules in memory, and the per-review page servers (then spawned fresh) made everything else look right.

**Why not compare versions.** `/health` reports the package version and the service contract number, and neither changed that day: the version did not move and nobody remembered to bump the contract, which is exactly what people do not remember. The signal that cannot be forgotten is the filesystem: if a file the helper loaded at boot changed after it booted, the process runs code the clone no longer has.

**What counts as the code:** everything the helper loads at boot and holds, `src/` and `vendor/`. `dist/` is not in it: the helper re-reads the bundle when it changes, so a rebuilt layer needs no restart and must not force one mid-review. A check that cannot tell (an unreadable start time, no source on disk) says "not stale": it must never bounce a helper other sessions are using. `LAHE_SOURCE_DIR` replaces the roots so a test can age a scratch tree instead of touching the real clone's mtimes, which every other test running beside it shares.

**Cost:** one readdir per folder and one stat per file, stopping at the first file newer than the start, and it runs only when a helper is answering.

Its module sits three folders below the clone root (`src/server/system/`), not two as the old file did.

### `docs/ongoing/code/server-rendering.md` (new)

#### `pandoc.ts`: rendering Markdown with pandoc

The feature-forge and research-report builds turn Markdown into HTML with pandoc, and their docs use pandoc syntax: fenced divs (`::: callout-req`), nested fences, the `{.class}` attribute form. marked cannot read those, so a doc that rendered as panels in a build showed its fences as text in Lahe. Rendering with the same tool means the two never disagree about syntax.

**A system dependency, not an npm one.** Pandoc is allowed only in this shape: nothing is installed for the user, and a machine without pandoc still renders every page with the vendored marked. This module answers one question per render, "did pandoc produce HTML?", and the Markdown renderer falls back when the answer is no.

**The extensions.** gfm plus fenced divs, as the builds read it, minus what would change the words on the page from what marked shows: heading ids (pandoc's would not match marked's, so the renderer writes the same GitHub-style ids on both engines' headings), YAML metadata (a later `---` block would vanish; the real frontmatter is already stripped), and dollar math (`$HOME` and `$PATH` would turn italic). Emoji, alerts and footnotes stay, as in the builds. Naming an extension a pandoc does not know is a hard error, so the names are checked with `--list-extensions` when pandoc is first found.

**Finding it.** The helper inherits `PATH` from whichever agent shell started it, which may not include Homebrew's folder, so `/opt/homebrew/bin` and `/usr/local/bin` are searched too. Only absolute `PATH` entries count: an empty or relative one would resolve against the helper's working folder. A found pandoc is kept for the process; a missing one is looked for again after a minute, so installing it needs no restart.

**The call.** One process per distinct text: an argument array, no shell, the Markdown on stdin, a time limit, an output cap and `--sandbox`. `spawnSync` blocks the helper's event loop, so a slow document stalls every session it serves; five seconds is far past any real document, and a timeout is cached like any other failure, so the same text goes straight to marked next time. Node's default 1 MB output buffer is too small for a long report, hence 32 MiB. `EPIPE` only says pandoc stopped reading; when it also exited with a failure, its status and stderr are the reason.

**Lua is the gap in the sandbox.** `--sandbox` limits what pandoc's readers and writers open, not Lua. A data directory's `init.lua` runs on every call, so pandoc is pointed at a data directory that does not exist (a test keeps it that way), and the filter uses no `io`, `os`, `pandoc.pipe` or mediabag call (a test greps for them). `LUA_PATH`, `LUA_CPATH` and `XDG_DATA_HOME` would change what the filter's `require` and the data directory load, so the child gets a minimal environment.

**The nonce.** The filter stamps every link it wrote with a random value. Raw HTML can carry a `data-lahe-link` attribute too, so the renderer trusts only this value, which no document can know in advance. It is fixed for the process so the output cache stays valid. Only pandoc's raw output is cached; link classification depends on the render's folder and registry, so it runs on every render.

**Switches.** `LAHE_MARKDOWN_ENGINE=marked` forces the fallback; the unit suite sets it so its expected strings do not depend on the machine, and a user can set it to get the old renderer. `LAHE_PANDOC` names the binary when it is not on `PATH`, or is `none` to act as a machine without pandoc, which is how tests reach that path on a machine that has it. A caller that asks for pandoc by name (`engine: "pandoc"`) gets it even when the environment forces marked.

The notes are for the helper log. The reader sees the rail's own fixed line instead, never this text.

#### `lahe_render.lua`: the pandoc filter

Moved unchanged; its own header comment explains each step. It is not `.ts`, so the comment rule does not apply, and lint compiles it (never runs it) with `luac` or pandoc's own Lua.

#### `tab-icon.ts`: the fallback tab icon

A reviewer usually has several documents open, and a page with no icon gets the browser's blank default: a row of identical grey tabs. The rendered-Markdown page has always carried this icon; the gap was every other document, such as an HTML file an agent just wrote, which has a title and no icon.

**A page that declares its own icon keeps it.** This is a floor, never an override: a served page is the author's document with a review layer on it. Any icon relation counts, not just `rel="icon"`: a page that ships only `apple-touch-icon` or `mask-icon` made a choice, and a second link under it would win on some browsers and not others. The test is per `rel` token, so `rel="stylesheet"` on `icons.css` is not an icon.

The icon goes in the least presumptuous spot that works: inside `<head>`, else after `<html>`, else after the doctype. Never above the doctype: a `<link>` before `<!doctype html>` puts the browser in quirks mode, breaking the page's layout to decorate its tab.

It is an inline `data:` URI because Lahe has no runtime dependencies: no second asset to serve and no extra request. The drawing is a white page with a folded corner and an uppercase L on a blue rounded square. The Library's icon is the same family on a dark square, with books on a shelf and one leaning in blue, so it is told apart from every document tab; one constant serves its tab and its heading's brandmark, so they never drift. (`docs/CONTRACTS.md` still describes the document icon as a speech bubble; the drawing changed to a document.)

### `docs/ongoing/code/server-store.md` (new)

#### `state-dir.ts`: the state folder and its rules

Where the helper keeps everything, and the rules that keep it from being talked into writing somewhere else. Loopback is not a security boundary, so the folder defends itself:

- **Outside any checkout.** A state folder inside a clone means one `git add -A` publishes a whole review history, which burns a user with no attacker involved. So `stateDir()` refuses one rather than warning. `.git` is a folder in a clone and a file in a worktree; both count. An explicit `--state-dir` goes through the same refusal. `allowInsideCheckout` exists for the repo's own tooling; nothing shipped passes it.
- **Owner-only.** Folders 0700, files 0600. `ensureDir` tightens an existing folder, because a recursive `mkdir` applies the mode only to folders it creates.
- **No symlinks inside.** A symlinked `events.jsonl` pointing at `~/.ssh/authorized_keys` turns an append-only log into an append-anywhere primitive, and the append itself is the attack: nothing has to be read back. `resolveWithin` needs both halves: the containment check alone is beaten by a symlink inside pointing out; the symlink check alone is beaten by a `..` segment.
- **Ids are path components,** so review, session and server ids go through the contract's safe-id rule before they touch a path. The agent segment of `replies-<agent>.jsonl` is one too, and the reply file pattern carries the same rule.
- **Write beside, then rename.** A rename within one folder is atomic, so a crash leaves the old whole file or the new whole file, never half a `review.json`. The temp name carries the pid and time so two helpers cannot collide.

The layout, under `$LAHE_STATE_DIR`, else `$XDG_STATE_HOME/lahe`, else `~/.local/state/lahe`:

- `service.json`: the readiness file (port, pid, per-review tokens).
- `helper.log`: one line per notable thing, and one per refusal naming the check that failed.
- `windows.json`: who holds each review's window session, beside `service.json` rather than under a review, because the question every reader asks is "does any review have a live page", and a reader that has to walk every review folder to answer will skip the walk.
- `reviews/<id>/`: `events.jsonl` (append-only, one JSON event per line); `events.jsonl.compacted-ids` (event ids `scripts/compact_draft_history.js` took out of the log, which the log reader counts as already seen, so a browser re-posting one gets a duplicate answer); `events.jsonl.pre-compact.gz` (that script's copy of the log before it ran); `review.json` (the projection the agent reads); `meta.json` (the token, the registered origins, and the notes marker, which `isNotesReview` is the one on-disk reader of); `replies*.jsonl` (what agents append).
- `agent-sessions/<id>/`: `session.json`; `wake.log`, the wake feed a host may `tail -f`, only ever appended to, never written atomically, because an atomic replace makes a new inode and `tail -f` follows the old one into oblivion; `monitor.json`, the monitor's heartbeat; `activity.json`, when the session last ran a `lahe` command, its own file because a takeover rewrites `session.json` and a drain landing in the same instant would race it; `delivered.json`, what the monitor already printed at this handoff; `ended-delivered.log`, which ended reviews this session was already told about (ended is a state, not an event, so a monitor with no memory of it would wake on it at every relaunch, each costing a model turn); `catalog-delivered.log`, the Library requests its monitor already woke it for, keyed by handoff rev so a takeover delivers a pending request again; `static-servers/`, the retired page servers' records; `review-artifacts/`, rendered Markdown.
- `catalog-requests.jsonl` (the Library's request queue, written only by the helper and `lahe library answer`), `catalog-attach.json` (which session the Library hands requests to, written only by the CLI so it never shares a writer with `catalog.json`).
- `stop-when-quiet.json`: the last `lahe session close` left the helper up because a page was open; this asks it to stop once that reason is gone. Written by the CLI, removed by the helper.
- `state-id`: a random token written once per state folder; a helper that finds it missing or changed knows its folder was removed or replaced.
- `styles/<style-id>/`: installed document styles, written only by `lahe style add`.

`flagFor` decides whether a printed command needs `--state-dir`. Every command Lahe prints is meant to be copied and run elsewhere, and a command copied out of a review whose state lives in a custom folder used to resolve the default one: it reported no work while items sat unanswered. The flag is printed only when it changes the answer; with the environment already pointing there, it would be a long flag on every command an agent runs for nothing. It compares with the checkout refusal waived, because it is a comparison, not a use.

### `docs/ongoing/code/server-sessions.md` (new)

#### `watchers.ts`: is anything holding a file open

The helper is local, so it can ask a question a web server never could. An agent host that arms `tail -n 0 -f wake.log` is the wake channel Lahe wants (a file tail catches every line and costs no model tokens), and it leaves a trace the kernel holds: `lsof` on the wake feed names the `tail`.

**Why an open handle is strong evidence.** The file is Lahe's, created for exactly one purpose, and nothing else on the machine has a reason to hold it open. So a process holding it open is an agent watching that session.

**What it does not prove.** Something listening is not something answering: a `tail` stays armed over an agent that stopped reading. So this answer never makes a wait shorter or quieter; it only decides which of two sentences the reviewer reads while waiting.

**The cost rule.** `lsof` is a subprocess and the reply poll runs about once a second per open page, so it never runs on the poll path. Callers get the last answer, and asking is what schedules a refresh, at most one per file per TTL and never two at once. Fifteen seconds is the monitor's own loop, far inside the ten minutes at which the rail starts shouting. A CLI, which exits in milliseconds, uses `refresh` and waits, or it would print "unknown" for every session.

**Cannot tell is `null`, never `false`.** No `lsof` (Windows, a stripped container) is `null` forever after the first attempt; asking every fifteen seconds would be a subprocess per session per quarter minute for an answer that cannot come. A timed-out or failed run is `null` this once. `lsof` exit 1 with no output is its way of saying nobody has the file open, which is an answer. `--` ends the options so a path starting with a dash is still a path. "Nobody is there" on a machine that cannot be asked would be the exact fabrication this exists to prevent.

### Dropped as dead history

- Owner codes (`1A`, "stable addresses, install workstream", "lahe-names workstream") and the manifest `owner` strings in comments.
- Decision and finding ids that no longer resolve: "Architecture D11", "D5", "Data and state section", "menu bar brief R14", "security review SR6", "SR12", "R36", `itm_1c30f3ece7748d0bab3f9b75`, "LAHE-unit-run-timeout" (the rule each one justified is kept, in words).
- Dates and incident specifics: "twice in live use on 2026-08-18", "It happened here on 2026-08-23", "contract 31 entries before restarting the helper, 32 after", the predecessor tool's commit `8bb9ce4`, "Ken overrode the zero-dependency rule on 2026-10-17", "Ken asked for a document rather than the speech bubble", and the measured "0.43ms for the full walk over 63 files".
- `heal.js`'s "Node-only" and "No dependencies" lines (the folder says it), and JSDoc `@param` and `@returns` tags (the signatures say it).

## 10. Open questions

1. **The menu bar app's item should load through `loadItem` too.** Ken's second install failed the same way on the menu bar item, but that load is in `menubar.js` (SV2). Recommendation: SV2's spec makes `installApp` and `showApp` call `loadItem` (its item would need the `LoginItem` shape, or `loadItem` takes the label, domain and plist path). Until SV2 lands, the menu bar item can still fail with error 5 on reinstall.
2. **The real cause of error 5 is unproven,** so D1 is a hedge tested only against a fake launchd. The one real proof is Ken running `lahe install` over an existing install in his own terminal after this merges. Recommendation: add it to the checkpoint walk.
3. **`CLAUDE.md` names `src/service/pandoc.js` and `src/service/lahe_render.lua`** in its zero-dependency section. After this slice the Lua path is wrong. It is not this slice's file; the orchestrator should change those two paths in the merge.
4. **D2 starts a helper even when none was running before the install.** The board row asks for "a running on-demand server rather than none", so the spec does that every time. An on-demand helper nobody uses is harmless, and the next `lahe review` would start one anyway. If Ken prefers "only when one was running before", it is one condition in `install.js`.

## Orchestrator decisions (2026-11-12)

1. **D2 is narrowed: the rollback leaves the server as the install found it.** If a server was running when `lahe install` started, the rollback leaves one running, restarted on demand when the failed load stopped it. If none was running, the rollback starts none. Test both cases against the fake launchd.
2. **The menu bar's login item uses `loadItem` too.** SV2 rebuilds `menubar.js` and calls it; the SV2 spec says so. Ken's second install hit the same error 5 on the menu bar item.
3. **`CLAUDE.md`'s line naming the Lua filter's path** is SV1's to update, since SV1 moves the file.
4. **Proof on Ken's Mac:** once SV1 is merged, the progress page asks Ken to run `lahe install` once in his own terminal. That checks the real launchd, which the tests cannot.
