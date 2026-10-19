---
title: npm run lint checks .js files only, so the Lua filter and every other non-JS file get no lint coverage
category: testing
symptoms: [lint passed but the lua filter is broken, npm run lint passes with a syntax error in lahe_render.lua, no lint for lua, lint does not check python or css, new non-js file not in manifest, lint passed 538 files, filter fails only when pandoc runs]
applies_to: [scripts/lint.js, src/shared/manifest.js, src/service/lahe_render.lua, scripts/*.py]
first_seen: 2026-10-19
confirmed: 2026-10-19
status: live
---

## What happens

`npm run lint` passes while a file it never looked at is broken. The new Lua filter `src/service/lahe_render.lua` is the case that showed it. The lint output counts only JavaScript:

```
lint passed (syntax: 538 files, no jsdom, manifest complete)
```

A syntax error in a `.lua`, `.py` or `.css` file does not change that line.

## Why

All three checks in `scripts/lint.js` are built on `isJs`, a filter that keeps names ending in `.js`:

- The syntax check runs `node --check` on each tracked `.js` file. There is no check for any other language.
- The jsdom check reads `package.json` and the `.js` files under `test/`.
- The manifest check compares the lists in `src/shared/manifest.js` with the `.js` files under `src/`. A `.lua` file under `src/` is never required to be listed. The entry for `src/service/pandoc.js` says so: "the manifest lists .js only".

So a Lua error shows up only when pandoc runs the filter. The unit tests that do that, in `test/unit/pandoc_render.test.js`, skip when pandoc is missing, and CI has no pandoc on purpose (`docs/ongoing/TESTING.md`). A Lua mistake can reach a pull request with a green lint and a green CI run.

## What to do instead

Treat a green lint as saying nothing about files that are not `.js`. For the Lua filter, run the pandoc tests on a machine that has pandoc before shipping. `npm run test:unit` and `npm run gate` both include them when pandoc is installed, and you can run them alone:

```
LAHE_DIRECT_LAUNCH=off node --test test/unit/pandoc_render.test.js
```

Check the summary line for `# skipped 0`. A skipped count above zero means pandoc was not found and the filter was not run.

If a check for non-JS files is wanted, add it to `scripts/lint.js` as its own named check. Do not read the file count in the lint output as covering the whole tree.
