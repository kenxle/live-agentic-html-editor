// Static servers for fixtures, including the CSP variants and the second origin.
//
// Zero dependencies, node:http only, ephemeral ports.
//
// Why serve fixtures at all instead of using file:// URLs:
//
//   - A real Content-Security-Policy is a response header. A meta tag cannot
//     express every directive, and the failure worth testing is the one a real
//     app's real header produces.
//   - A file:// page has an opaque origin, so browser storage behaves nothing
//     like it does in the case the tool actually ships into (D5).
//   - The second-origin tests need a genuinely different origin, which is what a
//     second port on 127.0.0.1 gives.

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8"
};

// The two CSP variants. Both keep img-src open to data: so the built-doc
// fixture's inline chart still renders and the test fails for the reason it is
// about rather than a missing picture.
const CSP_POLICIES = {
  // The layer runs. Its loopback calls do not. This is "the app's CSP refused
  // the sync", which D5 requires be named distinctly from service-down.
  "block-connect":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'",
  // The layer's script tag never executes. This is "the app's CSP refused the
  // layer".
  "block-script":
    "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
};

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * Start a static file server.
 *
 * @param {{root?: string, csp?: 'block-connect'|'block-script'|string|null,
 *          label?: string, headers?: Record<string,string>}} [options]
 *   `csp` takes one of the named variants above, or a raw policy string, or null
 *   for no header at all.
 * @returns {Promise<{url: string, origin: string, port: number, label: string,
 *                    urlFor: (p: string) => string, close: () => Promise<void>}>}
 */
async function startStaticServer(options = {}) {
  const root = options.root || FIXTURE_ROOT;
  const label = options.label || "fixtures";
  const cspHeader = options.csp ? CSP_POLICIES[options.csp] || options.csp : null;

  const server = http.createServer(function (req, res) {
    const requested = new URL(req.url, "http://127.0.0.1").pathname;
    const relative = decodeURIComponent(requested).replace(/^\/+/, "");
    const resolved = path.resolve(root, relative || "index.html");

    // Containment check. A fixture server is still a server.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("outside the fixture root");
      return;
    }

    fs.readFile(resolved, function (err, body) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found: " + relative);
        return;
      }
      const headers = Object.assign(
        {
          "Content-Type": contentTypeFor(resolved),
          "Cache-Control": "no-store"
        },
        options.headers || {}
      );
      if (cspHeader) headers["Content-Security-Policy"] = cspHeader;
      res.writeHead(200, headers);
      res.end(body);
    });
  });

  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const origin = "http://127.0.0.1:" + port;

  return {
    port: port,
    origin: origin,
    url: origin,
    label: label,
    root: root,
    csp: cspHeader,
    urlFor: function (relativePath) {
      return origin + "/" + String(relativePath).replace(/^\/+/, "");
    },
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
        // A page that is still open holds keep-alive sockets, and server.close()
        // waits for them: a test-scoped server closing while its page lives hangs
        // until the test times out. Found on WebKit under load (2D), and the same
        // line the app fixture's server carries.
        server.closeAllConnections();
      });
    }
  };
}

/** The plain fixture server, no CSP header. */
async function startFixtureServer(options = {}) {
  return startStaticServer(Object.assign({ label: "fixtures" }, options));
}

/**
 * A fixture server that sends a real CSP header.
 * @param {'block-connect'|'block-script'|string} variant
 */
async function startCspServer(variant, options = {}) {
  if (!variant) throw new Error("startCspServer: name a variant, one of " + Object.keys(CSP_POLICIES).join(", "));
  return startStaticServer(Object.assign({ label: "csp:" + variant, csp: variant }, options));
}

/**
 * A second origin. Serves the same fixture directory from a different port, so
 * attacker.html is genuinely cross-origin to whatever the fixture server serves.
 */
async function startAttackerServer(options = {}) {
  return startStaticServer(Object.assign({ label: "attacker" }, options));
}

module.exports = {
  FIXTURE_ROOT,
  CSP_POLICIES,
  startStaticServer,
  startFixtureServer,
  startCspServer,
  startAttackerServer
};
