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
// The argv sniff only works in the MAIN process. Playwright spawns each worker
// with its own argv, which does not carry `--project`, so a worker re-evaluating
// this file saw the Chromium-only list and answered
// `Project "firefox" not found in the worker process` before the test body ran.
// The lane looked broken and the failure named the harness rather than a claim.
// Environment DOES reach a worker, so the main process records its decision
// there and both sides read the same list.
const askedForProject = process.argv.some(function (arg) {
  return arg === "--project" || arg.indexOf("--project=") === 0;
});
if (askedForProject) process.env.LAHE_ALL_BROWSERS = "1";
const askedForAll = !!process.env.LAHE_ALL_BROWSERS;
const projects =
  askedForAll
    ? ALL_PROJECTS
    : ALL_PROJECTS.filter(function (project) {
        return project.name === DEFAULT_PROJECT;
      });

module.exports = defineConfig({
  testDir: "./test/browser",
  // Ninety seconds, not Playwright's thirty.
  //
  // A worker here is not one browser page. Each one starts a real Node helper
  // process, a fixture HTTP server, and a Chromium, and the heavy walks
  // (ac1..ac4, cp1, cp2) then spend their time on things that cost wall clock
  // and cannot be hurried: 250ms morph polls, a kill -9 and a restart, a
  // reload, a hundred repaints. ac1 alone takes about twelve seconds on an idle
  // machine, so at the default worker count (half the cores, each running that
  // whole stack) the walks were crossing thirty seconds and failing on the
  // clock rather than on a claim. Verified against the pre-wave commit f078db0,
  // which failed the same specs the same way on a loaded machine: the timeout
  // was always this thin, and a quiet machine was hiding it.
  //
  // This is headroom, not a loosened assertion. Every wait inside a test is
  // still a condition poll with its own shorter timeout (test/helpers/poll.js),
  // so a genuinely stuck condition still fails fast and says what it wanted.
  //
  // Ninety rather than sixty for one waiting-on-the-product case: the sync
  // client's retry backoff caps at thirty seconds (sync.BACKOFF_MS), so the AC1
  // walk, which starts its helper after a long stretch of failed polls, can
  // legitimately spend most of a minute inside one wait.
  timeout: 90000,
  fullyParallel: true,
  // Four workers, not "half the cores".
  //
  // Playwright's default assumes a worker is a browser page. Here a worker is a
  // Chromium, a Node helper process, and a fixture HTTP server, and several of
  // the specs drive a page that re-renders itself every 60 to 250 milliseconds
  // for the length of the test. Six of those at once saturated a twelve-core
  // machine (load average over 100 during a run), and the symptom was not a
  // slow suite but a wrong one: a click that never satisfied Playwright's
  // stability check because the morph kept moving the element, and walks that
  // ran out of clock mid-journey. Capping the workers is the fix for that, and
  // it costs about a minute of wall time.
  //
  // LAHE_WORKERS overrides it, for a machine with room to spare.
  workers: process.env.LAHE_WORKERS ? Number(process.env.LAHE_WORKERS) : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: projects,
});
