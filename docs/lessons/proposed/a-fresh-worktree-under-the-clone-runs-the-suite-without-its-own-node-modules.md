---
title: A fresh worktree under the clone runs the browser suite without its own node_modules, and one test notices
category: testing
symptoms: ["npm install has been run", "install_walk_3b", "expected true received false node_modules", "gate fails in a new worktree", "1 failed 878 passed"]
applies_to: ["test/browser/install_walk_3b.spec.js", ".claude/worktrees/**"]
first_seen: 2026-10-12
confirmed: 2026-10-12
status: live
---

## What happens

`npm run gate` in a worktree made with `git worktree add` under `.claude/worktrees/`
runs lint, the bundle check, the unit suite and the whole Chromium suite as if the
worktree were installed. Every spec passes except one:

```
✘ test/browser/install_walk_3b.spec.js:131:3 › AC6: the install is one documented command path › npm link once, then `lahe add`, and the page is ready to review

Error: npm install has been run
Expected: true
Received: false
  > 134 | expect(fs.existsSync(path.join(REPO_ROOT, "node_modules")), "npm install has been run").toBe(true);
```

The worktree has no `node_modules` folder at all, yet Playwright ran.

## Why

Node resolves modules by walking up parent directories. A worktree at
`<clone>/.claude/worktrees/<name>` sits under the clone, so `npx playwright` and
every `require` find `<clone>/node_modules` and the suite runs on the parent's
devDependencies. That spec is the one place that checks the repo root itself:
`REPO_ROOT` is `path.join(__dirname, "..", "..")` (line 37), the worktree, and
line 134 asserts `node_modules` exists there because the install walk it proves
starts with `npm install`. A worktree outside the clone (for example
`~/Documents/workspace/lahe-worktrees/<name>`) fails earlier and more plainly:
`npx playwright` finds nothing.

## What to do instead

Run `npm install` in the worktree before its first `npm run gate`. It only adds the
devDependencies (four packages, under a second) because `dependencies` is empty by
rule. Then put the lockfile back, since the install rewrites it:

```sh
npm install --no-audit --no-fund
git checkout -- package-lock.json
npm run gate
```

A gate that fails only on this spec in a fresh worktree is the missing install, not
the change under test. Rerun that one spec alone after installing:

```sh
npx playwright test test/browser/install_walk_3b.spec.js
```
