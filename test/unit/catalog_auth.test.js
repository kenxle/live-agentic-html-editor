// The Library's credential and its per-route checks (LAHE Library, Task 1.2).
//
// Architecture: docs/features/20260922.02_lahe_library/02_architecture_lahe_library.md,
// Security & Privacy Notes, the per-route check table. The D11 amendment is in
// docs/CONTRACTS.md.
//
// Every test here runs a real helper on port 0 against a temporary state dir,
// and speaks raw HTTP through node:http so it controls every header the way a
// hostile page or process could (Host, Origin and Sec-Fetch-Site included).
// Nothing uses port 7817 or the real state dir.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDirModule = require("../../src/service/state_dir.js");
const markdown = require("../../src/service/markdown.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REVIEW = "review-cat-1";
// A document under review on another loopback port: the page most likely to run
// a script the reviewer did not write.
const OTHER_LOOPBACK = "http://127.0.0.1:5555";

const PAGE = protocol.route("catalog.page");
const ASSET = protocol.route("catalog.asset");
const API_ROUTES = ["catalog.list", "catalog.open", "catalog.star", "catalog.request"].map(protocol.route);
const POST_ROUTES = API_ROUTES.filter((r) => r.method === "POST");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-catalog-auth-"));
}

async function startHelper(dir) {
  return service.serve({
    port: 0,
    stateDir: dir || tempDir(),
    reviews: [REVIEW],
    origins: [OTHER_LOOPBACK],
    quiet: true
  });
}

/** One raw request. Headers are sent exactly as given: no Host is added. */
function raw(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: port,
        method: options.method || "GET",
        path: options.path,
        headers: options.headers || {},
        setHost: false
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(buf.toString("utf8"));
          } catch (err) {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, buf: buf, text: buf.toString("utf8"), json: json });
        });
      }
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function hostOf(port) {
  return "127.0.0.1:" + port;
}

function stripUndefined(h) {
  Object.keys(h).forEach((k) => {
    if (h[k] === undefined) delete h[k];
  });
  return h;
}

function pageHeaders(port, extra) {
  return stripUndefined(Object.assign({ host: hostOf(port), "sec-fetch-site": "none" }, extra || {}));
}

function apiHeaders(port, token, r, extra) {
  const h = {
    host: hostOf(port),
    "sec-fetch-site": "same-origin",
    [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
    [protocol.HEADER.TOKEN]: token
  };
  if (r.method === "POST") {
    h["content-type"] = protocol.JSON_CONTENT_TYPE;
    h.origin = "http://" + hostOf(port);
  }
  return stripUndefined(Object.assign(h, extra || {}));
}

function callApi(port, token, r, extra) {
  return raw(port, {
    method: r.method,
    path: r.path,
    headers: apiHeaders(port, token, r, extra),
    body: r.method === "POST" ? JSON.stringify({ review: REVIEW }) : undefined
  });
}

function tokenFromPage(html) {
  const re = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"');
  const m = re.exec(html);
  return m ? m[1] : null;
}

async function libraryToken(port) {
  const res = await raw(port, { path: PAGE.path, headers: pageHeaders(port) });
  assert.equal(res.status, 200, "the page loads with Sec-Fetch-Site: none and no custom header");
  const token = tokenFromPage(res.text);
  assert.ok(token && token.length >= 32, "the page carries a Library token in its meta tag");
  return token;
}

function reviewToken(helper) {
  return helper.reviews.config().reviews[REVIEW].token;
}

function hasCorsHeader(headers) {
  return Object.keys(headers).some((k) => k.toLowerCase().indexOf("access-control-") === 0);
}

// ---------------------------------------------------------------------------
// catalog.page and catalog.asset
// ---------------------------------------------------------------------------

test("catalog.page and catalog.asset accept Sec-Fetch-Site none or same-origin with no custom header", async () => {
  const helper = await startHelper();
  try {
    for (const p of [PAGE.path, ASSET.path + "page.js"]) {
      for (const site of ["none", "same-origin"]) {
        const res = await raw(helper.port, { path: p, headers: pageHeaders(helper.port, { "sec-fetch-site": site }) });
        assert.equal(res.status, 200, p + " with Sec-Fetch-Site " + site);
      }
    }
  } finally {
    await helper.close();
  }
});

test("catalog.page and catalog.asset refuse same-site, cross-site, a missing Sec-Fetch-Site, and a wrong Host", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    for (const p of [PAGE.path, ASSET.path + "page.js"]) {
      for (const site of ["same-site", "cross-site", undefined]) {
        const res = await raw(port, { path: p, headers: pageHeaders(port, { "sec-fetch-site": site }) });
        assert.equal(res.status, 403, p + " with Sec-Fetch-Site " + site);
        assert.equal(res.json.error.code, "PROTO_CROSS_SITE");
        assert.equal(res.json.error.check, protocol.CHECK.SEC_FETCH_SITE);
        assert.equal(tokenFromPage(res.text), null, "a refusal never carries the token");
      }
      for (const host of ["evil.test:" + port, "127.0.0.1:" + (port + 1), "[::1]:" + port, "127.0.0.1", undefined]) {
        const res = await raw(port, { path: p, headers: pageHeaders(port, { host: host }) });
        assert.equal(res.status, 400, p + " with Host " + String(host));
        if (host === undefined) {
          // Node's own parser refuses an HTTP/1.1 request with no Host before
          // any handler runs, so there is no body at all.
          assert.equal(res.text, "");
          continue;
        }
        assert.equal(res.json.error.code, "PROTO_BAD_HOST");
        assert.equal(tokenFromPage(res.text), null);
      }
    }
    // localhost at the helper's own port is the helper too.
    const ok = await raw(port, { path: PAGE.path, headers: pageHeaders(port, { host: "localhost:" + port }) });
    assert.equal(ok.status, 200);
  } finally {
    await helper.close();
  }
});

