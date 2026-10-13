// Playwright config for the rail mockup capture only. Not part of any gate.
const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /rail_capture\.spec\.js/,
  workers: 1,
  reporter: "line",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
