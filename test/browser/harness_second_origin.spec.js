// The helper cannot be driven from outside. Ranked test 5.
//
// Retargeted from the stub service to the REAL helper, which is the one constant
// this file's own header said would change. Everything else about it holds: the
// thing to copy is not the helper calls but the assertion style. EVERY refusal
// is asserted on EFFECT. The event log on disk has no new lines. A status code
// proves nothing, because the attacker cannot read it either, and a helper that
// returned 403 while appending the row would pass a status assertion and fail
// the reviewer.
//
// THE POSITIVE CONTROL IS MANDATORY AND IT IS IN THE SAME TEST, against the same
// state directory and read through the same reader. A test that only ever
// asserts "the log is empty" passes against a helper that is not running, is
// misconfigured, or writes somewhere else entirely, which is the exact shape of
// a security test that protects nothing.
//
// The five checks a page can omit are omitted one at a time, from the ALLOWED
// origin with an otherwise valid request, and each probe leaves the count where
// the positive control left it. The sixth check (Host) is not omittable from a
// browser, because the browser sets that header; it is exercised from the
// non-browser client below, which is the only client that can lie about it.

const { test, expect } = require("../helpers");
const { startService, SERVICE_ENTRY, makeStateDir, readEventLog } = require("../helpers");

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");

const REVIEW = "review-1";
const EVENTS_PATH = protocol.route("events.append").path;

/** The helper log, which is where a refusal names the check that failed. */
function readHelperLog(stateDir) {
  const logPath = path.join(stateDir, "helper.log");
  if (!fs.existsSync(logPath)) return "";
  return fs.readFileSync(logPath, "utf8");
}

/** One valid event, minted the way the library mints one. */
function anEvent(id, text) {
  return {
    event: protocol.EVENT.ITEM_CREATED,
    event_id: id,
    ts: new Date().toISOString(),
    review: REVIEW,
    item: "c_" + id,
    rev: 1,
    text: text
  };
}

/** The events a PAGE can cause. The helper's own review.created and
 *  origin.registered lines are bookkeeping and are on disk before anyone asks. */
function itemEvents(list) {
  return list.filter((event) => event.event === protocol.EVENT.ITEM_CREATED);
}

/**
 * A request built by hand, because node's fetch will not let a caller set Host.
 *
 * The Host check is the one check a browser can never fail, since the browser
 * sets that header itself. A DNS name rebound to 127.0.0.1 is what it defends
 * against, and reproducing that needs a client that can lie about Host, which is
 * exactly what this is.
 */
