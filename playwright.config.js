// Playwright config.
//
// THREE LANES, ONE DEFAULT. The architecture's D1 makes cross-platform a product
// claim (R42), so Firefox and WebKit are real projects here and the orchestrator
// runs all three at every checkpoint through `npm run gate:all`.
//
// The DEFAULT `playwright test` run stays Chromium only. Adding projects without
// that narrowing would silently triple every builder's inner loop, which is how
// a cross-browser lane ends up deleted rather than fixed. A builder runs
// `npm run gate:builder` (Chromium); the lanes are a checkpoint gate.
//
//   npx playwright test                     Chromium only
//   npx playwright test --project=webkit    one named lane, for debugging it
//   npm run test:browser:all                all three
//
// Firefox and WebKit need their own download once:
//   npx playwright install firefox webkit

// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const DEFAULT_PROJECT = "chromium";

const ALL_PROJECTS = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] },
  },
  {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
  },
];

// Playwright has no "default project" setting, so the narrowing is done here.
// Two ways to opt out of it, and both are deliberate:
//
//   LAHE_ALL_BROWSERS=1     what npm run test:browser:all sets
//   --project=<name>        a builder debugging one lane by hand
//
// Without either, a bare `playwright test` is Chromium and nothing else.
const askedForAll = !!process.env.LAHE_ALL_BROWSERS;
const askedForProject = process.argv.some(function (arg) {
  return arg === "--project" || arg.indexOf("--project=") === 0;
});
const projects =
  askedForAll || askedForProject
    ? ALL_PROJECTS
    : ALL_PROJECTS.filter(function (project) {
        return project.name === DEFAULT_PROJECT;
      });

module.exports = defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: projects,
});
