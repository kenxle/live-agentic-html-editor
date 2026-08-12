// Living in the page: the page keeps working, and the layer survives the page.
//
// Owner: 2D. Ranked test 4, both halves, on 0C's app fixture:
//
//   "The page's own controls keep working. On 0C's app fixture: a plain click
//    on a link navigates, on a button fires the page's handler, and a form
//    submits, all with the library loaded and with a comment and an edit
//    already outstanding. One hundred morphs later the listener registry count
//    is unchanged, there is one overlay root, and one gesture still makes
//    exactly one item. The registry count is the library's own self-report, so
//    THE GESTURE HALF IS THE LOAD-BEARING ASSERTION; keep both and do not drop
//    it as redundant."
//
// Why the gesture half is load-bearing, stated here so nobody deletes it as
// slow: the registry count is a number the library prints about itself. An
// implementation that leaks a handler OUTSIDE the registry (a raw
// addEventListener in a remount path) reports a flat count while one
// Cmd-Shift-C produces four comments. Only the gesture catches that, and the
// leak it catches is the exact shipped symptom this project exists to remove.
//
// The morphs are the fixture's OWN poll-and-morph engine, in its raw flavor
// (no hook, every node under the target destroyed). The fixture fires no
// turbo:morph of its own, so the spec dispatches one after each pass: that
// stands in for the framework, and the harness README names it as the gap 2D
// fills. Every tenth pass also deletes the overlay root outright, which is the
// case the remount contract exists for.
//
// The edit record comes from 0A-kernel's record fixture generator, not from
// 2A: 2A (editing) has not merged at the time this was written, and the plan
// says exactly this ("an edit record can come from record_fixtures until 2A
// merges"). When 2A lands, the outstanding edit here can become a real one.

"use strict";

const { test: base, expect, pollPage } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const { withLayer } = require("./support/with_layer");

const REVIEW = "living-review";
const TOKEN = "living-token";

const test = base.extend({
  appServer: async function ({}, use) {
    const server = await startAppServer();
    await use(server);
    await server.close();
  },
  // A loopback origin with nothing on it: the helper is down, which is the
  // ordinary dev case and is NOT what any assertion here is about.
  helperOrigin: async function ({}, use) {
    await use("http://127.0.0.1:1");
  }
});

