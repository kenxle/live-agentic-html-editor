// The app fixture's server: a zero-dependency Node app that behaves like the
// dev server a reviewer actually walks.
//
// Plan task 0C. What exists elsewhere in test/fixtures is a single page that
// reverts text on a timer (repainting.html) and a static document
// (built-doc.html). Neither has a link that navigates, a form that submits, a
// login, three screens, or a morph, and 2D (living in the page), 3A's per-page
// grouping, 3B's dev-server path and AC2 (Ken's dev-server story) all need one
// that does.
//
// Why a server rather than static files: a form that submits and a login that
// gates a screen are both round trips. Faking them in script would make the
// fixture a simulation of an app rather than an app, and the whole point of the
// fixture is that the library has to survive a real one.
//
// Usage:
//
//   const { startAppServer } = require("../fixtures/app/server");
//   const app = await startAppServer();
//   await page.goto(app.urlFor("/?morph=raw"));
//   await app.close();
//
// State (the session, saved notes, the feed cursor) lives in the server
// instance, so a test that wants isolation starts its own.

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const pages = require("./pages");

const ASSET_ROOT = path.join(__dirname, "assets");

const ACCOUNT = { email: "coach@steadythread.test", password: "kettlebell" };

const CLIENT_NAMES = require("./data").CLIENTS.reduce(function (map, client) {
  map[client.slug] = client.name;
  return map;
}, {});

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function readCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce(function (out, part) {
    const eq = part.indexOf("=");
    if (eq === -1) return out;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    return out;
  }, {});
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
      // A fixture is still a server: refuse a body nobody meant to send.
      if (Buffer.concat(chunks).length > 64 * 1024) {
        reject(new Error("request body too large for the app fixture"));
      }
    });
    req.on("error", reject);
    req.on("end", function () {
      resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    });
  });
}

function sendHtml(res, html, extraHeaders) {
  res.writeHead(
    200,
    Object.assign(
      { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      extraHeaders || {}
    )
  );
  res.end(html);
}

function redirect(res, location, extraHeaders) {
  res.writeHead(
    303,
    Object.assign({ Location: location, "Cache-Control": "no-store" }, extraHeaders || {})
  );
  res.end();
}

/**
 * Start the app fixture.
 *
 * @returns {Promise<{origin: string, url: string, port: number,
 *                    urlFor: (p: string) => string, notes: object[],
 *                    close: () => Promise<void>}>}
 */
async function startAppServer() {
  // Server-side state. Small on purpose: it exists so the form and the login
  // are real round trips, not so the fixture becomes an application.
  const state = {
    notes: [],
    sessions: new Map(),
    // Advances on every feed poll, which is what makes each morph observably
    // different from the last one.
    cursor: 0
  };

  const server = http.createServer(function (req, res) {
    handle(req, res).catch(function (err) {
      // Fail loud. A fixture that swallows its own errors turns every test
      // written against it into a coin flip.
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("app fixture error: " + err.message);
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    const searchParams = url.searchParams;
    const cookies = readCookies(req);
    const sessionEmail = state.sessions.get(cookies.app_session) || null;
    const carried = pages.carriedQuery(searchParams);

    if (pathname.startsWith("/assets/")) return serveAsset(pathname, res);

    // The morph engine's poll. Every hit advances the cursor, so the fragment
    // it hands back is never the one the page is already showing.
    if (pathname === "/api/feed" && req.method === "GET") {
      state.cursor += 1;
      sendHtml(res, pages.feedItems(state.cursor));
      return;
    }

    if (pathname === "/" && req.method === "GET") {
      sendHtml(
        res,
        pages.dashboardPage({ searchParams: searchParams, sessionEmail: sessionEmail, cursor: state.cursor })
      );
      return;
    }

    if (pathname === "/clients" && req.method === "GET") {
      sendHtml(
        res,
        pages.clientsPage({ searchParams: searchParams, sessionEmail: sessionEmail, notes: state.notes })
      );
      return;
    }

    if (pathname === "/clients/notes" && req.method === "POST") {
      const form = await readBody(req);
      const slug = form.get("client") || "";
      const body = (form.get("note") || "").trim();
      if (body) {
        state.notes.push({
          clientSlug: slug,
          clientName: CLIENT_NAMES[slug] || slug,
          body: body
        });
      }
      redirect(res, "/clients" + carried);
      return;
    }

    if (pathname === "/login" && req.method === "GET") {
      sendHtml(
        res,
        pages.loginPage({
          searchParams: searchParams,
          next: searchParams.get("next") || "/reports"
        })
      );
      return;
    }

    if (pathname === "/login" && req.method === "POST") {
      const form = await readBody(req);
      const email = (form.get("email") || "").trim();
      const password = form.get("password") || "";
      const next = form.get("next") || "/reports";

      if (email !== ACCOUNT.email || password !== ACCOUNT.password) {
        // Re-render in place with the reason, which is what a real app does and
        // what makes the gate testable as a gate.
        sendHtml(
          res,
          pages.loginPage({
            searchParams: searchParams,
            next: next,
            error: "That email and password do not match an account."
          })
        );
        return;
      }

      const sessionId = crypto.randomBytes(16).toString("hex");
      state.sessions.set(sessionId, email);
      redirect(res, next + carried, {
        "Set-Cookie": "app_session=" + sessionId + "; Path=/; HttpOnly; SameSite=Lax"
      });
      return;
    }

    if (pathname === "/reports" && req.method === "GET") {
      if (!sessionEmail) {
        const query = new URLSearchParams(carried.replace(/^\?/, ""));
        query.set("next", "/reports");
        redirect(res, "/login?" + query.toString());
        return;
      }
      sendHtml(
        res,
        pages.reportsPage({ searchParams: searchParams, sessionEmail: sessionEmail, cursor: state.cursor })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("no such page in the app fixture: " + pathname);
  }

  function serveAsset(pathname, res) {
    const relative = decodeURIComponent(pathname.replace(/^\/assets\/+/, ""));
    const resolved = path.resolve(ASSET_ROOT, relative);
    if (resolved !== ASSET_ROOT && !resolved.startsWith(ASSET_ROOT + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("outside the asset root");
      return;
    }
    fs.readFile(resolved, function (err, body) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("no such asset: " + relative);
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(body);
    });
  }

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
    account: ACCOUNT,
    state: state,
    urlFor: function (target) {
      const suffix = String(target || "/");
      return origin + (suffix.startsWith("/") ? suffix : "/" + suffix);
    },
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    }
  };
}

module.exports = { startAppServer, ACCOUNT, ASSET_ROOT };
