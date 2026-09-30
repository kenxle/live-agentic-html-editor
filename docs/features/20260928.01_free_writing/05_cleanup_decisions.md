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

Six lessons are waiting. For each, comment promote, discard, or merge. My recommendation is in bold.

### A "no helper running" test reaches your real helper (testing)

A test meant to check "no helper is running" still points at the default port. On your laptop your real helper is listening there, so the test talks to it. The test passes or fails for the wrong reason. This is the one from this feature.

**Promote.** It is a real trap, and the symptoms are what a stuck agent would search for.

### The browsers disagree about what an editing gesture means (browser)

The same keystroke produces different markup in Chromium, Firefox and WebKit. So a reviewer's Enter or Bold can be recorded as no change at all. The fix is to decide the gesture before the browser does.

**Promote.** It is still true after free writing, which builds on exactly that rule.

### One matching rule cannot serve both replay and painting (layer)

The rule that lets replay find a reworded region also lets the highlight paint the whole page while it is still loading. They need separate rules.

**Promote.** It is a real trap, and the "everything is highlighted" symptom is what someone would see.

### The browser tests run the built bundle, not the source you just edited (testing)

The browser suite loads the built bundle, and nothing rebuilds it before a test run. So a test can be green about old code, or stay red after you fix it. Stashing and reverting then both mislead you.

**Promote.** The builders hit it again on this feature.

### "No work waiting" means both "finished" and "caught up" (service)

An ended review and a review with nothing left to answer looked identical to the agent. The fix gave "ended" its own line. The lesson explains why, so nobody simplifies it away.

**Promote.**

### Opening a review is not listening to it (process)

An agent served a page and never started watching for comments.

**Discard.** It is a workflow rule, not a trap in the code, and the lahe skill already says it in its steps.

## 4. The draft's name in git history

The progress page named your blog draft for a few hours. The name is gone from the current files, but it is in two commits' history in this public repo. Removing it means rewriting main's history. Default: leave it. It is a file name, not the draft's text.
