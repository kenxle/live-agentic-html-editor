// AC2, Ken's dev-server story, as a script. Ranked test 39, second of three.
//
// The criterion, word for word:
//
//   "The evaluator adds the library to a multi-page morphing app's development
//    layout, logs in, walks three screens, comments on two of them, types a fix
//    on the third while the page polls and morphs underneath them, and drives
//    the app for real in between by clicking a button that navigates. All of it
//    lands in one review naming all three pages. The walk is run twice, once
//    with the script line commented out, recording what each click did both
//    times, because 'any click behaves differently' is otherwise a comparison
//    against a page the evaluator never saw. Fails if: any recorded click
//    differs between the two runs, the app stops responding, an open edit is
//    lost on navigation, or a morph loses the caret."
//
// Open question 3 is answered the way the plan records it: this runs against
// 0C's app fixture. Ken's own Rails dev server is the truer test and is his to
// run at the live review.
//
// THE TWO RUNS. Run one is the reviewed application: the fixture's layout
// carries the one script line. Run two is the same application with that line
// gone, which is what "commented out" means to a browser: the fixture emits the
// tag only when it is started with a layer, so the no-layer flavor IS the
// commented-out line, byte for byte the same document otherwise.
//
// WHAT A RECORDED CLICK IS. For each of the eight clicks: where the browser was,
// where it ended up, and everything about the application's own state a person
// could see afterwards. The feed's rotating text is deliberately NOT in it: it
// advances on a server-side cursor and differs between two runs of the same
// application with or without any library, so including it would fail the
// comparison for a reason that has nothing to do with the tool.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  captureCaret,
  compareCaret,
  caretProblems,
  startService,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer, ACCOUNT } = require("../fixtures/app/server");

const REVIEW = "ac2-dev-server";
const EPHEMERAL_PORT = ["--port", "0"];

// The knobs both runs carry, so the two documents differ in the script line and
// in nothing else.
const QUERY = "?morph=hooked&poll=250";

const SAID = {
  dashboard: "This lede promises nine clients and then names three. Say nine or name nine.",
  clients: "The roster heading says Clients and the page shows four of nine. Say which four.",
  fix: " Reply to nobody before you have read the whole feed."
};

const NOTE_BODY = "Bring the 6am slot up with Devon on Thursday.";

// --- what a click did --------------------------------------------------------

function locationOf(page) {
  return page.evaluate(() => window.location.pathname + window.location.search);
}

/** Everything about the application's own state a person could see. */
function appState(page) {
  return page.evaluate(function () {
    function text(selector) {
      const el = document.querySelector(selector);
      return el ? el.textContent : null;
    }
    return {
      path: window.location.pathname,
      search: window.location.search,
      title: document.title,
      navCurrent: text("nav.app-nav li.current a"),
      signedInAs: text("#signed-in-as"),
      sessionCount: text("#session-count"),
      loginError: text("#login-error"),
      savedNotes: Array.prototype.slice
        .call(document.querySelectorAll("#saved-notes li"))
        .map(function (li) {
          return li.textContent;
        }),
      // The app's own JavaScript is alive on every screen. If the library ever
      // stopped it, "the app stops responding" would show up right here.
      appAlive: !!window.__app,
      morphTarget: !!document.querySelector("[data-morph-target]")
    };
  });
}

async function recordClick(page, clicks, label, action) {
  const from = await locationOf(page);
  await action();
  clicks.push({ label: label, from: from, to: await locationOf(page), state: await appState(page) });
}

// --- the reviewer's gestures, all real ---------------------------------------

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

async function bootedOn(page, url) {
  await page.goto(url);
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from the one script line in the application's layout"
  });
}

function navLink(page, label) {
  return page.locator("nav.app-nav a", { hasText: label });
}

