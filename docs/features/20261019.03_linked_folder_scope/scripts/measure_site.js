// Walk a real Lahe site the way a reviewer's browser would, and list every
// file the rendered pages reference under a /.lahe-source/ mount.
//
// Read-only: the real sites.json is only read; renders write nothing.
// Usage: node measure_site.js <repo> <siteName> <outCsv>
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [repo, siteName, outCsv] = process.argv.slice(2);
const links = require(path.join(repo, "src/service/markdown_links.js"));
const markdown = require(path.join(repo, "src/service/markdown.js"));

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".local/state/lahe/sites.json"), "utf8"));
const site = raw.sites[siteName];
if (!site) throw new Error("no site " + siteName);
const mounts = Object.assign({}, site.mounts || {});
const startMounts = Object.keys(mounts).length;
const root = site.root;

function within(c, r) { return c === r || c.indexOf(r + path.sep) === 0; }
function realOr(p) { try { return fs.realpathSync(p); } catch (e) { return null; } }
function urlDirOf(prefix, base, file) {
  const rel = path.relative(base, path.dirname(file));
  const segs = rel ? rel.split(path.sep).map(encodeURIComponent) : [];
  return prefix + segs.map((s) => s + "/").join("");
}
function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".html" || ext === ".htm") return "html";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(ext)) return "image";
  if ([".css", ".js", ".mjs", ".woff2"].includes(ext)) return "asset";
  return "other";
}

const rows = [];
const seen = new Set();
const rendered = new Set();
const queue = [];
let skipped = 0;
let rootPages = 0;
const attrNames = {};
const byPage = {};

function refsIn(html) {
  const out = [];
  const re = /\b(href|src|srcset|poster|data|action)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].toLowerCase();
    if (name === "srcset") m[2].split(",").forEach((part) => out.push({ attr: name, value: part.trim().split(/\s+/)[0] }));
    else out.push({ attr: name, value: m[2] });
  }
  const css = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  while ((m = css.exec(html))) out.push({ attr: "css-url", value: m[1] });
  return out;
}

function note(fromFile, urlDir, ref) {
  let u;
  try { u = new URL(ref.value.replace(/&amp;/g, "&"), "http://site.test" + urlDir); } catch (e) { return; }
  if (u.host !== "site.test") return;
  const m = /^(\/\.lahe-source\/[a-f0-9]+\/)(.*)$/.exec(u.pathname);
  if (!m) return;
  attrNames[ref.attr] = (attrNames[ref.attr] || 0) + 1;
  const base = mounts[m[1]];
  let rel;
  try { rel = decodeURIComponent(m[2]); } catch (e) { rel = m[2]; }
  const key = m[1] + rel;
  if (base) {
    const realRef = realOr(path.join(base, rel));
    if (realRef) { (byPage[fromFile] = byPage[fromFile] || new Set()).add(realRef); }
  }
  if (seen.has(key)) return;
  seen.add(key);
  const file = base ? path.join(base, rel) : null;
  const real = file ? realOr(file) : null;
  const exists = !!real && within(real, realOr(base) || base) && fs.statSync(real).isFile();
  const row = { prefix: m[1], mount_dir: base || "", rel, attr: ref.attr, kind: kindOf(rel), exists, from: fromFile,
    in_link_dir: "" };
  rows.push(row);
  if (exists && row.kind === "markdown") queue.push({ file: real, prefix: m[1], base });
  if (exists && row.kind === "html") queue.push({ file: real, prefix: m[1], base, html: true });
}

function renderOne(file, prefix, base, isHtml) {
  const id = prefix + "|" + file;
  if (rendered.has(id)) return;
  rendered.add(id);
  const urlDir = urlDirOf(prefix, base, file);
  let html;
  if (isHtml) {
    html = fs.readFileSync(file, "utf8");
  } else {
    const reg = links.createRegistry({ mounts: Object.assign({}, mounts, { "/": root }) });
    try { html = markdown.renderPage(file, { assetPrefix: urlDir, links: reg, note: "" }).html; } catch (e) { return; }
    reg.added.forEach((a) => { mounts[a.prefix] = a.dir; });
    skipped += reg.skipped;
  }
  refsIn(html).forEach((r) => note(file, urlDir, r));
  // A linked HTML page's stylesheets reference fonts and images too.
  if (isHtml) {
    refsIn(html).filter((r) => /\.css(\?|$)/.test(r.value)).forEach((r) => {
      let u; try { u = new URL(r.value, "http://site.test" + urlDir); } catch (e) { return; }
      const mm = /^(\/\.lahe-source\/[a-f0-9]+\/)(.*)$/.exec(u.pathname);
      if (!mm || !mounts[mm[1]]) return;
      const cssFile = realOr(path.join(mounts[mm[1]], decodeURIComponent(mm[2])));
      if (!cssFile) return;
      const cssDir = u.pathname.replace(/[^/]*$/, "");
      refsIn(fs.readFileSync(cssFile, "utf8")).forEach((x) => note(cssFile, cssDir, x));
    });
  }
}

(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(md|markdown)$/i.test(e.name)) { rootPages += 1; renderOne(p, "/", root, false); }
  }
})(root);
while (queue.length) {
  const next = queue.shift();
  renderOne(next.file, next.prefix, next.base, !!next.html);
}

// Files each used mount folder holds today, all of which it serves now.
const used = Array.from(new Set(rows.filter((r) => r.mount_dir).map((r) => r.mount_dir)));
let treeFiles = 0;
let treeCapped = false;
const LIMIT = 500000;
for (const dir of used) {
  (function walk(d) {
    if (treeFiles > LIMIT) { treeCapped = true; return; }
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else treeFiles += 1;
    }
  })(dir);
}

const header = "site,prefix,mount_dir,rel,attr,kind,exists,from\n";
fs.writeFileSync(outCsv, header + rows.map((r) => [siteName, r.prefix, r.mount_dir, r.rel, r.attr, r.kind, r.exists, r.from]
  .map((v) => JSON.stringify(String(v))).join(",")).join("\n") + "\n");

const by = (pred) => rows.filter(pred).length;
console.log(JSON.stringify({
  site: siteName,
  root,
  markdown_pages_under_root: rootPages,
  mounts_in_sites_json: startMounts,
  mounts_after_walk: Object.keys(mounts).length,
  links_past_cap: skipped,
  pages_rendered_total: rendered.size,
  distinct_files_referenced_under_mounts: rows.length,
  existing: by((r) => r.exists),
  missing: by((r) => !r.exists),
  existing_by_kind: ["markdown", "html", "image", "asset", "other"].reduce((o, k) => { o[k] = by((r) => r.exists && r.kind === k); return o; }, {}),
  mount_folders_referenced: used.length,
  files_in_those_mount_trees_today: treeFiles + (treeCapped ? "+ (stopped at limit)" : ""),
  attributes_seen_under_mounts: attrNames,
  linking_pages: Object.keys(byPage).length,
  most_files_one_page_links: Math.max(0, ...Object.values(byPage).map((x) => x.size)),
  distinct_real_files_linked: new Set([].concat(...Object.values(byPage).map((x) => Array.from(x)))).size,
  bytes_keyed_by_page: JSON.stringify(Object.fromEntries(Object.entries(byPage).map(([k, v]) => [k, Array.from(v)]))).length,
  bytes_flat_list: JSON.stringify(Array.from(new Set([].concat(...Object.values(byPage).map((x) => Array.from(x)))))).length
}, null, 2));