// ---------------------------------------------------------------------------
// The API routes
// ---------------------------------------------------------------------------

/**
 * Did this answer come from the route's handler rather than the check block?
 * A check refusal always names its check; a handler's own answer never does.
 * (The handlers themselves are tested in catalog_routes.test.js.)
 */
function reachedHandler(res) {
  return res.status !== 501 && !(res.json && res.json.error && res.json.error.check);
}

test("catalog.list, open, star and request pass the checks with the Library token and reach their handlers", async () => {
  const helper = await startHelper();
  try {
    const token = await libraryToken(helper.port);
    for (const r of API_ROUTES) {
      const res = await callApi(helper.port, token, r);
      assert.ok(reachedHandler(res), r.name + " reaches its handler: " + res.status + " " + res.text);
      assert.equal(hasCorsHeader(res.headers), false, r.name + " sends no CORS header");
    }
  } finally {
    await helper.close();
  }
});

test("the API routes refuse cross-site, same-site, a missing Sec-Fetch-Site, a missing client header, and a wrong or empty token", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    const token = await libraryToken(port);
    const cases = [
      { extra: { "sec-fetch-site": "cross-site" }, status: 403, check: protocol.CHECK.SEC_FETCH_SITE },
      { extra: { "sec-fetch-site": "same-site" }, status: 403, check: protocol.CHECK.SEC_FETCH_SITE },
      { extra: { "sec-fetch-site": "none" }, status: 403, check: protocol.CHECK.SEC_FETCH_SITE },
      { extra: { "sec-fetch-site": undefined }, status: 403, check: protocol.CHECK.SEC_FETCH_SITE },
      { extra: { [protocol.HEADER.CLIENT]: undefined }, status: 400, check: protocol.CHECK.CUSTOM_HEADER },
      { extra: { [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER }, status: 400, check: protocol.CHECK.CUSTOM_HEADER },
      { extra: { [protocol.HEADER.TOKEN]: "x" + token.slice(1) }, status: 401, check: protocol.CHECK.TOKEN },
      { extra: { [protocol.HEADER.TOKEN]: "" }, status: 401, check: protocol.CHECK.TOKEN },
      { extra: { [protocol.HEADER.TOKEN]: undefined }, status: 401, check: protocol.CHECK.TOKEN },
      { extra: { host: "evil.test:" + port }, status: 400, check: protocol.CHECK.HOST }
    ];
    for (const r of API_ROUTES) {
      for (const c of cases) {
        const res = await callApi(port, token, r, c.extra);
        assert.equal(res.status, c.status, r.name + " " + JSON.stringify(c.extra));
        assert.equal(res.json.error.check, c.check, r.name + " " + JSON.stringify(c.extra));
        assert.equal(hasCorsHeader(res.headers), false);
      }
    }
  } finally {
    await helper.close();
  }
});

