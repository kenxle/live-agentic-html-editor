---
name: maintain-verification-skill
description: Audit Lahe's verification skill and feature map against current source and real browser journeys; repair documentation or harness drift and report product regressions. Use for a maintenance automation or a requested verification-map refresh.
---

# Maintain Lahe verification

Target [verify-lahe](../verify-lahe/SKILL.md) and its
[feature map](../verify-lahe/features/README.md). This is a repo-specific
adaptation of Lauren Tan's pstack
[maintenance skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md).
It does not schedule an automation by itself.

## Outcome and boundaries

Report **clean** only when every mapped feature and listed entry point has
source and live coverage. Report **changed** when proven corrections are ready
to ship, and **blocked** when coverage or safe shipping cannot finish. Name
unrun paths and prerequisites. A green seed alone cannot produce clean.

Keep edits within `skills/verify-lahe/`. Do not change product code or weaken
a journey to make a product regression look like documentation drift. Report
product gaps with source and failing evidence for the project's board; leave
product fixes to a separate task. Preserve the repo's PR and gate policy.

## Read and reconcile

Check that the feature index and sibling files agree and their links resolve.
Read the source anchors, relevant specs and recent changes for each feature.
Explain the current user path and identify concrete drift. Check recent user
surfaces for missing map entries; require a source path before adding one.
Use read-only source readers in parallel when useful, with one owner per
feature. Give them only that feature, its source anchors and the output
contract: summary, source citations, drift or none, and a live recipe. Readers
do not drive the app, edit files or run removal commands.

The coordinator combines overlapping recipes and owns all browser driving.
Use the existing fixture lifecycle: fresh isolated worlds per test, serial
browser commands, no shared human helper. Reuse evidence for overlapping paths
only when it covers the same code and actions.

## Prove and triage

Follow verify-lahe's Launch, Doctor, Drive, Evidence and Cleanup instructions.
Exercise every feature and its listed entry points. After an unexpected result,
doctor the instance and reset a wedged page by ending its owned world before
restarting. Keep failed evidence. Stop owned processes even when a drive fails.
Check artifacts survive cleanup.

- Wrong instructions with working product behavior: fix the map and re-drive.
- Working behavior the harness cannot drive: fix a skill-owned helper if there
  is one and re-drive. A change outside the edit scope is a separate task.
- Broken product behavior: report it with evidence; do not rename it expected.
- Missing OS, auth or host: report the prerequisite and attempted route. Do not
  count that route as passed. Fix an omitted prerequisite in the map.

Retry a doctor failure caused by a corrected skill instruction once. If the
environment remains unavailable, report blocked rather than looping.

## Handoff

Keep run notes and artifacts outside committed source. Record the source SHA,
dirty diff, command, each feature's result, entry points exercised, failures,
prerequisites and artifact paths. Read the final diff before shipping. Produce
a focused PR only for proven corrections and only after the repo's required
checks; clean and blocked passes need no PR. Do not merge automatically or
claim board items as part of this maintenance pass.
