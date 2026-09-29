# Code review of the integrated diff (feature-dev:code-reviewer)

Saved by the orchestrator; the reviewer had no write tool.

1. (85) Any page with no content blocks at load opens an edit session on its own: editing.js scheduleEmptyPage (4167-4191, from bind at 4735) runs for every review. Fix: gate openEmptyPage on the review's notes flag.
2. (85) A sitting that ends with no new blocks keeps stale run fields (new_blocks, anchor_tag_after): runShaped is not sticky; the plain capture branch keeps old fields (editing.js 2744-2750, 3052-3055, 3104-3111, 1041). Fix: sticky runShaped or clear the run fields in the plain branch.
3. (80) Undoing a handled tag change never reaches the source: the take-back carries no old tag (record.js revertOf 1549-1578, runRevertOf 1870-1893; replay.js 3136-3155). Fix: take-back carries the old tag, change text says so, replay's tag leg acts on it.
4. (70) The layer never refuses an old helper; only add.js and session.js check service_contract. Fix: layer reads service_contract from health and goes read-only when older.
5. (60) Each keystroke rewrites the whole run record (persist, store.write, queueEvent). Fix: debounce run-draft persistence.

Codex (reviews_impl/codex.md) adds: protect.js 644-649 run damage check compares text only, so a repaint that strips bold is not restored.
