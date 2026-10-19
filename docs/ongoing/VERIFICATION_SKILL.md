# Verification for future cloud agents

The verification skill and starting feature map are written and the live seed
journey passed. Nothing is needed from you right now. You have already given
the direction: make verification reliable, then let cloud agents take work
from the bulletin board.

Updated: 2026-10-18T22:35:17-04:00

## What happens next

**The next engineering task is to prove the rest of the starting feature map.**
The skill is written, but only the Markdown writing journey has been exercised
for this handoff. We should establish which other journeys work before giving
a cloud agent responsibility for fixes.

- **Finish local verification and land the skill.** Exercise the mapped comment,
  choice, Library and document workflows. Record failures honestly, complete
  the required checks, and prepare the branch for the normal PR process.
- **Prove a fresh cloud run.** Use Claude Code cloud as the initial target,
  following your suggestion. Start with the existing writing journey and retain
  its evidence. Check setup, browser execution and cleanup in that environment.
- **Pilot a board task.** Choose a small, clearly specified bug with a testable
  outcome. Have the agent reproduce it, fix it, run verification and submit a PR
  for review. A successful pilot should include evidence of the failure and fix.
- **Then automate pickup and maintenance.** Define which board items agents may
  take and how they claim work without colliding. Add the feature-map maintenance
  run so the verification instructions keep pace with the product.

The local verification work needs no further decision from you. If the cloud
trial reaches account access or repository connection that only you can provide,
I will bring you the exact setup action. Before unattended pickup is enabled,
we will need your choice of allowed work and whether agents stop at a PR or
may merge. My recommendation for the pilot is to stop at a PR.

## What this adds

- [Verify Lahe](../../skills/verify-lahe/SKILL.md): exact setup, isolation,
  readiness checks, user-path proof, evidence and cleanup.
- [Feature map](../../skills/verify-lahe/features/README.md): routes from a
  user action to existing browser journeys and observable outcomes.
- [Maintenance skill](../../skills/maintain-verification-skill/SKILL.md):
  compare source and live behavior, repair drift, and distinguish product bugs.
- Project-local discovery links for Claude Code and Codex point to the same
  canonical files under skills. No separate installed copies to drift.

## Verification record

The generated bundle matches source. The Markdown placement journey passed in
Chromium, including source placement, automatic page rebuild, handled state and
reload. Its trace survives teardown at:

`/tmp/lahe-verification-seed-proof/free_writing_seams-free-wr-ec216--tags-and-bold-not-reopened-chromium/trace.zip`

The exact command is in [Verify Lahe](../../skills/verify-lahe/SKILL.md). Product
code was unchanged from `6cedb552`. This was a local macOS run with an already
installed browser, not a clean Linux cloud runner. Fresh-runner browser and
system-package installation remain unverified. Dependency installation with
`npm ci` succeeded in the worktree.

The readiness recipe was exercised separately against a fresh CLI-created
review. Its first attempts caught incorrect assumptions about the empty review
file and health route; both were corrected and the recipe passed. The screenshot
below survives closing its browser and helper.

![An isolated Markdown review with the Lahe rail ready](verification-proof/ready.png)

Both skills pass the skill validator. Local document links, named specs and
Claude/Codex discovery links resolve. Under Node 20.19.0, `npm run gate:unit`
passed: 3042 passed, no failures, 5 skipped and 2 todo. The helper leak guard
passed. Results are in `/tmp/lahe-verification-unit-node20.log`.
An earlier attempt used a different Node through npm and failed before executing
the suite; its log remains at `/tmp/lahe-verification-unit.log`.

Only the Markdown placement journey and readiness recipe were driven for this
generation proof. Other mapped paths remain source-grounded recipes, not passed
coverage. Full browser gates were not run for this documentation change.

The files are on `docs/verification-skill` in the isolated verification-skill
worktree, not on main. This branch is ready for review; cloud scheduling remains
follow-up work.

## Cloud readiness

The browser harness already starts disposable reviews and checks process
cleanup. [The runner contract](../../skills/verify-lahe/references/cloud.md)
spells out setup and evidence retention. The local seed proves its user path,
not that Claude Code cloud has the required browser dependencies or host queue.

GitHub CI currently runs lint, the bundle check and unit tests. Its browser
suite remains local by project policy. The Mac menu bar needs a Mac; actual
agent wakes need the intended host. Both remain separate from browser proof.

The follow-ups above are recorded on [the bulletin board](../BULLETIN.md).

## Source

This follows Lauren Tan's upstream pstack
[create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md)
and [maintain-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md).
The [linked X article](https://x.com/poteto/article/2094457600259842065?lang=en)
was inaccessible directly, so the implementation uses the upstream skills.