function projectedPages(stateDir) {
  const file = path.join(stateDir, "reviews", REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

// --- the walk ----------------------------------------------------------------

/**
 * The eight clicks, identical in both runs. `reviewing` carries the library's
 * half: the two comments and the fix, which happen between the clicks and are
 * never themselves recorded as clicks.
 */
async function walk(page, app, reviewing) {
  const clicks = [];

  // Screen one: the dashboard.
  await page.goto(app.urlFor("/" + QUERY));
  if (reviewing) {
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot on the dashboard"
    });
    await reviewing.onDashboard(page);
  }

  // Screen two, reached by a click on a link.
  await recordClick(page, clicks, "nav to Clients", async () => {
    await Promise.all([page.waitForURL(/\/clients/), navLink(page, "Clients").click()]);
  });
  if (reviewing) await reviewing.onClients(page);

  // Driving the app for real: a form the application posts, which redirects,
  // which is a button that navigates.
  await recordClick(page, clicks, "save a note", async () => {
    await page.fill("#note-body", NOTE_BODY);
    await page.selectOption("#note-client", "devon-abara");
    await Promise.all([page.waitForURL(/\/clients/), page.click(".note-form button[type=submit]")]);
  });

  await recordClick(page, clicks, "nav to Dashboard", async () => {
    await Promise.all([page.waitForURL(/127\.0\.0\.1:\d+\/\?/), navLink(page, "Dashboard").click()]);
  });

  // A button that does not navigate, so "the app keeps working" covers both
  // kinds of button.
  await recordClick(page, clicks, "log a session", async () => {
    await page.click("#log-session");
    await pollPage(page, () => document.querySelector("#session-count").textContent === "1", undefined, {
      message: "the application's own click handler to run"
    });
  });

  // The login the third screen sits behind.
  await recordClick(page, clicks, "nav to Reports, which redirects to the login", async () => {
    await Promise.all([page.waitForURL(/\/login/), navLink(page, "Reports").click()]);
  });

  await recordClick(page, clicks, "sign in", async () => {
    await page.fill("#email", ACCOUNT.email);
    await page.fill("#password", ACCOUNT.password);
    await Promise.all([page.waitForURL(/\/reports/), page.click("form button[type=submit]")]);
  });

  // Screen three: the fix, typed while the page polls and morphs.
  if (reviewing) await reviewing.onReports(page);

  // The navigation with an edit open, and back.
  await recordClick(page, clicks, "nav to Dashboard with an edit open", async () => {
    await Promise.all([page.waitForURL(/127\.0\.0\.1:\d+\/\?/), navLink(page, "Dashboard").click()]);
  });

  await recordClick(page, clicks, "nav back to Reports", async () => {
    await Promise.all([page.waitForURL(/\/reports/), navLink(page, "Reports").click()]);
  });

  if (reviewing) await reviewing.afterNavigation(page);

  return clicks;
}

/** Ports differ between two runs on ephemeral ports; nothing else may. */
function comparable(clicks, port) {
  return JSON.parse(JSON.stringify(clicks).split("127.0.0.1:" + port).join("127.0.0.1:PORT"));
}

