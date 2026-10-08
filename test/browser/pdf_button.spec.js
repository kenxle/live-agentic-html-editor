// The PDF button in the rail's head (docs/features/20261008.01_pdf_button).
//
// It does not make a PDF. It opens a small tray with one item, "Save as PDF",
// and choosing that sends the agent the note "Make a PDF of this page." at
// once, the note a reviewer would type themselves. The note box at the foot of
// the rail is left alone.
//
// Every click here is a real mouse click at the control's on-screen geometry,
// read from the rail's own self-report because its root is closed.

"use strict";

const { test, expect, pollPage, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "pdf-button-review";
const REQUEST = "Make a PDF of this page.";

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

function pdfInfo(page) {
  return page.evaluate(() => window.__lahe.rail.pdfInfo());
}

async function clickPdf(page) {
  const info = await pdfInfo(page);
  expect(info.present, "the rail's head carries the PDF button").toBe(true);
  await page.mouse.click(info.rect.x + info.rect.width / 2, info.rect.y + info.rect.height / 2);
}

async function chooseSaveAsPdf(page) {
  const info = await pdfInfo(page);
  const item = info.items.filter((one) => one.label === "Save as PDF")[0];
  expect(item, "the open tray holds Save as PDF").toBeTruthy();
  await page.mouse.click(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
}

function pdfNotes(page) {
  return page.evaluate((words) => window.__lahe.items().filter((one) => one.note === words), REQUEST);
}

test.describe("the PDF button", () => {
  let app;
  let helper;

  test.beforeAll(async () => {
    app = await startAppServer();
    helper = await startService({
      entry: SERVICE_ENTRY,
      args: ["--port", "0"],
      reviews: [REVIEW],
      allowedOrigins: [app.origin]
    });
    app.useLayer({ review: REVIEW, token: helper.tokenFor(REVIEW), helper: helper.url });
  });

  test.afterAll(async () => {
    if (helper) await helper.stop();
    if (app) await app.close();
  });

  test("opens a tray, and Save as PDF sends one ready note at once", async ({ page }) => {
    await page.goto(app.urlFor("/?morph=off"));
    await booted(page);
    const sentBefore = (await pdfNotes(page)).length;

    const info = await pdfInfo(page);
    expect(info.label).toBe("Ask the agent for a PDF");
    expect(info.title).toBe("Ask the agent for a PDF");
    expect(info.disabled).toBe(false);
    expect(info.open).toBe(false);

    await clickPdf(page);
    const opened = await pdfInfo(page);
    expect(opened.open, "a click opens the tray").toBe(true);
    expect(opened.expanded).toBe("true");
    expect(opened.items.map((one) => one.label)).toEqual(["Save as PDF"]);

    await chooseSaveAsPdf(page);
    expect((await pdfInfo(page)).open, "choosing closes the tray").toBe(false);
    await pollPage(page, (words) => window.__lahe.items().filter((one) => one.note === words).length > 0, REQUEST, {
      message: "the PDF note to be sent"
    });
    const sent = await pdfNotes(page);
    expect(sent.length, "exactly one note").toBe(sentBefore + 1);
    expect(sent[sent.length - 1].state, "ready, on the agent's desk").toBe("ready");
    expect(sent[sent.length - 1].kind).toBe("note");
  });

  test("closes on Esc and on a click outside", async ({ page }) => {
    await page.goto(app.urlFor("/?morph=off"));
    await booted(page);

    await clickPdf(page);
    expect((await pdfInfo(page)).open).toBe(true);
    await page.keyboard.press("Escape");
    expect((await pdfInfo(page)).open, "Esc closes it").toBe(false);

    await clickPdf(page);
    expect((await pdfInfo(page)).open).toBe(true);
    await page.mouse.click(20, 200);
    expect((await pdfInfo(page)).open, "a click on the page closes it").toBe(false);
  });

  test("leaves words in the note box alone", async ({ page }) => {
    await page.goto(app.urlFor("/?morph=off"));
    await booted(page);
    await page.evaluate(() => window.__lahe.handle.tab().focusNote());
    await page.keyboard.type("Looks good.");

    await clickPdf(page);
    await chooseSaveAsPdf(page);
    await pollPage(page, (words) => window.__lahe.items().some((one) => one.note === words && one.state === "ready"), REQUEST, {
      message: "the PDF note to be sent"
    });
    const box = await page.evaluate(() => {
      const handle = window.__lahe.handle.tab().noteBox();
      return { text: handle.input.value, state: handle.item.state };
    });
    expect(box.text, "the reviewer's words are still in the box").toBe("Looks good.");
    expect(box.state, "and still unsent").toBe("draft");
  });

  test("is off in a window that cannot write to the review", async ({ page, browser }) => {
    await page.goto(app.urlFor("/?morph=off"));
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
      message: "the first window to hold the review"
    });

    // A second browser context shares no storage, so it asks as a stranger
    // while the first window still holds the review, and is refused.
    const stranger = await browser.newContext();
    try {
      const second = await stranger.newPage();
      await second.goto(app.urlFor("/?morph=off"));
      await booted(second);
      await pollPage(second, () => window.__lahe.handle.sync.status().readOnly === true, undefined, {
        message: "the second window to go read-only"
      });
      expect((await pdfInfo(second)).disabled).toBe(true);
      await clickPdf(second);
      expect((await pdfInfo(second)).open, "a disabled button opens nothing").toBe(false);

      // The window that holds the review still has it on.
      expect((await pdfInfo(page)).disabled).toBe(false);
    } finally {
      await stranger.close();
    }
  });
});
