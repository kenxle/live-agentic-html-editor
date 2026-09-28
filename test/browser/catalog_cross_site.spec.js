// Every Library action is refused from another origin. LAHE Library plan,
// Task 3.2, "End to end and cross-site (3.2)" in the Test List. Runs on all
// three lanes: --project=chromium, --project=firefox, --project=webkit.
//
// Two attacking pages, both the existing attacker.html:
//
//   CROSS-SITE      http://localhost:<port>/attacker.html. A different site from
//                   the helper's 127.0.0.1, which is what a real website is.
//   ANOTHER PORT    http://127.0.0.1:<other port>/attacker.html. Same site, other
//                   origin: the shape of a document under review on its own
//                   static server, the page most likely to run a script Ken
//                   did not write. The browser sends Sec-Fetch-Site: same-site,
//                   and the Library's API refuses it.
//
// From each, every action is tried in every shape a page has:
//
//   fetch, cors      JSON, the Library's client header and the REAL Library
//                    token (as if it had leaked), which forces a preflight
//   fetch, no-cors   the same body as text/plain; the browser drops the headers
//   sendBeacon       POST routes
//   a form POST      auto-submitted into a hidden frame, enctype text/plain
//   <img>            a GET on catalog.list
//   <iframe>         of /catalog itself
//
// ASSERTED ON EFFECT, as harness_second_origin.spec.js does. A status code
// proves nothing, because the attacker cannot read it either. So:
//
//   - catalog.json and catalog-requests.jsonl are byte-for-byte unchanged
//   - the closed session a forged Open names is still closed, and its review's
//     log has no new line (Open registers the new server's origin there)
//   - health's catalog_seen_at does not move (a framed Library would poll)
//   - every attempt that reaches the helper is in its log as a named refusal:
//     the wait is on that line, not on a timer, and the check it names is
//     sec_fetch_site
//
// THE POSITIVE CONTROL IS IN THE SAME TEST, against the same state dir and read
// through the same readers: the real Library page on this lane lists, stars
// (catalog.json changes) and queues a pick-up (catalog-requests.jsonl grows).
// Without it, "nothing changed" would also pass against a helper writing
// somewhere else.

"use strict";

const http = require("node:http");

const { test, expect } = require("../helpers");
const { pollUntil, pollPage } = require("../helpers/poll");
const { buildWorld } = require("./support/catalog_world");

const protocol = require("../../src/shared/protocol.js");

// Pick this up sits behind the row's Hand to agent menu.
async function pickUp(rowLocator) {
  const menu = rowLocator.locator('[data-act="menu"]');
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await rowLocator.locator('[data-act="pickup"]').click();
}

test.describe.configure({ mode: "serial" });

const POST_ROUTES = ["catalog.open", "catalog.star", "catalog.request"];

let world = null;
let token = null;

/** The page's bytes, fetched the way a navigation from the address bar would. */
function fetchLibraryHtml(secFetchSite) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port: world.port, path: protocol.CATALOG_PAGE_PATH, headers: { "sec-fetch-site": secFetchSite || "none" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
  });
}

async function seenAt() {
  const res = await fetch(world.helperOrigin + protocol.route("health").path);
  return (await res.json()).catalog_seen_at;
}

function urlOf(name) {
  return world.helperOrigin + protocol.route(name).path;
}

/** The named refusals in the helper log, per route, in order: [check, what the browser sent]. */
function refusalLines(routeName, from) {
  const re = new RegExp("refused " + routeName.replace(".", "\\.") + ": check (\\w+) failed(?: \\(([^)]*)\\))?", "g");
  const out = [];
  let m;
  const text = world.helperLog().slice(from || 0);
  while ((m = re.exec(text))) out.push([m[1], m[2] || ""]);
  return out;
}

function refusals(routeName) {
  return refusalLines(routeName).map((line) => line[0]);
}