test.describe("AC2: Ken's dev-server story", () => {
  test("the same eight clicks do the same thing with the library on the page and with the script line gone", async ({
    browser
  }) => {
    // ------------------------------------------------------------------ run one
    const app = await startAppServer();
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [app.origin]
    });
    const token = helper.tokenFor(REVIEW);
    const reviewedContext = await browser.newContext();
    const reviewedPage = await reviewedContext.newPage();

    let withLibrary = null;
    let fixRecord = null;

    try {
      app.useLayer({ review: REVIEW, token: token, helper: helper.url });

      const state = {};

      withLibrary = await walk(reviewedPage, app, {
        onDashboard: async (page) => {
          await commentOnSelection(page, "p.lede", SAID.dashboard);
        },
        onClients: async (page) => {
          await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
            message: "the layer to boot on the Clients screen"
          });
          await commentOnSelection(page, "h1", SAID.clients);
        },
        onReports: async (page) => {
          await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
            message: "the layer to boot on the Reports screen"
          });
          // The page really is polling and morphing.
          expect(await page.evaluate(() => window.__app.morph.polling)).toBe(true);
          expect(await page.evaluate(() => window.__app.morph.flavor)).toBe("hooked");

          // The fix goes INSIDE the morph target, which is the only place a
          // morph can take the caret away.
          const region = "#feed-coach-note";
          await placeCaret(page, { selector: region, offset: 0 });
          await page.keyboard.press("ControlOrMeta+Shift+KeyE");
          await pollPage(page, () => window.__lahe.isEditing(), undefined, {
            message: "Cmd-Shift-E to put the feed note into edit state"
          });

          // Read AFTER entering edit, which is after the block is protected, so
          // the base cannot drift between the read and the typing.
          const base = await page.evaluate((sel) => document.querySelector(sel).textContent, region);
          const length = base.length;
          await placeCaret(page, { selector: region, offset: length });
          const caret = await captureCaret(page);

          const before = await page.evaluate(() => ({
            morphPasses: window.__app.counters.morphPasses,
            skipped: window.__app.counters.morphsSkipped,
            latest: document.querySelector("#feed-latest").textContent
          }));

          await page.keyboard.type(SAID.fix, { delay: 20 });

          // The positive control: the application really morphed under the
          // reviewer's hands, and really was told no about this one element.
          await pollPage(
            page,
            (from) =>
              window.__app.counters.morphPasses >= from.morphPasses + 2 &&
              window.__app.counters.morphsSkipped > from.skipped &&
              document.querySelector("#feed-latest").textContent !== from.latest,
            before,
            { message: "two morph passes, a skip on the edited element, and the rest of the feed moving" }
          );

          // A MORPH DID NOT LOSE THE CARET. The text is exactly what was there
          // plus what was typed, and the caret is in the same text node by
          // identity, advanced by exactly what was typed.
          expect(
            await page.evaluate((sel) => document.querySelector(sel).textContent, region),
            "the reviewer's sentence survived the morphs, whole"
          ).toBe(base + SAID.fix);

          const report = await compareCaret(page, caret, { expectedOffsetDelta: SAID.fix.length });
          expect(caretProblems(report).join("; "), "the caret survived the morph").toBe("");

          // The edit is left OPEN. The next recorded click is a navigation.
          expect(await page.evaluate(() => window.__lahe.isEditing()), "the edit is open").toBe(true);
          state.base = base;
        },
        afterNavigation: async (page) => {
          await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
            message: "the layer to boot again on the Reports screen"
          });
          // AN OPEN EDIT IS NOT LOST ON NAVIGATION. The click that navigated
          // committed it, and the record is still there, byte for byte, after
          // a full page load in between.
          const items = await page.evaluate(() => window.__lahe.items());
          const edit = items.filter((item) => item.kind === "edit")[0];
          expect(edit, "the open edit became a record rather than being lost").toBeTruthy();
          expect(
            Buffer.compare(
              Buffer.from(edit.after, "utf8"),
              Buffer.from(state.base + SAID.fix, "utf8")
            ),
            "the edit came through the navigation byte-identical"
          ).toBe(0);
          expect(edit.state).toBe("ready");
          fixRecord = edit;
        }
      });

      // ONE REVIEW, NAMING ALL THREE PAGES.
      const projection = await pollUntil(
        () => {
          const got = projectedPages(helper.stateDir);
          if (!got) return null;
          const paths = got.pages.map((p) => p.path).sort();
          return paths.length === 3 ? got : null;
        },
        {
          message: "one review naming all three screens",
          describe: async () => ({
            pages: (projectedPages(helper.stateDir) || { pages: [] }).pages.map((p) => ({
              path: p.path,
              items: p.items.length
            })),
            status: await reviewedPage.evaluate(() => window.__lahe.status())
          })
        }
      );
      expect(projection.review.id, "one review, not three").toBe(REVIEW);
      expect(projection.pages.map((p) => p.path).sort()).toEqual(["/", "/clients", "/reports"]);
      const allItems = projection.pages.reduce((out, p) => out.concat(p.items), []);
      expect(allItems, "two comments and the fix, in one review").toHaveLength(3);
      expect(allItems.map((i) => i.kind).sort()).toEqual(["comment", "comment", "edit"]);
      expect(fixRecord, "the fix is a record").toBeTruthy();
    } finally {
      await reviewedContext.close();
      await helper.kill9();
    }

    const reviewedPort = app.port;
    await app.close();

    // ------------------------------------------------------------------ run two
    //
    // The same application, the same seven clicks, with the script line gone.
    const bare = await startAppServer();
    const bareContext = await browser.newContext();
    const barePage = await bareContext.newPage();
    let withoutLibrary = null;

    try {
      expect(bare.layer(), "run two's layout has no script line at all").toBeNull();
      withoutLibrary = await walk(barePage, bare, null);
      expect(
        await barePage.evaluate(() => typeof window.__lahe),
        "and nothing of the library is on the page"
      ).toBe("undefined");
    } finally {
      await bareContext.close();
      await bare.close();
    }

    // ------------------------------------------------------- the comparison
    //
    // Every click, both times. The ports are normalized because they are
    // ephemeral and differ by construction; nothing else is touched.
    const a = comparable(withLibrary, reviewedPort);
    const b = comparable(withoutLibrary, bare.port);

    expect(a.map((click) => click.label), "the same eight clicks in the same order").toEqual(
      b.map((click) => click.label)
    );
    expect(a, "eight recorded clicks").toHaveLength(8);
    a.forEach(function (click, i) {
      expect(click, "click " + (i + 1) + " (" + click.label + ") did the same thing both times").toEqual(b[i]);
    });
  });
});
