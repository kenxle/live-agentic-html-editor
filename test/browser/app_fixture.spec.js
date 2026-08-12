// The app fixture, walked as a real user walks it.
//
// Plan task 0C. This spec is the fixture's done bar: three pathnames reached by
// clicking links, a form that submits, a login that gates the third screen, the
// page's own click handler firing, and a poll-and-morph engine replacing content
// in BOTH flavors, with no library loaded at all.
//
// Why "with no library loaded at all" is asserted rather than assumed: this
// fixture stands in for the reviewed application. If it ever quietly grew a
// dependency on the tool, every later test that claims "the page keeps working"
// (D3, browse is fully native) would be testing the tool against itself.
//
// Every wait here is a condition poll or Playwright auto-waiting. The one timer
// in play is the fixture page's own poll loop, which is the application's
// behavior, not the test waiting.

"use strict";

const { test: base, expect } = require("../helpers");
const { pollPage } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const LOGIN = { email: "coach@steadythread.test", password: "kettlebell" };

const test = base.extend({
  // Test-scoped on purpose: the app holds mutable state (session, saved notes,
  // a feed cursor), and a shared server would let one test's form submission
  // show up in another test's assertions.
  appServer: async function ({}, use) {
    const server = await startAppServer();
    await use(server);
    await server.close();
  }
});

/** Wait for the page's own poll-and-morph loop to complete `n` more passes. */
async function waitForMorphPasses(page, n) {
  const start = await page.evaluate(() => window.__app.counters.morphPasses);
  await pollPage(
    page,
    (target) => window.__app.counters.morphPasses >= target,
    start + n,
    { message: "the fixture's morph engine to complete " + n + " more passes" }
  );
}

