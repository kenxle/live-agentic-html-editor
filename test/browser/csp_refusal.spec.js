// Ranked test 23: a CSP refusal is named distinctly from a helper that is down.
//
// Owner: 2D (living in the page). Driven by a REAL Content-Security-Policy
// response header, from the harness's CSP server, because that is the failure a
// real app's real header produces and a meta tag cannot express every directive.
//
// Why this matters enough to be its own ranked test. To a fetch, the two look
// identical: the request does not arrive. They need OPPOSITE fixes. One is
// "start the helper". The other is "add the helper's origin to connect-src in
// this app's development CSP", and a reviewer told the helper is down will
// restart it all afternoon and never get a single comment out of the page.
//
// Three cases, and the third is the one people forget:
//
//   connect-src 'none'   the layer runs, its calls to the helper are refused
//   no policy, dead port the layer runs, the helper really is down
//   script-src 'none'    the layer never runs at all, and nothing in the page
//                        can say so, which is why the assertion is about the
//                        page's own script never having run

"use strict";

const { test, expect, pollPage } = require("../helpers");
const { withLayer } = require("./support/with_layer");

const REVIEW = "csp-review";
const TOKEN = "csp-token";

// A loopback origin with nothing listening on it. Under the CSP case the
// browser refuses the request before it can find that out, which is the whole
// point: the same dead helper produces two different messages.
const DEAD_HELPER = "http://127.0.0.1:1";

const FIXTURE = "built-doc.html";

async function bootOn(page, server, path) {
  await withLayer(page, { review: REVIEW, token: TOKEN, helper: DEAD_HELPER });
  await page.goto(server.urlFor(path || FIXTURE));
}

async function failureCodes(page) {
  return page.evaluate(() => window.__lahe.failures().map((f) => f.code));
}

test.describe("ranked test 23: a policy refusal is not a helper that is down", () => {
  test("connect-src 'none' names the CSP, with the CSP's own remedy", async ({ page, cspServer }) => {
    const server = await cspServer("block-connect");
    await bootOn(page, server);

    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot: script-src allows it here, only connect-src is closed"
    });

    await pollPage(page, () => window.__lahe.failures().length > 0, undefined, {
      message: "the refusal to reach the rail's failure list"
    });

    const codes = await failureCodes(page);
    expect(codes).toContain("CSP_REFUSED");

    // The whole point of the test: NOT the other message.
    expect(codes).not.toContain("HELPER_UNREACHABLE");

    const chip = await page.evaluate(() => window.__lahe.failures().filter((f) => f.code === "CSP_REFUSED")[0]);
    expect(chip.message).toContain("content security policy");
    expect(chip.remedy).toContain("connect-src");
    expect(await page.evaluate(() => window.__lahe.counters.cspRefusals)).toBeGreaterThanOrEqual(1);

    // Keep pushing on it. The first refusal could in principle land before the
    // violation event does and be named wrongly; several more attempts, each
    // one a real blocked request, are what make "not the other message" a claim
    // about the state rather than about the order two things happened in.
    await page.evaluate(() => {
      const item = window.LAHE.record_fixtures
        .createFixtures({ page: window.__lahe.page() })
        .comment({});
      window.__lahe.store().write(window.__lahe.review, item);
      window.__lahe.handle.sync.recordItem(item, { immediate: "ready" });
    });
    await pollPage(page, () => window.__lahe.failures().some((f) => f.code === "CSP_REFUSED" && f.count > 1), undefined, {
      message: "the refusal to be counted more than once, so it is the settled state"
    });
    expect(await failureCodes(page)).not.toContain("HELPER_UNREACHABLE");
  });

  test("no policy and a dead helper names the helper, not the CSP", async ({ page, fixtureServer }) => {
    await bootOn(page, fixtureServer);

    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot"
    });
    await pollPage(page, () => window.__lahe.failures().length > 0, undefined, {
      message: "the unreachable helper to reach the rail's failure list"
    });

    const codes = await failureCodes(page);
    expect(codes).toContain("HELPER_UNREACHABLE");
    expect(codes).not.toContain("CSP_REFUSED");
    expect(await page.evaluate(() => window.__lahe.counters.cspRefusals)).toBe(0);

    // Same page, same dead port, different sentence. Read side by side because
    // "distinctly named" is a claim about the words the reviewer sees.
    const messages = await page.evaluate(() =>
      window.__lahe.failures().map((f) => ({ code: f.code, message: f.message }))
    );
    expect(messages.some((m) => /not reachable/i.test(m.message))).toBe(true);
    expect(messages.some((m) => /content security policy/i.test(m.message))).toBe(false);
  });

  test("script-src 'none' stops the layer running at all, and the page says so", async ({ page, cspServer }) => {
    const server = await cspServer("block-script");
    await bootOn(page, server, "csp-probe.html");

    // The page's OWN inline script never ran, which is what "the policy refused
    // the layer" looks like from inside the page. page.evaluate is injected
    // through the debugger and runs regardless, so the assertion is about the
    // page's script and not about the ability to evaluate anything here.
    expect(await page.evaluate(() => typeof window.__cspProbe)).toBe("undefined");
    expect(await page.evaluate(() => typeof window.__lahe)).toBe("undefined");
    expect(await page.evaluate(() => typeof window.LAHE)).toBe("undefined");

    // The page is still the page. Nothing about the tool being refused breaks it.
    await expect(page.locator("#probe-title")).toHaveText("CSP probe");
    expect(await page.evaluate(() => document.getElementById("probe-status").textContent)).toBe("Waiting.");
  });
});