test("the POSTs refuse text/plain, a missing Origin, Origin null, another port, and localhost against a 127.0.0.1 Host", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    const token = await libraryToken(port);
    const cases = [
      { extra: { "content-type": "text/plain" }, status: 415, check: protocol.CHECK.CONTENT_TYPE },
      { extra: { origin: undefined }, status: 403, check: protocol.CHECK.ORIGIN },
      { extra: { origin: "null" }, status: 403, check: protocol.CHECK.ORIGIN },
      { extra: { origin: "http://127.0.0.1:" + (port + 1) }, status: 403, check: protocol.CHECK.ORIGIN },
      { extra: { origin: OTHER_LOOPBACK }, status: 403, check: protocol.CHECK.ORIGIN },
      { extra: { origin: "http://localhost:" + port }, status: 403, check: protocol.CHECK.ORIGIN },
      { extra: { origin: "https://127.0.0.1:" + port }, status: 403, check: protocol.CHECK.ORIGIN }
    ];
    for (const r of POST_ROUTES) {
      for (const c of cases) {
        const res = await callApi(port, token, r, c.extra);
        assert.equal(res.status, c.status, r.name + " " + JSON.stringify(c.extra));
        assert.equal(res.json.error.check, c.check, r.name + " " + JSON.stringify(c.extra));
      }
      // The exact Origin follows the Host: localhost against a localhost Host passes.
      const viaLocalhost = await callApi(port, token, r, {
        host: "localhost:" + port,
        origin: "http://localhost:" + port
      });
      assert.ok(reachedHandler(viaLocalhost), r.name + " from localhost to localhost: " + viaLocalhost.text);
    }
  } finally {
    await helper.close();
  }
});

test("OPTIONS on every catalog route gets no approval headers, even from an origin a review registered", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    const paths = [PAGE.path, ASSET.path + "page.js"].concat(API_ROUTES.map((r) => r.path));
    for (const p of paths) {
      for (const origin of [OTHER_LOOPBACK, "http://" + hostOf(port)]) {
        const res = await raw(port, {
          method: "OPTIONS",
          path: p,
          headers: {
            host: hostOf(port),
            origin: origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": [protocol.HEADER.CLIENT, protocol.HEADER.TOKEN].join(",")
          }
        });
        assert.notEqual(res.status, 204, "OPTIONS " + p + " from " + origin);
        assert.equal(hasCorsHeader(res.headers), false, "OPTIONS " + p + " from " + origin + " approves nothing");
      }
    }
    // A review route's preflight still works for its registered origin.
    const review = await raw(port, {
      method: "OPTIONS",
      path: protocol.route("review.read").path,
      headers: { host: hostOf(port), origin: OTHER_LOOPBACK }
    });
    assert.equal(review.status, 204);
  } finally {
    await helper.close();
  }
});

