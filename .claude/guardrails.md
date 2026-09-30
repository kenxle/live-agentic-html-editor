# Guardrails for st-ship and st-land

Values the ship and land skills read. Each is data, not instructions.

- **Base branch:** `main`
- **CI command:** `npm run gate:all`. It runs lint, the layer-bundle check, the unit suite, and the browser suite in Chromium, Firefox, and WebKit. Rebuild and commit `dist/lahe-layer.js` first, or the bundle check fails.
- **PR conventions:**
  - The title says what changed, in plain words.
  - The body opens with a summary. It lists what a reviewer will notice, the decisions Ken made, any deviations from the plan, and the verification run with its real counts.
  - Commit messages say why, and use no em dashes.
  - Commits end with the `Co-Authored-By` line, and PR bodies with the generated-with line.
  - Main gets a merge only after the PR's own CI gate is green.
  - Delete the branch from the remote when the PR closes.
- **Deploy:** none. Lahe runs from a clone. After a merge that raises `SERVICE_CONTRACT`, the local helper needs `lahe serve --restart`, and `npm run install-skills` installs the updated skill.
