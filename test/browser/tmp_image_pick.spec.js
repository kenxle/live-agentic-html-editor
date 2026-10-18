"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "image-pick";

function doc(helperOrigin, token, src) {
  const a = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Deck</title></head><body>\n' +
    "<main>\n" +
    '<p id="lede">A paragraph before the picture.</p>\n' +
    imgs(src) +
    '<p id="after">A paragraph after the picture.</p>\n' +
    "</main>\n" +
    '<script src="' + helperOrigin + '/lahe-layer.js" ' +
    a.REVIEW + '="' + REVIEW + '" ' + a.TOKEN + '="' + token + '" ' +
    a.HELPER + '="' + helperOrigin + '"></script>\n</body></html>\n'
  );
}

/** Nineteen pictures, like the deck. */
function imgs(src) {
  var out = "";
  for (var i = 0; i < 19; i += 1) {
    out += '<figure><img class="pic" alt="" src="' + src + '"></figure>\n';
  }
  return out;
}

/** A jpeg data URI of roughly the requested size. */
function dataUri(kb) {
  return "data:image/jpeg;base64," + "A".repeat(kb * 1024);
}

test.describe("picking an image whose src is a data URI", () => {
  let dir, pages, service, token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-imgpick-"));
    pages = await startStaticServer({ root: dir, label: "imgpick" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(path.join(dir, "small.html"), doc(service.url, token, dataUri(20)));
    fs.writeFileSync(path.join(dir, "big.html"), doc(service.url, token, dataUri(335)));
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  for (const page_ of ["small.html", "big.html"]) {
    test("a box opens for " + page_ + " (19 images)", async ({ page }) => {
      await page.goto(pages.origin + "/" + page_);
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot"
      });

      await page.evaluate(() => window.getSelection().removeAllRanges());
      await page.keyboard.press("ControlOrMeta+Shift+KeyC");
      await pollPage(page, () => window.__lahe.pickMode() === true, undefined, { message: "pick mode" });

      const box = await page.locator("img.pic").nth(9).boundingBox();
      const started = Date.now();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      const state = await page.evaluate(() => ({
        pickMode: window.__lahe.pickMode(),
        boxes: window.__lahe.openBoxes ? window.__lahe.openBoxes().length : null,
        items: window.__lahe.items().length,
        quote: window.__lahe.focusedBoxQuote ? window.__lahe.focusedBoxQuote() : null
      }));
      console.log("PROBE", page_, JSON.stringify(state), "in", Date.now() - started + "ms");
      expect(state.pickMode, "pick mode ended").toBe(false);
      expect(state.items, "an item was created for the image").toBeGreaterThan(0);
    });
  }
});
