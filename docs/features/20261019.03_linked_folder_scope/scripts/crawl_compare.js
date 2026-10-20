// The real-site no-regression check (spec V12, task 5).
//
// Starts one helper from each checkout on its own temp COPY of the sites
// registry, crawls the same sites over HTTP on both, and writes one row per
// address with both status codes. It fails when any address answers 200 on the
// base checkout and 404 on the branch, or when a link that is a link on the
// base checkout is plain text on the branch.
//
// It never touches the real helper (port 7817) or the real state folder: it
// only READS ~/.local/state/lahe/sites.json and sites.log, copies them into a
// fresh temp folder per helper, and every helper it starts uses that folder.
// The copy holds no pids: sites.json has none, and no review, session or
// service file is copied. Both helpers are stopped at the end by the pid in
// their own state folder's service.json, and on any error.
//
// Usage:
//   node crawl_compare.js <branch-checkout> <base-checkout> <out.csv> <site-name>...
//
// A site name is a key of sites.json (for example feature-forge-runbooks).
// The crawl is: every Markdown file under the site's root, then every address
// under /.lahe-source/ any fetched page names (href, src, srcset, CSS url()),
// page after page, until no new address turns up.
//
// To read the result: the last lines print "regressions: N" and
// "plain-text links lost: N". Both must be 0.

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const [branchRepo, baseRepo, outCsv, ...siteNames] = process.argv.slice(2);
if (!branchRepo || !baseRepo || !outCsv || !siteNames.length) {
  console.error("usage: node crawl_compare.js <branch-checkout> <base-checkout> <out.csv> <site-name>...");
  process.exit(2);
}

// LAHE_CRAWL_SOURCE_STATE points the copy at a different registry; it exists
// so the script can be tried on a made-up one.
const REAL_STATE = process.env.LAHE_CRAWL_SOURCE_STATE || path.join(os.homedir(), ".local", "state", "lahe");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function get(port, host, pathAndQuery) {
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1", port, path: pathAndQuery, method: "GET", headers: { host }, agent: false,
      // A top-level page load, so the answer is the one a browser tab gets.
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: String(res.headers["content-type"] || ""), body: Buffer.concat(chunks) }));
    });
    req.on("error", (err) => resolve({ status: 0, type: "", body: Buffer.from(String(err.message)) }));
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function waitHealthy(port, label) {
  for (let i = 0; i < 100; i += 1) {
    const res = await get(port, "127.0.0.1:" + port, "/");
    if (res.status !== 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(label + ": the helper did not answer on port " + port);
}

async function startHelper(repo, label) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-crawl-" + label + "-"));
  if (path.resolve(state) === path.resolve(REAL_STATE)) throw new Error("refusing to use the real state folder");
  for (const name of ["sites.json", "sites.log"]) {
    const from = path.join(REAL_STATE, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(state, name));
  }
  const apiPort = await freePort();
  const pagesPort = await freePort();
  const child = childProcess.spawn(process.execPath, [path.join(repo, "bin", "lahe.js"), "serve", "--state-dir", state, "--port", String(apiPort)], {
    env: Object.assign({}, process.env, {
      LAHE_STATE_DIR: state,
      LAHE_PAGES_PORT: String(pagesPort),
      LAHE_DIRECT_LAUNCH: "off"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let said = "";
  child.stdout.on("data", (c) => { said += c; });
  child.stderr.on("data", (c) => { said += c; });
  await waitHealthy(apiPort, label);
  return { label, repo, state, apiPort, pagesPort, child, said: () => said };
}

function stopHelper(helper) {
  if (!helper) return;
  let pid = helper.child.pid;
  try {
    const ready = JSON.parse(fs.readFileSync(path.join(helper.state, "service.json"), "utf8"));
    if (Number.isInteger(ready.pid)) pid = ready.pid;
  } catch (err) { /* the child's own pid stands */ }
  for (const one of new Set([pid, helper.child.pid])) {
    try { process.kill(one, "SIGTERM"); } catch (err) { /* already gone */ }
  }
}

function walkMarkdown(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { continue; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) out.push(full);
    }
  }
  return out.sort();
}

function addressesIn(text, type, pageUrl) {
  const out = new Set();
  const consider = (value) => {
    if (!value) return;
    let url;
    try { url = new URL(value.replace(/&amp;/g, "&"), "http://site.test" + pageUrl); } catch (err) { return; }
    if (url.host !== "site.test") return;
    if (!url.pathname.startsWith("/.lahe-source/")) return;
    out.add(url.pathname);
  };
  const attr = /\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = attr.exec(text))) {
    const value = m[2] !== undefined ? m[2] : m[3];
    if (m[1].toLowerCase() === "srcset") value.split(",").forEach((part) => consider(part.trim().split(/\s+/)[0]));
    else consider(value);
  }
  const css = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  while ((m = css.exec(text))) consider(m[1]);
  return out;
}

function plainTextLinks(html) {
  return (html.match(/class="lahe-local-link"/g) || []).length;
}

async function crawl(helper, name, root) {
  const rows = new Map();
  const queue = [];
  const host = name + ".lahe.localhost:" + helper.pagesPort;
  for (const file of walkMarkdown(root)) {
    queue.push("/" + path.relative(root, file).split(path.sep).map(encodeURIComponent).join("/"));
  }
  let plain = 0;
  while (queue.length) {
    const address = queue.shift();
    if (rows.has(address)) continue;
    const res = await get(helper.pagesPort, host, address);
    const isPage = /text\/html/.test(res.type);
    const text = isPage || /text\/css/.test(res.type) ? res.body.toString("utf8") : "";
    const lost = isPage ? plainTextLinks(text) : 0;
    rows.set(address, { status: res.status, plain: lost });
    plain += lost;
    if (res.status === 200 && text) {
      for (const next of addressesIn(text, res.type, address)) if (!rows.has(next)) queue.push(next);
    }
  }
  return { rows, plain };
}

async function main() {
  const sites = JSON.parse(fs.readFileSync(path.join(REAL_STATE, "sites.json"), "utf8")).sites;
  let branch = null;
  let base = null;
  const lines = ["site,address,base_status,branch_status,base_plain_links,branch_plain_links"];
  let regressions = 0;
  let lost = 0;
  try {
    branch = await startHelper(branchRepo, "branch");
    base = await startHelper(baseRepo, "base");
    for (const name of siteNames) {
      if (!sites[name]) throw new Error("no site named " + name + " in sites.json");
      const root = sites[name].root;
      const [onBranch, onBase] = [await crawl(branch, name, root), await crawl(base, name, root)];
      const addresses = new Set([...onBase.rows.keys(), ...onBranch.rows.keys()]);
      for (const address of Array.from(addresses).sort()) {
        const a = onBase.rows.get(address) || { status: "", plain: 0 };
        const b = onBranch.rows.get(address) || { status: "", plain: 0 };
        if (a.status === 200 && b.status !== 200) regressions += 1;
        if (b.plain > a.plain) lost += b.plain - a.plain;
        lines.push([JSON.stringify(name), JSON.stringify(address), a.status, b.status, a.plain, b.plain].join(","));
      }
      console.log(name + ": " + addresses.size + " addresses; base plain-text links " + onBase.plain + ", branch " + onBranch.plain);
    }
  } finally {
    stopHelper(branch);
    stopHelper(base);
  }
  fs.writeFileSync(outCsv, lines.join("\n") + "\n");
  console.log("rows written to " + outCsv);
  console.log("regressions: " + regressions);
  console.log("plain-text links lost: " + lost);
  process.exitCode = regressions === 0 && lost === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 2;
});
