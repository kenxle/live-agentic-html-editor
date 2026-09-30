# Free writing: cleanup decisions

Free writing is merged and live. These are the last decisions before the feature closes. Each has a default. Comment "yes" to take a default, or say what you want instead.

## 1. Changes to the repo's CLAUDE.md

Three rules this feature ran into. None is added until you say yes.

- **Tests never reach your real helper.** Two browser tests with no helper running reached your installed helper on port 7817. They failed only because it ran an older version. Proposed line under "Running the gate": a test that needs "no helper" refuses connections to 7817, and every test helper runs on its own port and state folder. Default: yes.
- **The no-deletion rule, spelled out for builders.** Builders ran `rm` twice despite a one-line reminder, which blocked you. Proposed addition to "Never remove files while work is running": the rule covers temp specs, probes, screenshots, test-results folders, and `.bak` files that `sed -i` leaves; restore the bundle with `git checkout -- dist/lahe-layer.js`; builder prompts state the rule at the top. Default: yes.
- **A guardrails file so the ship skill can run here.** `st-ship` stopped because this repo has no `.claude/guardrails.md`, so I opened the PR by hand. Proposed: add that file, naming the base branch (`main`), the check (`npm run gate:all`), and the PR conventions from CLAUDE.md. Default: yes.

## 2. Deletions, one batch

Nothing below is removed until you say yes. Everything is merged into main or is scratch.

- **21 builder worktrees** under `.claude/worktrees/`: `free-writing`, `free-writing-2a` to `-2c`, `-f1` to `-f7`, `-fix`, `-g1`, `-g2`, `-h1` to `-h4`, `-rail`, `-seams`. Their local branches go too. Each branch is merged into main. The few with uncommitted files hold only scratch probes and locally rebuilt bundles the builders listed.
- **`fw-baseline`**: a checkout of main at 97a8270, used once to compare test results.
- **`fw-docs`**: the docs-pass worktree, once its commit is on main.
- **The remote branch `feat/free-writing`.** CLAUDE.md says to delete it once the PR closes.
- **The preview.** Stop its helper on port 7991, close its session, and delete the preview folder, which holds the copy of your draft, the notes page, and the two preview review logs. Default: stop and close. Keep the folder, since your notes page lives there.

Not touched: `test/browser/tmp_image_pick.spec.js` in the main checkout. It is not from this feature.

## 3. Lessons waiting for review

Five lessons are in `docs/lessons/proposed/` from earlier work. Default: I serve them on a page for you another time, since this close-out is long enough.

## 4. The draft's name in git history

The progress page named your blog draft for a few hours. The name is gone from the current files, but it is in two commits' history in this public repo. Removing it means rewriting main's history. Default: leave it. It is a file name, not the draft's text.