/** What Sec-Fetch-Site this lane sent, per route, recorded on the test for the progress page. */
function noteSentValues(from) {
  const sent = {};
  for (const name of POST_ROUTES.concat(["catalog.list", "catalog.page"])) {
    sent[name] = Array.from(new Set(refusalLines(name, from).map((line) => line[1]))).join(",");
  }
  test.info().annotations.push({ type: "sec-fetch-site sent", description: JSON.stringify(sent) });
}

/** How many preflights for a catalog path the helper refused from `origin`. */
function catalogPreflightRefusals(origin) {
  const needle = "refused preflight: catalog path, origin " + JSON.stringify(origin);
  return world.helperLog().split(needle).length - 1;
}

/** Run one attempt, then wait for the helper to log its refusal. */
async function refusedOnce(routeName, attempt) {
  const before = refusals(routeName).length;
  const result = await attempt();
  const after = await pollUntil(
    () => {
      const now = refusals(routeName);
      return now.length > before ? now : null;
    },
    { message: "the helper to log a refusal of " + routeName, describe: () => ({ result: result, log: world.helperLog().slice(-2000) }) }
  );
  expect(after.slice(before), routeName + " was refused at the Sec-Fetch-Site check").toEqual([protocol.CHECK.SEC_FETCH_SITE]);
  return result;
}

function snapshot() {
  return {
    catalog: world.catalogFileText(),
    requests: world.requestsFileText(),
    closedEvents: world.eventsText(world.docs.closed.review),
    closedSessionClosed: world.sessionClosed(world.docs.closed.session)
  };
}

function forgedBody(name) {
  if (name === "catalog.open") return { review: world.docs.closed.review, handoff: false, confirmed: true };
  if (name === "catalog.star") return { review: world.docs.target.review, starred: true };
  return { review: world.docs.target.review, action: "launch", confirmed: true };
}

// The attacks, each run inside the attacking page -----------------------------

function corsFetch(page, url, method, body) {
  return page.evaluate(
    async (a) => {
      try {
        const init = { method: a.method, mode: "cors", headers: {} };
        init.headers[a.clientHeader] = a.client;
        init.headers[a.tokenHeader] = a.token;
        if (a.method === "POST") {
          init.headers["Content-Type"] = a.json;
          init.body = JSON.stringify(a.body);
        }
        const res = await fetch(a.url, init);
        return "status:" + res.status + " body:" + (await res.text());
      } catch (err) {
        return "threw:" + err.name;
      }
    },
    {
      url,
      method,
      body,
      token,
      client: protocol.CLIENT_CATALOG,
      clientHeader: protocol.HEADER.CLIENT,
      tokenHeader: protocol.HEADER.TOKEN,
      json: protocol.JSON_CONTENT_TYPE
    }
  );
}

function noCorsFetch(page, url, method, body) {
  return page.evaluate(
    async (a) => {
      try {
        const init = { method: a.method, mode: "no-cors", headers: {} };
        // A no-cors request may not carry these; the browser drops them. They
        // are set anyway, because an attacker would try.
        init.headers[a.clientHeader] = a.client;
        init.headers[a.tokenHeader] = a.token;
        if (a.method === "POST") {
          init.headers["Content-Type"] = "text/plain";
          init.body = JSON.stringify(a.body);
        }
        const res = await fetch(a.url, init);
        let text;
        try {
          text = await res.text();
        } catch (err) {
          text = "unreadable";
        }
        return "type:" + res.type + " body:" + text;
      } catch (err) {
        return "threw:" + err.name;
      }
    },
    { url, method, body, token, client: protocol.CLIENT_CATALOG, clientHeader: protocol.HEADER.CLIENT, tokenHeader: protocol.HEADER.TOKEN }
  );
}

function beacon(page, url, body) {
  return page.evaluate((a) => navigator.sendBeacon(a.url, new Blob([JSON.stringify(a.body)], { type: "text/plain" })), { url, body });
}

