### Workstream: lahe-names (Step 6)

**Outcome:** on macOS, `lahe install --lahe-names` makes every site also answer at `<name>.lahe`, and only after the helper has proved its own name server answers `.lahe` lookups. What `lahe review` prints follows Ken's answer to the open question on the printed ending.

**Reads first:** the architecture's "`.lahe` on macOS (opt-in)" section, Security notes (DNS rebinding, name server), the brief's questions leaf (the printed-ending question and Ken's answer).

**Authority:** the architecture, plus Ken's answer at the review gate. Depends on install Step 5.

**Task 6.1: The name server (`src/service/name_server.js`).** Loopback UDP on the port from `install.json`. Answers `A 127.0.0.1` and `AAAA ::1` for names under `.lahe`, `REFUSED` otherwise, drops malformed packets without throwing. Started only when `install.json` records the resolver. Acceptance: V54, V55.

**Task 6.2: Resolver setup and verification.** `--lahe-names` writes `/etc/resolver/lahe` with fixed content and a Lahe marker in one `sudo` call, no shell interpolation. The helper verifies at start and every 5 minutes with a fresh random name it must see itself. Page routes accept `.lahe` Hosts only while verified. Uninstall removes the file only when it carries the marker. Acceptance: V56 to V59.

**Task 6.3: Only if Ken chooses `.lahe` as the printed ending.** Copy fallback in `src/layer/export.js` and `overlay.js` (the Library's ships in Task 4.2 either way), a local-storage lease when Web Locks is missing in `src/layer/store.js`, and page-type detection from `Accept` when Fetch Metadata is missing. Acceptance: V60 to V62. If Ken keeps `.lahe.localhost` printed, this task is dropped and the rows are marked not applicable.

**Don't touch:** catalog files; `sites.js` beyond its exports.
