# Troubleshooting and exceptional serving

- Find records in `<state-dir>/reviews/<review-id>`. The state directory is
  `$LAHE_STATE_DIR`, else `$XDG_STATE_HOME/lahe`, else `~/.local/state/lahe`.
- Run `lahe status` for "are you getting my edits?" It shows the last page
  check-in and comment. If the rail says no agent is listening, arm the monitor.
  Only a reply calms its waiting indicator; an armed monitor does not.
- Tailing `review.json` goes deaf: the file is written atomically and a tail
  follows a deleted inode. `events.jsonl` has no session routing. Use the
  printed session monitor; do not wrap it in your own polling loop.
- If no page has ever connected and the reviewer uses an unknown origin, run
  `lahe add <page> --origin <their origin>`.
- If an open page blocks a helper restart, wait until the reviewer is done,
  then run `lahe serve --restart`.
- A served review injects the script into the response, leaving the source
  alone. Use `lahe add` only for a new origin, a source hint, or when no helper
  is running. `lahe wait` is removed. A `python3 -m http.server` serves no rail.
- If you opened a raw disk copy as well as the served review, tell the reader
  to close the disk tab and use the one printed URL.

### The `file://` fallback

Use `file://path/to/page.html` only when you cannot run a server. The script line
and a copy of the library then live in the folder beside the page, so a rebuild
that overwrites the file removes the rail. A running helper writes the line back.

When your rebuild is an ad hoc script rather than a project build, run
`lahe review path/to/file.html --session <agent-session-id>` right after the
script writes and before you tell the reviewer to look. Run
`lahe add <page> --remove` when a `file://` review is finished.

For commands and installation details, use `docs/CLI.md`, `docs/CONTRACTS.md`
and `docs/INSTALL.md` in the Lahe clone (the path inside `~/.local/bin/lahe`).