/** An auto-submitted form. text/plain makes the body read as JSON: name={"...,"x":" value="} */
function formPost(page, url, body) {
  return page.evaluate(
    (a) => {
      const name = "sink" + document.querySelectorAll("iframe").length;
      const frame = document.createElement("iframe");
      frame.name = name;
      document.body.appendChild(frame);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = a.url;
      form.enctype = "text/plain";
      form.target = name;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = JSON.stringify(a.body).slice(0, -1) + ',"x":"';
      input.value = '"}';
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      return "submitted";
    },
    { url, body }
  );
}

function imgGet(page, url) {
  return page.evaluate(
    (u) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve("load:" + img.naturalWidth);
        img.onerror = () => resolve("error");
        img.src = u;
      }),
    url
  );
}

function frameLibrary(page, url) {
  return page.evaluate((u) => {
    const frame = document.createElement("iframe");
    frame.id = "framed-library";
    frame.src = u;
    document.body.appendChild(frame);
    return "framed";
  }, url);
}

// -----------------------------------------------------------------------------

async function attackFrom(page, attackerUrl) {
  const attackerOrigin = new URL(attackerUrl).origin;
  await page.goto(attackerUrl);
  await expect(page.locator("#attacker-title")).toHaveText("Not your app");

  const before = snapshot();
  const seenBefore = await seenAt();
  const logFrom = world.helperLog().length;

  for (const name of POST_ROUTES) {
    const body = forgedBody(name);
    const url = urlOf(name);
    // cors with the real token: the preflight is never approved, so the POST
    // itself is never sent and the page learns nothing. The refusal is the
    // catalog-path rule, which holds even for an origin a review registered.
    const preflightsBefore = catalogPreflightRefusals(attackerOrigin);
    expect(await corsFetch(page, url, "POST", body), name + " cors").toBe("threw:TypeError");
    await pollUntil(() => catalogPreflightRefusals(attackerOrigin) > preflightsBefore, {
      message: "the helper to log `refused preflight: catalog path` for " + name,
      describe: () => ({ log: world.helperLog().slice(-2000) })
    });
    const opaque = await refusedOnce(name, () => noCorsFetch(page, url, "POST", body));
    expect(opaque, name + " no-cors is opaque").toBe("type:opaque body:");
    await refusedOnce(name, () => beacon(page, url, body));
    await refusedOnce(name, () => formPost(page, url, body));
  }

  const listUrl = urlOf("catalog.list");
  expect(await corsFetch(page, listUrl, "GET", null), "list cors").toBe("threw:TypeError");
  expect(await refusedOnce("catalog.list", () => noCorsFetch(page, listUrl, "GET", null)), "list no-cors is opaque").toBe(
    "type:opaque body:"
  );
  expect(await refusedOnce("catalog.list", () => imgGet(page, listUrl)), "list as an image").toBe("error");

  // The Library in a frame. The navigation is refused before the page is
  // served; were it served, frame-ancestors 'none' would still block it.
  // What reached the frame is checked off the network and at the helper, not
  // inside the frame: a refused frame shows the browser's own page (Firefox's
  // JSON viewer, for one), and neither Firefox nor WebKit keeps the body of a
  // response the frame then navigated away from. So the status comes from the
  // browser, and the bytes from the same request replayed with the
  // Sec-Fetch-Site value this lane just sent, as logged by the helper.
  const framed = page.waitForResponse((r) => r.url() === world.libraryUrl);
  await refusedOnce("catalog.page", () => frameLibrary(page, world.libraryUrl));
  const response = await framed;
  expect(response.status(), "the framed Library is refused").toBe(protocol.statusFor("PROTO_CROSS_SITE"));
  const sent = refusalLines("catalog.page").slice(-1)[0][1];
  const replay = await fetchLibraryHtml(sent);
  expect(replay.status).toBe(protocol.statusFor("PROTO_CROSS_SITE"));
  expect(replay.body, "no Library page in the refusal").not.toContain(protocol.CATALOG_TOKEN_META);
  expect(replay.body, "no token in the refusal").not.toContain(token);

  // The effects, which are the only thing worth asserting.
  expect(snapshot(), "no Library state changed").toEqual(before);
  expect(before.closedSessionClosed, "the forged Open targeted a closed session").toBe(true);
  expect(await seenAt(), "no Library list was authenticated").toBe(seenBefore);
  noteSentValues(logFrom);
}

