// THE file:// SPIKE (1A).
//
// The question the plan asks 1A to settle before it closes: can a page opened
// from disk reach the helper at all? A file:// page has a null origin, and the
// browser may refuse the request outright no matter what the helper allows. If
// it cannot, the helper grows a single-file static serve so the built document
// gets a real http origin.
//
// This spec is the evidence behind that answer, and it runs on all three
// browsers so the answer is not a Chromium-only claim. It talks to a throwaway
// echo server rather than to the helper, because the question is about what the
// BROWSER permits, not about what the helper checks. The helper's own checks are
// asserted in harness_second_origin.spec.js.
//
// Read the resolved answer in the architecture, D11, "Resolved (1A spike)".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { test, expect } = require("../helpers");

const protocol = require("../../src/shared/protocol.js");

/** A server that answers everything, records the Origin header it saw, and
 *  offers CORS as generously as a loopback helper ever could. */
async function startEchoServer(options = {}) {
  const seen = [];
  const allowOrigin = options.allowOrigin === undefined ? "null" : options.allowOrigin;

  const server = http.createServer(function (req, res) {
    seen.push({
      method: req.method,
      url: req.url,
      origin: req.headers.origin === undefined ? null : req.headers.origin,
      host: req.headers.host || null,
      client: req.headers[protocol.HEADER.CLIENT] || null
    });
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin"
    };
    if (allowOrigin !== false) {
      headers["Access-Control-Allow-Origin"] = allowOrigin;
      headers["Access-Control-Allow-Headers"] = [
        "content-type",
        protocol.HEADER.CLIENT,
        protocol.HEADER.TOKEN
      ].join(",");
      headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  return {
    port: port,
    origin: "http://127.0.0.1:" + port,
    seen: seen,
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    }
  };
}

/** A document on disk, opened with a file:// URL. */
function writeProbeDocument() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-file-probe-"));
  const file = path.join(dir, "built-doc-probe.html");
  fs.writeFileSync(
    file,
    [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8"><title>file:// probe</title></head>',
      "<body><h1>A document opened from disk</h1>",
      "<script>",
      "window.__probe = async function (url, headers) {",
      "  try {",
      "    const res = await fetch(url, {",
      "      method: 'POST',",
      "      headers: headers,",
      "      body: JSON.stringify({ probe: true })",
      "    });",
      "    return { reached: true, status: res.status };",
      "  } catch (err) {",
      "    return { reached: false, error: String(err && err.message ? err.message : err) };",
      "  }",
      "};",
      "</script></body></html>"
    ].join("\n"),
    "utf8"
  );
  return file;
}

test.describe("the file:// spike", () => {
  test("a page opened from disk tries to reach a loopback helper", async ({ page }, testInfo) => {
    const server = await startEchoServer();
    const file = writeProbeDocument();

    try {
      await page.goto("file://" + file);

      const result = await page.evaluate(
        (args) => window.__probe(args.url, args.headers),
        {
          url: server.origin + protocol.BASE + "/events",
          headers: {
            "Content-Type": protocol.JSON_CONTENT_TYPE,
            [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER,
            [protocol.HEADER.TOKEN]: "probe-token"
          }
        }
      );

      // The verdict, printed so the answer is readable in the test output rather
      // than only in an assertion.
      const verdict = {
        browser: testInfo.project.name,
        reached: result.reached,
        status: result.status || null,
        error: result.error || null,
        requestsTheServerSaw: server.seen.map(function (entry) {
          return entry.method + " origin=" + String(entry.origin);
        })
      };
      // eslint-disable-next-line no-console
      console.log("file:// spike verdict: " + JSON.stringify(verdict));
      await testInfo.attach("file-origin-verdict.json", {
        body: JSON.stringify(verdict, null, 2),
        contentType: "application/json"
      });

      // The answer the architecture's resolved note records: a file:// page DOES
      // reach a loopback helper, on all three browsers, and it presents itself
      // as the literal origin "null". So the per-review token is the working
      // factor there, exactly as D11 already says, and no static-serve fallback
      // is needed. If this ever starts failing, a browser changed its mind and
      // D11's resolved note is the thing to revisit, not this line.
      expect(result.reached).toBe(true);
      expect(result.status).toBe(200);
      const posts = server.seen.filter((entry) => entry.method === "POST");
      expect(posts).toHaveLength(1);
      // The origin arrives as the string "null" (or is absent). Either way it is
      // NOT an http origin, so it can only ever match a registered "null".
      expect(posts[0].origin === null || posts[0].origin === "null").toBe(true);
    } finally {
      await server.close();
    }
  });
});