test("a review token cannot call a catalog route, and the Library token cannot call a review route", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    const libToken = await libraryToken(port);
    const revToken = reviewToken(helper);
    assert.notEqual(libToken, revToken);

    const list = protocol.route("catalog.list");
    const withReviewToken = await callApi(port, revToken, list);
    assert.equal(withReviewToken.status, 401);
    assert.equal(withReviewToken.json.error.check, protocol.CHECK.TOKEN);
    const withReviewClient = await callApi(port, revToken, list, { [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER });
    assert.equal(withReviewClient.status, 400);

    const read = protocol.route("review.read");
    const asCatalog = await raw(port, {
      path: read.path + "?review=" + REVIEW,
      headers: {
        host: hostOf(port),
        origin: OTHER_LOOPBACK,
        [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
        [protocol.HEADER.TOKEN]: libToken
      }
    });
    assert.equal(asCatalog.status, 400);
    assert.equal(asCatalog.json.error.check, protocol.CHECK.CUSTOM_HEADER);
    const asLayer = await raw(port, {
      path: read.path + "?review=" + REVIEW,
      headers: {
        host: hostOf(port),
        origin: OTHER_LOOPBACK,
        [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER,
        [protocol.HEADER.TOKEN]: libToken
      }
    });
    assert.equal(asLayer.status, 401);
    assert.equal(asLayer.json.error.check, protocol.CHECK.TOKEN);

    // And the review's own token still reads its review.
    const own = await raw(port, {
      path: read.path + "?review=" + REVIEW,
      headers: {
        host: hostOf(port),
        origin: OTHER_LOOPBACK,
        [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER,
        [protocol.HEADER.TOKEN]: revToken
      }
    });
    assert.equal(own.status, 200);
  } finally {
    await helper.close();
  }
});

// ---------------------------------------------------------------------------
// What the page response carries
// ---------------------------------------------------------------------------

test("the page has no CORS header, carries the script, frame, referrer and no-store policies, and holds the token in a meta tag", async () => {
  const helper = await startHelper();
  try {
    const res = await raw(helper.port, { path: PAGE.path, headers: pageHeaders(helper.port) });
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /^text\/html/);
    assert.equal(hasCorsHeader(res.headers), false);
    const csp = String(res.headers["content-security-policy"] || "");
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");

    const token = tokenFromPage(res.text);
    assert.ok(token);
    // Every script is loaded by src; none is inline, so script-src 'self' holds.
    const scripts = res.text.match(/<script\b[^>]*>/g) || [];
    assert.ok(scripts.length > 0, "the page loads its script");
    scripts.forEach((tag) => assert.match(tag, /\bsrc="/));
    assert.equal(res.text.split(token).length - 1, 1, "the token appears once, in the meta tag");
    assert.ok(res.text.indexOf(ASSET.path + "page.js") !== -1, "the page loads page.js from catalog.asset");
    assert.ok(res.text.indexOf(ASSET.path + "protocol.js") !== -1, "the page loads protocol.js from catalog.asset");
  } finally {
    await helper.close();
  }
});

test("catalog.asset serves each allowlisted file with its content type, and nothing else", async () => {
  const helper = await startHelper();
  const port = helper.port;
  try {
    const catalogPage = require("../../src/service/catalog_page.js");
    const names = Object.keys(catalogPage.ASSETS);
    // The allowlist is the architecture's, exactly.
    assert.deepEqual(
      names.slice().sort(),
      ["page.js", "protocol.js", "view_model.js", markdown.DOC_STYLE_ASSET]
        .concat(markdown.FONT_ASSETS.map((f) => markdown.FONT_ASSET_DIR + "/" + f))
        .sort()
    );
    const expectType = {
      "protocol.js": /^application\/javascript/,
      "page.js": /^application\/javascript/,
      "view_model.js": /^application\/javascript/,
      [markdown.DOC_STYLE_ASSET]: /^text\/css/
    };
    markdown.FONT_ASSETS.forEach((f) => (expectType[markdown.FONT_ASSET_DIR + "/" + f] = /^font\/woff2$/));

    for (const name of names) {
      const res = await raw(port, { path: ASSET.path + name, headers: pageHeaders(port, { "sec-fetch-site": "same-origin" }) });
      const source = catalogPage.ASSETS[name].file;
      if (source && !fs.existsSync(source)) {
        // view_model.js is Task 2.2's file. Until it lands the name is allowed
        // and simply absent: a 404, never another file's bytes.
        assert.equal(name, "view_model.js", name + " must exist");
        assert.equal(res.status, 404);
        continue;
      }
      assert.equal(res.status, 200, name);
      assert.match(String(res.headers["content-type"]), expectType[name], name);
      assert.equal(hasCorsHeader(res.headers), false, name);
      assert.equal(res.headers["x-content-type-options"], "nosniff", name);
      const expected = source ? fs.readFileSync(source) : Buffer.from(markdown.styleSheet(), "utf8");
      assert.ok(res.buf.equals(expected), name + " bytes are the source file's");
    }
  } finally {
    await helper.close();
  }
});

test("catalog.asset returns 404 with no file bytes for ../, %2e%2e%2f, an absolute path, and package.json", async () => {
  const helper = await startHelper();
  const port = helper.port;
  const pkg = fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
  const marker = JSON.parse(pkg).name;
  const passwdish = fs.readFileSync(path.join(REPO_ROOT, "src", "service", "index.js"), "utf8").slice(0, 60);
  try {
    const attempts = [
      "../package.json",
      "../../package.json",
      "../../../package.json",
      "%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json",
      "%2e%2e%2fpackage.json",
      "%2e%2e%2f%2e%2e%2fpackage.json",
      "%2e%2e/%2e%2e/package.json",
      "..%2f..%2fpackage.json",
      "/" + path.join(REPO_ROOT, "package.json"),
      encodeURIComponent(path.join(REPO_ROOT, "package.json")),
      "package.json",
      "../../src/service/index.js",
      "catalog/page.js",
      "./page.js",
      "page.js/",
      "PAGE.JS",
      ".lahe-fonts/../../package.json",
      ""
    ];
    for (const a of attempts) {
      const res = await raw(port, { path: ASSET.path + a, headers: pageHeaders(port, { "sec-fetch-site": "same-origin" }) });
      assert.equal(res.status, 404, JSON.stringify(a));
      assert.equal(res.text.indexOf(marker + '"'), -1, JSON.stringify(a) + " leaked package.json");
      assert.equal(res.text.indexOf(passwdish), -1, JSON.stringify(a) + " leaked a source file");
    }
  } finally {
    await helper.close();
  }
});

// ---------------------------------------------------------------------------
// The token's life
// ---------------------------------------------------------------------------

function everyFile(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("the token changes across a helper restart and is written nowhere: no state file, not the helper log, not health, not catalog.list", async () => {
  const dir = tempDir();
  const first = await startHelper(dir);
  let firstToken;
  const seen = [];
  try {
    firstToken = await libraryToken(first.port);
    // A full run: every route, good and refused, so every log line is written.
    for (const r of API_ROUTES) {
      seen.push((await callApi(first.port, firstToken, r)).text);
      seen.push((await callApi(first.port, firstToken, r, { "sec-fetch-site": "same-site" })).text);
      seen.push((await callApi(first.port, firstToken, r, { [protocol.HEADER.TOKEN]: firstToken + "x" })).text);
    }
    const health = await raw(first.port, { path: protocol.route("health").path, headers: { host: hostOf(first.port) } });
    seen.push(health.text);
  } finally {
    await first.close();
  }

  const second = await startHelper(dir);
  let secondToken;
  try {
    secondToken = await libraryToken(second.port);
    const stale = await callApi(second.port, firstToken, protocol.route("catalog.list"));
    assert.equal(stale.status, 401, "the old token is refused after a restart");
    seen.push(stale.text);
  } finally {
    await second.close();
  }

  assert.notEqual(firstToken, secondToken, "a new helper mints a new token");
  const logPath = stateDirModule.helperLogPath(dir);
  assert.ok(fs.existsSync(logPath), "the helper log was written");
  for (const file of everyFile(dir)) {
    const text = fs.readFileSync(file, "latin1");
    for (const t of [firstToken, secondToken]) {
      assert.equal(text.indexOf(t), -1, "token found in " + path.relative(dir, file));
    }
  }
  for (const body of seen) {
    assert.equal(body.indexOf(firstToken), -1, "token found in a response: " + body.slice(0, 200));
  }
});

test("health reports catalog_seen_at: null until an authenticated list, then the time the helper recorded", async () => {
  const helper = await startHelper();
  try {
    const healthPath = protocol.route("health").path;
    const before = await raw(helper.port, { path: healthPath, headers: { host: hostOf(helper.port) } });
    assert.equal(before.status, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(before.json, protocol.HEALTH_FIELD.CATALOG_SEEN_AT));
    assert.equal(before.json[protocol.HEALTH_FIELD.CATALOG_SEEN_AT], null);

    // Task 2.1's list handler calls this on an authenticated list. The seam is
    // the helper's catalog state, which takes `now` like every Library clock.
    const at = new Date("2026-09-28T16:00:00Z");
    helper.catalog.markSeen(at);
    const after = await raw(helper.port, { path: healthPath, headers: { host: hostOf(helper.port) } });
    assert.equal(after.json[protocol.HEALTH_FIELD.CATALOG_SEEN_AT], at.toISOString());
    assert.equal(after.text.indexOf(helper.catalog.token), -1, "health never carries the token");
  } finally {
    await helper.close();
  }
});

test("a refused catalog.list does not update catalog_seen_at", async () => {
  const helper = await startHelper();
  try {
    await callApi(helper.port, "wrong", protocol.route("catalog.list"));
    await callApi(helper.port, helper.catalog.token, protocol.route("catalog.list"), { "sec-fetch-site": "same-site" });
    assert.equal(helper.catalog.seenAt(), null);
  } finally {
    await helper.close();
  }
});
