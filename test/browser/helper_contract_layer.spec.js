// The layer half of the helper version check (testing review I7; architecture,
// "Rollout and old agents"; fix round design call 9).
//
// An old helper stores run records with no allowlist and never projects
// new_blocks, so a new layer must refuse to send it runs: it reads
// service_contract from the helper's health answer and goes read-only, with the
// failure shown. The CLI half is test/unit/helper_contract_cli.test.js.
//
// WAITING ON F3 (fix round design call 9, CR 4, CL 24): the layer makes no
// contract check yet (src/layer/sync.js and index.js are F3's). Until it does,
// this test fails for the right reason: the page stays writable. Written as
// SERVICE_CONTRACT - 1 so it still tests the bump at 15.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");
const refusingHelper = require("./support/refusing_helper");
const protocol = require("../../src/shared/protocol.js");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-contract" });
});

test.afterAll(async () => {
  await server.close();
});

test.fixme("a layer on this contract goes read-only against a helper one contract behind, and takes no edits", async ({ page }) => {
  await refusingHelper.install(page, "http://127.0.0.1:1", { contract: protocol.SERVICE_CONTRACT - 1 });
  await fw.openFixture(page, server, "blog.html");
  await pollPage(page, () => window.__lahe.handle.sync.status().readOnly === true, undefined, {
    message: "the layer to refuse the older helper"
  });
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await fw.caretAt(page, "#p1", 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  expect(await page.evaluate(() => window.__lahe.isEditing()), "no edit session opens against an older helper").toBe(false);
});

test("a layer on this contract stays writable against a helper on the same contract", async ({ page }) => {
  await refusingHelper.install(page, "http://127.0.0.1:1", { contract: protocol.SERVICE_CONTRACT });
  await fw.openFixture(page, server, "blog.html");
  expect(await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)).toBe(false);
  await fw.openEdit(page, "#p1");
  expect(await page.evaluate(() => window.__lahe.isEditing())).toBe(true);
});