async function bootedOn(page, appServer, helperOrigin, pathname) {
  await withLayer(page, { review: REVIEW, token: TOKEN, helper: helperOrigin });
  await page.goto(appServer.urlFor(pathname));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/** The reviewer's own gesture: select a passage, Cmd-Shift-C, type, Cmd-Enter. */
async function commentOnSelection(page, selector, text) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("nothing matched " + sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** An outstanding edit, minted by the kernel's fixture generator. */
async function outstandingEdit(page) {
  return page.evaluate(function () {
    const fixtures = window.LAHE.record_fixtures.createFixtures({ page: window.__lahe.page() });
    const item = fixtures.edit({});
    window.__lahe.store().write(window.__lahe.review, item);
    window.__lahe.merge();
    return item;
  });
}

test.describe("ranked test 4: the page's own controls keep working", () => {
  test("a link navigates, a button fires the page's handler, and a form submits", async ({
    page,
    appServer,
    helperOrigin
  }) => {
    await bootedOn(page, appServer, helperOrigin, "/?morph=raw&poll=60");

    // Both kinds of outstanding work, before a single control is touched.
    await commentOnSelection(page, ".lede", "This lede promises nine and shows four.");
    const edit = await outstandingEdit(page);
    const outstanding = await page.evaluate(() => window.__lahe.items().length);
    expect(outstanding).toBe(2);

    // The page's own click handler. Not intercepted, not swallowed.
    await page.locator("#log-session").click();
    await page.locator("#log-session").click();
    expect(await page.evaluate(() => window.__app.counters.sessionClicks)).toBe(2);
    await expect(page.locator("#session-count")).toHaveText("2");

    // A plain click on a link navigates.
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.locator("h1")).toHaveText("Clients");
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after a full navigation"
    });

    // The reviewer's work is still theirs after the navigation: browser storage
    // is the durable half, and the record survived the page it was made on.
    const afterNav = await page.evaluate(() => window.__lahe.items().map((i) => i.id));
    expect(afterNav).toContain(edit.id);
    expect(afterNav.length).toBe(2);

    // The form submits, round trip and all.
    await page.locator("#note-client").selectOption({ index: 0 });
    await page.locator("#note-body").fill("Ask about the knee before Thursday.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.locator("#saved-notes")).toContainText("Ask about the knee before Thursday.");
  });

  test("one hundred morphs: registry flat, one overlay root, one gesture one item", async ({
    page,
    appServer,
    helperOrigin
  }) => {
    await bootedOn(page, appServer, helperOrigin, "/?morph=raw&poll=60");

    // The comment that has to survive all of it, made before the morphs start.
    await commentOnSelection(page, ".lede", "Nine clients, four cards.");
    expect(await page.evaluate(() => window.__lahe.items().length)).toBe(1);

    const before = await page.evaluate(() => ({
      listeners: window.__lahe.listenerCount(),
      groups: window.__lahe.listenerGroups(),
      remounts: window.__lahe.counters.remounts
    }));

    const walked = await page.evaluate(async function () {
      window.__app.morph.stop();
      let rootsDeleted = 0;
      // The fixture refuses a poll while one of its own is still in flight, so
      // "call pollNow a hundred times" is not a hundred morphs. Each pass waits
      // for the fixture's own counter to move, which is what makes this a
      // hundred morphs on a loaded machine as well as an idle one.
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      for (let i = 0; i < 100; i += 1) {
        const target = window.__app.counters.morphPasses + 1;
        while (window.__app.counters.morphPasses < target) {
          await window.__app.morph.pollNow();
          if (window.__app.counters.morphPasses < target) await frame();
        }
        // Every tenth morph takes the overlay root with it. The root is not in
        // the server's HTML, so this is what a wholesale replacement does.
        if (i % 10 === 9) {
          const host = document.getElementById(window.__lahe.rootId);
          if (host) {
            host.remove();
            rootsDeleted += 1;
          }
        }
        // The framework's own signal. The fixture fires none, so the spec is
        // the framework here.
        document.dispatchEvent(new CustomEvent("turbo:morph", { bubbles: true }));
      }
      return { rootsDeleted: rootsDeleted, morphPasses: window.__app.counters.morphPasses };
    });
    expect(walked.rootsDeleted).toBe(10);
    expect(walked.morphPasses).toBeGreaterThanOrEqual(100);

    const after = await page.evaluate(() => ({
      listeners: window.__lahe.listenerCount(),
      groups: window.__lahe.listenerGroups(),
      remounts: window.__lahe.counters.remounts,
      rootsRecreated: window.__lahe.counters.rootsRecreated,
      hosts: document.querySelectorAll("#" + window.__lahe.rootId).length
    }));

    // The remounts really ran. Without this the whole test passes on a library
    // that registered nothing and re-registered nothing.
    expect(after.remounts - before.remounts).toBeGreaterThanOrEqual(100);
    expect(after.rootsRecreated).toBeGreaterThanOrEqual(10);

    // Half one: the library's own self-report.
    expect(after.listeners).toBe(before.listeners);
    expect(after.groups).toEqual(before.groups);

    // One overlay root, not eleven.
    expect(after.hosts).toBe(1);

    // Half two, the load-bearing one: one gesture, one item.
    await commentOnSelection(page, "#log-session", "This button needs a label a person can read.");
    await pollPage(page, () => window.__lahe.items().length === 2, undefined, {
      message: "the second comment, and only the second comment"
    });
    expect(await page.evaluate(() => window.__lahe.items().length)).toBe(2);
  });

  test("the mutation fallback re-creates the root with no framework event at all", async ({
    page,
    appServer,
    helperOrigin
  }) => {
    await bootedOn(page, appServer, helperOrigin, "/clients?morph=raw&poll=60");

    const before = await page.evaluate(() => ({
      remounts: window.__lahe.counters.remounts,
      listeners: window.__lahe.listenerCount()
    }));

    // No turbo:morph, no popstate, no load. Just the root, gone.
    await page.evaluate(() => document.getElementById(window.__lahe.rootId).remove());

    await pollPage(
      page,
      () => document.querySelectorAll("#" + window.__lahe.rootId).length === 1,
      undefined,
      { message: "the mutation-observer fallback to put the root back" }
    );

    const after = await page.evaluate(() => ({
      remounts: window.__lahe.counters.remounts,
      mutationFallbacks: window.__lahe.counters.mutationFallbacks,
      listeners: window.__lahe.listenerCount()
    }));
    expect(after.mutationFallbacks).toBeGreaterThanOrEqual(1);
    expect(after.remounts).toBeGreaterThan(before.remounts);
    expect(after.listeners).toBe(before.listeners);
  });

  test("browse mode is the page untouched: nothing is contentEditable and keys pass through", async ({
    page,
    appServer,
    helperOrigin
  }) => {
    await bootedOn(page, appServer, helperOrigin, "/clients?morph=raw&poll=60");

    // R13. No contentEditable anywhere in the reviewed document.
    const editable = await page.evaluate(function () {
      return document.querySelectorAll("[contenteditable]").length;
    });
    expect(editable).toBe(0);

    // An ordinary key reaches the page's own field, which is what "no captured
    // keys beyond the library's own shortcuts" means from the page's side.
    await page.locator("#note-body").click();
    await page.keyboard.type("plain typing");
    expect(await page.locator("#note-body").inputValue()).toBe("plain typing");
    expect(await page.evaluate(() => window.__lahe.items().length)).toBe(0);
  });
});
