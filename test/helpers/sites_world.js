// A helper serving stable addresses, for unit tests of sites, Host dispatch,
// page serving and binding (docs/features/20261011.02_stable_addresses).
//
// Everything lives under one temp folder: a fake home (so names never read
// the real one), the state folder, and the documents. The helper runs in this
// process on free ports, never 7817 or 1483, and every test closes it in
// teardown through t.after, which runs even when the test fails.

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const service = require("../../src/service/index.js");

function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-sites-")));
}

/** A file, with its folders made. Returns the absolute path. */
function writeFile(base, rel, text) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

/**
 * @param {object} t the node:test context, for teardown
 * @param {{pages?: string|null, helper?: object}} [options] `pages` is the
 *   switch value ("sites" by default; null leaves it off)
 */
async function sitesWorld(t, options) {
  const opts = options || {};
  const root = tempRoot();
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const serveOptions = Object.assign({
    port: 0,
    stateDir: state,
    quiet: true,
    pages: opts.pages === undefined ? "sites" : opts.pages,
    pagesPort: opts.pagesPort === undefined ? 0 : opts.pagesPort,
    sitesHome: home
  }, opts.helper || {});
  // Markdown links outside the home folder render inert, and the home folder
  // is LAHE_HOME_DIR when it is set: point it at this world's home for the
  // test, and put it back after.
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  t.after(() => {
    if (priorHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = priorHome;
  });
  const helper = await service.serve(serveOptions);
  t.after(() => helper.close());
  return { root, home, state, helper };
}

/** One raw request. Headers are sent exactly as given: no Host is added. */
function raw(port, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: opts.address || "127.0.0.1",
        port: port,
        method: opts.method || "GET",
        path: opts.path || "/",
        headers: opts.headers || {},
        setHost: false
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch (err) { json = null; }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

/** The Host a site's page has on this helper. */
function siteHost(world, name) {
  return name + ".lahe.localhost:" + world.helper.pagesPort;
}

/** GET a path on a site, over the pages listener. */
function getPage(world, name, pagePath, extraHeaders) {
  return raw(world.helper.pagesPort, {
    path: pagePath,
    headers: Object.assign({ host: siteHost(world, name) }, extraHeaders || {})
  });
}

module.exports = { tempRoot, writeFile, sitesWorld, raw, siteHost, getPage };