test.describe("app fixture: the reviewed application", () => {
  test("walks three pathnames by clicking links, logging in on the way", async ({ page, appServer }) => {
    await page.goto(appServer.urlFor("/"));
    await expect(page.locator("h1")).toHaveText("Coach dashboard");
    expect(new URL(page.url()).pathname).toBe("/");

    // Second pathname, reached the way a person reaches it.
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(/\/clients(\?|$)/);
    await expect(page.locator("h1")).toHaveText("Clients");

    // Third pathname is gated. Clicking through lands on the login screen.
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toHaveText("Sign in");

    // A wrong password is refused and says so, so the gate is a real gate.
    await page.locator("#email").fill(LOGIN.email);
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");

    await page.locator("#email").fill(LOGIN.email);
    await page.locator("#password").fill(LOGIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/reports(\?|$)/);
    await expect(page.locator("h1")).toHaveText("Reports");
    await expect(page.locator("#signed-in-as")).toContainText(LOGIN.email);

    // And back to the first pathname by link, so navigation is not one-way.
    await page.getByRole("link", { name: "Dashboard" }).click();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("the note form submits and the server renders what was saved", async ({ page, appServer }) => {
    await page.goto(appServer.urlFor("/clients"));

    const note = "Moved her deadlift session to Thursday, knee felt better after the walk.";
    await page.locator("#note-client").selectOption("marisa-huang");
    await page.locator("#note-body").fill(note);
    await page.getByRole("button", { name: "Save note" }).click();

    // A real submit: a navigation, a server round trip, and the note rendered
    // back out of server state rather than stuffed into the DOM by script.
    await expect(page).toHaveURL(/\/clients(\?|$)/);
    await expect(page.locator("#saved-notes")).toContainText(note);
    await expect(page.locator("#saved-notes")).toContainText("Marisa Huang");

    // It survives a fresh load, which is what proves the server kept it.
    await page.reload();
    await expect(page.locator("#saved-notes")).toContainText(note);
  });

  test("the page's own click handler runs, untouched", async ({ page, appServer }) => {
    await page.goto(appServer.urlFor("/"));

    await expect(page.locator("#session-count")).toHaveText("0");
    await page.locator("#log-session").click();
    await page.locator("#log-session").click();

    await expect(page.locator("#session-count")).toHaveText("2");
    expect(await page.evaluate(() => window.__app.counters.sessionClicks)).toBe(2);
  });

  test("the hooked flavor morphs the feed, and honors both of its escape hatches", async ({
    page,
    appServer
  }) => {
    await page.goto(appServer.urlFor("/?morph=hooked"));
    expect(await page.evaluate(() => window.__app.morph.flavor)).toBe("hooked");

    // 1. It genuinely replaces content on its own timer.
    const before = await page.locator("#feed-latest").innerText();
    await waitForMorphPasses(page, 1);
    await expect(page.locator("#feed-latest")).not.toHaveText(before);
    expect(await page.evaluate(() => window.__app.counters.morphedElements)).toBeGreaterThan(0);

    // 2. The cooperative-skip attribute (Turbo's data-turbo-permanent).
    await page.evaluate(() => {
      const el = document.querySelector("#feed-coach-note");
      el.setAttribute("data-app-permanent", "");
      el.textContent = "TYPED BY THE REVIEWER, must not be replaced";
    });
    const skippedBefore = await page.evaluate(() => window.__app.counters.morphsSkipped);
    await waitForMorphPasses(page, 2);
    await expect(page.locator("#feed-coach-note")).toHaveText("TYPED BY THE REVIEWER, must not be replaced");
    expect(await page.evaluate(() => window.__app.counters.morphsSkipped)).toBeGreaterThan(skippedBefore);

    // 3. The cancelable pre-morph element event (turbo:before-morph-element).
    await page.evaluate(() => {
      window.__probe = { vetoEvents: 0 };
      document.addEventListener("app:before-morph-element", (event) => {
        if (event.target.id !== "feed-highlight") return;
        window.__probe.vetoEvents += 1;
        event.preventDefault();
      });
      document.querySelector("#feed-highlight").textContent = "VETOED CONTENT stays put";
    });
    await waitForMorphPasses(page, 2);
    await expect(page.locator("#feed-highlight")).toHaveText("VETOED CONTENT stays put");
    expect(await page.evaluate(() => window.__probe.vetoEvents)).toBeGreaterThan(0);

    // The rest of the feed kept re-rendering around both of them, which is the
    // whole reason a per-element morph is the hard case.
    const latestNow = await page.locator("#feed-latest").innerText();
    await waitForMorphPasses(page, 1);
    await expect(page.locator("#feed-latest")).not.toHaveText(latestNow);
  });

  test("the no-hook flavor replaces innerHTML and offers nothing to hold onto", async ({
    page,
    appServer
  }) => {
    await page.goto(appServer.urlFor("/?morph=raw"));
    expect(await page.evaluate(() => window.__app.morph.flavor)).toBe("raw");

    await page.evaluate(() => {
      window.__probe = { events: 0 };
      document.addEventListener("app:before-morph-element", () => {
        window.__probe.events += 1;
      });
      const el = document.querySelector("#feed-coach-note");
      el.setAttribute("data-app-permanent", "");
      el.textContent = "TYPED BY THE REVIEWER, and this flavor does not care";
    });

    const before = await page.locator("#feed-latest").innerText();
    await waitForMorphPasses(page, 1);

    // Content replaced wholesale.
    await expect(page.locator("#feed-latest")).not.toHaveText(before);
    await expect(page.locator("#feed-coach-note")).not.toHaveText(
      "TYPED BY THE REVIEWER, and this flavor does not care"
    );

    // No hook at all: no event fired, and the attribute bought nothing.
    expect(await page.evaluate(() => window.__probe.events)).toBe(0);
    expect(await page.evaluate(() => window.__app.counters.morphsSkipped)).toBe(0);
    expect(await page.evaluate(() => document.querySelector("#feed-coach-note").hasAttribute("data-app-permanent"))).toBe(
      false
    );
  });

  test("no library is loaded anywhere in the app", async ({ page, appServer }) => {
    for (const path of ["/", "/clients", "/login"]) {
      await page.goto(appServer.urlFor(path));
      const report = await page.evaluate(() => ({
        lahe: typeof window.LAHE,
        tagged: document.querySelectorAll("script[data-lahe-review]").length,
        srcs: Array.from(document.scripts).map((s) => s.src || "inline")
      }));
      expect(report.lahe).toBe("undefined");
      expect(report.tagged).toBe(0);
      expect(report.srcs.join(" ")).not.toContain("lahe");
    }
  });
});