/** The positive control: the real Library, on this lane, against this state dir. */
async function libraryStillWorks(context, starDoc) {
  const page = await context.newPage();
  const before = snapshot();
  // Read before the page loads: the second test runs after the first test's
  // control already listed, so "not null" alone would prove nothing there.
  const seenBefore = await seenAt();
  try {
    await page.goto(world.libraryUrl);
    await pollPage(page, () => !!document.querySelector("#lahe-catalog-main .lib-section"), undefined, {
      message: "the real Library to list on this lane"
    });
    const seenAfter = await seenAt();
    expect(seenAfter, "the Library's own list was authenticated").not.toBe(null);
    expect(seenAfter, "and it moved catalog_seen_at").not.toBe(seenBefore);

    const row = page.locator('li[data-review="' + world.docs[starDoc].review + '"]').first();
    await row.locator('[data-act="star"]').click();
    await expect(row.locator('[data-act="star"]')).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(world.catalogFileText()).stars).toHaveProperty(world.docs[starDoc].review);

    await pickUp(row);
    await pollUntil(() => world.requestsFileText() !== before.requests, {
      message: "the real Library's pick-up to reach catalog-requests.jsonl"
    });
    expect(world.drainRequests().map((r) => r.review)).toContain(world.docs[starDoc].review);
  } finally {
    await page.close();
  }
}

test.describe("the Library's actions from another origin", () => {
  test.beforeAll(async () => {
    world = await buildWorld({
      agentName: "stub agent",
      docs: [
        // A forged Open names this closed session: it would reopen it.
        { key: "closed", folder: "closed", file: "brief.html", title: "Closed Brief", body: "Closed.", close: true },
        // A forged star and a forged launch name this one.
        { key: "target", folder: "target", file: "plan.html", title: "Target Plan", body: "Open." },
        // The positive controls star and pick up these, one per test.
        { key: "controlA", folder: "control-a", file: "a.html", title: "Control A", body: "A." },
        { key: "controlB", folder: "control-b", file: "b.html", title: "Control B", body: "B." }
      ]
    });
    const page = await fetchLibraryHtml();
    expect(page.status).toBe(200);
    const m = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]+)"').exec(page.body);
    expect(m, "the Library page carries its token").not.toBeNull();
    token = m[1];
    expect(await seenAt(), "fetching the page alone authenticates no list").toBeNull();
  });

  test.afterAll(async () => {
    if (world) world.teardown();
  });

  test("from another site (localhost): every action is refused, and the Library still works", async ({ page, context, attackerServer }) => {
    const attacker = "http://localhost:" + attackerServer.port + "/attacker.html";
    await attackFrom(page, attacker);
    await libraryStillWorks(context, "controlA");
  });

  test("from another loopback port (127.0.0.1): every action is refused, and the Library still works", async ({
    page,
    context,
    attackerServer
  }) => {
    expect(attackerServer.origin).not.toBe(world.helperOrigin);
    // SEC3: the attacker's origin is one a review registered, the way a
    // document on its own static server is. The catalog routes still refuse
    // its preflight, by the catalog-path rule.
    world.lahe([
      "review", world.docs.target.file,
      "--session", world.docs.target.session,
      "--origin", attackerServer.origin,
      "--port", String(world.port)
    ]);
    // Proof it is registered: a review route's preflight from it is approved.
    const reviewPreflight = await fetch(world.helperOrigin + protocol.route("events.append").path, {
      method: "OPTIONS",
      headers: { origin: attackerServer.origin, "access-control-request-method": "POST" }
    });
    expect(reviewPreflight.status, "the attacker's origin is registered on a review").toBe(204);
    await attackFrom(page, attackerServer.urlFor("attacker.html"));
    await libraryStillWorks(context, "controlB");
  });
});