function rawPost(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: options.port,
        method: "POST",
        path: options.path,
        headers: options.headers,
        // Without setHost:false node writes its own Host header and the caller's
        // is ignored, so the rebinding probe would silently test nothing.
        setHost: false
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** Start the real helper on an ephemeral port, with one review and one origin. */
async function startHelper(options) {
  return startService({
    entry: SERVICE_ENTRY,
    // Port 0, not the fixed 7817. The fixed port is the product's promise to a
    // page that has it baked into a script tag; a test suite running in parallel
    // workers would collide on it, and --port is exactly why it is configurable.
    args: ["--port", "0"],
    ...options
  });
}

test.describe("the helper cannot be driven from outside", () => {
  test("a cross-origin page cannot write, asserted on the event log", async ({
    page,
    fixtureServer,
    attackerServer
  }) => {
    const stateDir = makeStateDir();
    const service = await startHelper({
      stateDir: stateDir,
      // Only the fixture origin is registered. Registering an origin is an act
      // the reviewer performs at their terminal, and it is the one thing a
      // hostile page cannot do.
      allowedOrigins: [fixtureServer.origin],
      reviews: [REVIEW]
    });

    try {
      // review.created and origin.registered are the helper's own bookkeeping,
      // on disk before any page says anything, so what is counted throughout is
      // the events a PAGE can cause.
      expect(itemEvents(readEventLog(stateDir, REVIEW))).toHaveLength(0);

      const url = service.url + EVENTS_PATH;
      await page.goto(attackerServer.urlFor("attacker.html"));
      expect(attackerServer.origin).not.toBe(fixtureServer.origin);

      // 1. A simple request. No preflight is sent, so it reaches the handler.
      //    This is the one that matters: CORS hides the response, not the effect.
      await page.evaluate((u) => window.__attack.simplePost(u, { forged: "item" }), url);

      // 2. sendBeacon, same story, and it outlives the page.
      await page.evaluate((u) => window.__attack.beacon(u, { forged: "beacon" }), url);

      // 3. A preflighted request with a guessed token.
      await page.evaluate((u) => window.__attack.corsPost(u, { forged: "ack" }), url);

      // The effect, which is the only thing worth asserting.
      expect(itemEvents(readEventLog(stateDir, REVIEW))).toHaveLength(0);

      // And the helper said WHY, by name, which is what makes this judgeable by
      // a person reading a file rather than by trusting the code.
      //
      // Worth reading carefully, because it is not the check a first guess would
      // name. The two CORS-simple shapes (a text/plain post and sendBeacon) are
      // refused at custom_header, which sits ahead of the origin check: a simple
      // request cannot carry a custom header at all, so it never gets far enough
      // to have its origin looked at. The preflighted shape never reaches a
      // handler either, because the preflight itself is refused for an origin no
      // review registered. So a hostile PAGE dies at one of those two, and the
      // origin check proper is what refuses a non-browser client, which is the
      // test below.
      const helperLog = readHelperLog(stateDir);
      expect(helperLog).toContain("check " + protocol.CHECK.CUSTOM_HEADER + " failed");
      expect(helperLog).toContain("refused preflight: origin " + attackerServer.origin);
    } finally {
      await service.kill9();
    }
  });

  test("a cross-origin page cannot READ the feedback, asserted on what it received", async ({
    page,
    fixtureServer,
    attackerServer
  }) => {
    // The read direction of "cannot be driven from outside". The write probes
    // above prove a hostile page cannot APPEND; this proves it cannot READ a
    // review's feedback back off the two read routes (review.read, replies.poll).
    // A page that could read the projection has driven the helper just as surely
    // as one that could write it (D9). Asserted on what the attacker RECEIVED
    // (nothing readable) AND on the helper log naming the failed check, with the
    // mandatory positive control (an allowed origin with a valid token reads the
    // projection back) in the same test, same state directory, same reader.
    const stateDir = makeStateDir();
    const service = await startHelper({
      stateDir: stateDir,
      allowedOrigins: [fixtureServer.origin],
      reviews: [REVIEW]
    });

    try {
      const token = service.tokenFor(REVIEW);
      const reviewUrl = service.url + protocol.route("review.read").path + "?review=" + REVIEW;
      const repliesUrl = service.url + protocol.route("replies.poll").path + "?review=" + REVIEW + "&since=0";
      // The projection names itself with this schema marker. A reader that gets
      // it back has read the review's feedback; a reader that does not has read
      // nothing. It is the one string present in every review.json and in no
      // opaque body.
      const MARKER = "lahe.review/3";

      // THE POSITIVE CONTROL. From the ALLOWED origin with a valid token, read
      // the projection back and confirm the feedback really is readable to a
      // legitimate reader. Without this, "the attacker read nothing" also passes
      // against a helper that serves nothing to anyone.
      await page.goto(fixtureServer.urlFor("built-doc.html"));
      const legit = await page.evaluate(
        async (a) => {
          const res = await fetch(a.url, { method: "GET", headers: { "x-lahe-client": "layer", "x-lahe-token": a.token } });
          return { status: res.status, body: await res.text() };
        },
        { url: reviewUrl, token: token }
      );
      expect(legit.status).toBe(200);
      expect(legit.body, "a legitimate reader reads the projection back").toContain(MARKER);

      // NOW THE ATTACKER. A second origin, no registered credential.
      await page.goto(attackerServer.urlFor("attacker.html"));
      expect(attackerServer.origin).not.toBe(fixtureServer.origin);

      const before = readHelperLog(stateDir).length;

      const reviewSimple = await page.evaluate((u) => window.__attack.simpleGet(u), reviewUrl);
      const repliesSimple = await page.evaluate((u) => window.__attack.simpleGet(u), repliesUrl);
      const reviewCors = await page.evaluate((u) => window.__attack.corsGet(u), reviewUrl);
      const repliesCors = await page.evaluate((u) => window.__attack.corsGet(u), repliesUrl);

      // WHAT THE ATTACKER RECEIVED: nothing readable. The projection marker is in
      // none of the four, the no-cors reads came back opaque with an empty body,
      // and the cors reads threw at the refused preflight.
      for (const got of [reviewSimple, repliesSimple, reviewCors, repliesCors]) {
        expect(got, "the attacker read the projection back: " + got).not.toContain(MARKER);
      }
      expect(reviewSimple).toContain("type:opaque");
      expect(repliesSimple).toContain("type:opaque");
      expect(reviewSimple.endsWith("body:"), "an opaque body is unreadable, so empty: " + reviewSimple).toBe(true);
      expect(repliesSimple.endsWith("body:"), "an opaque body is unreadable, so empty: " + repliesSimple).toBe(true);
      expect(reviewCors).toContain("threw:");
      expect(repliesCors).toContain("threw:");

      // THE NAMED REFUSAL, per read route. This is the assertion that bites a
      // fork letting a read route skip its checks: CORS would still hide the
      // opaque body, but the helper log would carry no refusal for the route.
      const added = readHelperLog(stateDir).slice(before);
      expect(added, "review.read refused the credential-less read by name").toContain(
        "refused review.read: check " + protocol.CHECK.CUSTOM_HEADER + " failed"
      );
      expect(added, "replies.poll refused the credential-less read by name").toContain(
        "refused replies.poll: check " + protocol.CHECK.CUSTOM_HEADER + " failed"
      );
      // And the preflighted cors reads died at the origin, for an origin no
      // review registered.
      expect(added).toContain("refused preflight: origin " + attackerServer.origin);
    } finally {
      await service.kill9();
    }
  });

  test("the positive control writes one line, then each omitted check leaves it at one", async ({
    page,
    fixtureServer
  }) => {
    const stateDir = makeStateDir();
    const service = await startHelper({
      stateDir: stateDir,
      allowedOrigins: [fixtureServer.origin],
      reviews: [REVIEW]
    });

    try {
      await page.goto(fixtureServer.urlFor("built-doc.html"));

      const url = service.url + EVENTS_PATH;
      const token = service.tokenFor(REVIEW);

      // A page-side poster that can leave any one thing out. Everything it omits
      // is something a real hostile page can also omit, which is the point. A
      // refused preflight throws inside the page rather than returning a status,
      // and that is a refusal too: the effect assertion is what judges it.
      const post = (omit, body, tokenOverride) =>
        page.evaluate(
          async (a) => {
            const headers = {};
            if (a.omit !== "content_type") headers["Content-Type"] = "application/json";
            if (a.omit !== "custom_header") headers["x-lahe-client"] = "layer";
            if (a.omit !== "token") headers["x-lahe-token"] = a.token;
            try {
              const res = await fetch(a.url, { method: "POST", headers: headers, body: JSON.stringify(a.body) });
              return { sent: true, status: res.status };
            } catch (err) {
              return { sent: false, status: null, error: String(err && err.name ? err.name : err) };
            }
          },
          { url: url, omit: omit, token: tokenOverride || token, body: body }
        );

      // THE POSITIVE CONTROL. Same state directory, same reader, same helper.
      const ok = await post(null, { review: REVIEW, events: [anEvent("ev_control", "the real reviewer")] });
      expect(ok.status).toBe(200);

      const afterControl = readEventLog(stateDir, REVIEW);
      // review.created and origin.registered are the helper's own bookkeeping and
      // are on disk before the page says anything, so the count that matters is
      // the count of ITEM events.
      expect(itemEvents(afterControl)).toHaveLength(1);
      expect(itemEvents(afterControl)[0].text).toBe("the real reviewer");

      // Now each check, omitted one at a time, from the SAME allowed origin with
      // an otherwise perfectly good request. Each probe must leave the count at
      // one, and each must name its check in the helper log.
      const probes = [
        {
          omit: "custom_header",
          check: protocol.CHECK.CUSTOM_HEADER,
          body: { review: REVIEW, events: [anEvent("ev_no_header", "no custom header")] }
        },
        {
          omit: "content_type",
          check: protocol.CHECK.CONTENT_TYPE,
          body: { review: REVIEW, events: [anEvent("ev_no_ct", "no json content type")] }
        },
        {
          omit: "token",
          check: protocol.CHECK.TOKEN,
          body: { review: REVIEW, events: [anEvent("ev_no_token", "no token")] }
        },
        {
          omit: null,
          check: protocol.CHECK.TOKEN,
          tokenOverride: "guessed-token-that-is-wrong",
          body: { review: REVIEW, events: [anEvent("ev_bad_token", "a guessed token")] }
        },
        {
          omit: null,
          check: protocol.CHECK.REVIEW_KNOWN,
          body: { review: "review-nobody-registered", events: [anEvent("ev_unknown", "an unknown review")] }
        }
      ];

      for (const probe of probes) {
        const before = readHelperLog(stateDir).length;
        await post(probe.omit, probe.body, probe.tokenOverride);

        // THE EFFECT: still one item event, and nothing new anywhere.
        expect(itemEvents(readEventLog(stateDir, REVIEW)), "probe " + probe.check + " wrote to the log").toHaveLength(1);
        // THE NAMED REFUSAL: the helper log grew, and the new part names the check.
        const added = readHelperLog(stateDir).slice(before);
        expect(added, "probe " + probe.check + " left no line in the helper log").toContain(
          "check " + probe.check + " failed"
        );
      }

      // The fifth check a page can fail is the origin, and it needs a page on
      // another origin to fail it. That is the test above, against the same
      // helper shape; asserted here too so this test names all five.
      expect(protocol.CHECKS.map((c) => c.name)).toContain(protocol.CHECK.ORIGIN);
    } finally {
      await service.kill9();
    }
  });

  test("a non-browser client is refused the same way, including the Host check", async ({ fixtureServer }) => {
    const stateDir = makeStateDir();
    const service = await startHelper({
      stateDir: stateDir,
      allowedOrigins: [fixtureServer.origin],
      reviews: [REVIEW]
    });

    try {
      const url = service.url + EVENTS_PATH;
      const token = service.tokenFor(REVIEW);

      // A curl-shaped client with everything right EXCEPT the origin, which it
      // has to send from somewhere and cannot get right without being told.
      const noOrigin = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lahe-client": "cli",
          "x-lahe-token": token
        },
        body: JSON.stringify({ review: REVIEW, events: [anEvent("ev_curl", "a script, not a page")] })
      });
      expect(noOrigin.status).toBe(protocol.statusFor("PROTO_FORBIDDEN_ORIGIN"));

      // THE HOST CHECK, which only a non-browser client can fail: a browser sets
      // Host itself. A rebound DNS name resolving to 127.0.0.1 arrives looking
      // exactly like this.
      const rebound = await rawPost({
        port: service.port,
        path: EVENTS_PATH,
        headers: {
          Host: "attacker.example.com",
          "Content-Type": "application/json",
          "x-lahe-client": "cli",
          "x-lahe-token": token,
          Origin: fixtureServer.origin
        },
        body: JSON.stringify({ review: REVIEW, events: [anEvent("ev_rebind", "dns rebinding")] })
      });
      expect(rebound.status).toBe(protocol.statusFor("PROTO_BAD_HOST"));

      expect(itemEvents(readEventLog(stateDir, REVIEW))).toHaveLength(0);
      const helperLog = readHelperLog(stateDir);
      expect(helperLog).toContain("check " + protocol.CHECK.HOST + " failed");
      expect(helperLog).toContain("check " + protocol.CHECK.ORIGIN + " failed");
    } finally {
      await service.kill9();
    }
  });

  test("two origins on one review produce one log with every record exactly once", async ({
    page,
    fixtureServer
  }) => {
    // Ranked test 26. Browser storage is partitioned by origin and no key choice
    // changes that, so localhost and 127.0.0.1 are physically separate buckets.
    // The helper is the thing that unifies them, and this is what that claim
    // means in practice: one review id, two origins, one events.jsonl.
    const stateDir = makeStateDir();
    const localhostOrigin = fixtureServer.origin.replace("127.0.0.1", "localhost");

    const service = await startHelper({
      stateDir: stateDir,
      allowedOrigins: [fixtureServer.origin, localhostOrigin],
      reviews: [REVIEW]
    });

    try {
      const url = service.url + EVENTS_PATH;
      const token = service.tokenFor(REVIEW);

      const postFrom = async (pageOrigin, eventId, text) => {
        await page.goto(pageOrigin + "/built-doc.html");
        return page.evaluate(
          async (a) => {
            const res = await fetch(a.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-lahe-client": "layer",
                "x-lahe-token": a.token
              },
              body: JSON.stringify(a.body)
            });
            return res.status;
          },
          { url: url, token: token, body: { review: REVIEW, events: [anEvent(eventId, text)] } }
        );
      };

      expect(await postFrom(fixtureServer.origin, "ev_from_ip", "typed on 127.0.0.1")).toBe(200);
      expect(await postFrom(localhostOrigin, "ev_from_name", "typed on localhost")).toBe(200);
      // And the re-post every reconnect makes, from the other origin this time.
      // Idempotence is by event_id, so it must not double anything.
      expect(await postFrom(localhostOrigin, "ev_from_ip", "typed on 127.0.0.1")).toBe(200);

      const items = itemEvents(readEventLog(stateDir, REVIEW));
      expect(items).toHaveLength(2);
      expect(items.map((e) => e.event_id).sort()).toEqual(["ev_from_ip", "ev_from_name"]);
      // One log, and the seqs are the helper's, monotonic, with no gaps or ties.
      const seqs = readEventLog(stateDir, REVIEW).map((e) => e.seq);
      expect(seqs).toEqual(seqs.slice().sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);
    } finally {
      await service.kill9();
    }
  });
});
