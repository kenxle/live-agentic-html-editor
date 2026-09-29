// src/layer/blocks.js: the DOM block rules in one copy (free-writing plan
// Task 1.3). Editing, replay, undo and protection all find the insert point,
// the host, and a record's run on the live page through these functions.
//
// The page loads only the four files blocks.js needs (markers, normalize,
// record, blocks), straight from src/, so this spec tests the source and needs
// no bundle rebuild.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, startStaticServer } = require("../helpers");
const normalize = require("../../src/shared/normalize.js");
const corpus = require("../fixtures/free_writing/corpus.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");
const SCRIPTS = ["src/shared/markers.js", "src/shared/normalize.js", "src/shared/record.js", "src/layer/blocks.js"];

let server = null;

test.beforeAll(async () => {
  server = await startStaticServer({ root: FIXTURES });
});

test.afterAll(async () => {
  if (server) await server.close();
});

async function open(page, fixture) {
  await page.goto(server.urlFor(fixture));
  for (const file of SCRIPTS) await page.addScriptTag({ path: path.join(REPO_ROOT, file) });
  await page.waitForFunction(() => !!(window.LAHE && window.LAHE.blocks));
}

function htmlFixtures(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFixtures(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out.sort();
}

function stringShape(html) {
  return normalize.leafBlocks(html).map((l) => l.tag + ": " + l.words);
}

test("insertPointAfter an h2 on the Markdown render is after its sheet-head, and its host is the section", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const h2 = document.querySelector("section h2");
    const point = b.insertPointAfter(h2);
    return {
      parentTag: point.parent.tagName.toLowerCase(),
      parentIsSection: point.parent === h2.closest("section"),
      // The point may sit before whitespace; the next element is what follows it.
      beforeText: (function () {
        let n = point.before;
        while (n && n.nodeType !== 1) n = n.nextSibling;
        return n && n.textContent.trim();
      })(),
      hostIsSection: b.hostFor(h2) === h2.closest("section")
    };
  });
  expect(got.parentIsSection).toBe(true);
  expect(got.beforeText).toBe("We stopped measuring motion and started measuring outcomes.");
  expect(got.hostIsSection).toBe(true);
});

test("insertPointAfter a paragraph is right after it, in its own parent", async ({ page }) => {
  await open(page, "free_writing/blog.html");
  const got = await page.evaluate(() => {
    const p = document.getElementById("p1");
    const point = window.LAHE.blocks.insertPointAfter(p);
    let next = point.before;
    while (next && next.nodeType !== 1) next = next.nextSibling;
    return { parent: point.parent.id, before: next && next.id, host: window.LAHE.blocks.hostFor(p).id };
  });
  expect(got).toEqual({ parent: "post", before: "h2", host: "post" });
});

test("startPointIn(main) on the empty notes page is after the marked title", async ({ page }) => {
  await open(page, "free_writing/empty_notes.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const main = document.querySelector("main");
    const point = b.startPointIn(main);
    const title = document.querySelector("h1");
    // Where the point is, relative to the title.
    const r = document.createRange();
    r.setStart(point.parent, point.before ? Array.prototype.indexOf.call(point.parent.childNodes, point.before) : point.parent.childNodes.length);
    return {
      parentIsMain: point.parent === main,
      afterTitle: r.comparePoint(title, 0) === -1,
      hostIsMain: b.hostFor(main) === main
    };
  });
  expect(got).toEqual({ parentIsMain: true, afterTitle: true, hostIsMain: true });
});

test("the DOM walk and the string reader agree on every page under test/fixtures", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  for (const file of htmlFixtures(FIXTURES)) {
    const source = fs.readFileSync(file, "utf8");
    const dom = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return window.LAHE.blocks.leafWalk(doc.documentElement).map((el) => {
        return el.tagName.toLowerCase() + ": " + window.LAHE.normalize.blockWords(window.LAHE.normalize.cleanMarkup(el.innerHTML));
      });
    }, source);
    expect(dom, path.relative(FIXTURES, file)).toEqual(stringShape(source));
  }
});

test("the DOM walk and the string reader agree on the malformed corpus", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  for (const sample of corpus.MALFORMED) {
    const dom = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString("<!doctype html><body>" + html + "</body>", "text/html");
      return window.LAHE.blocks.leafWalk(doc.body).map((el) => {
        return el.tagName.toLowerCase() + ": " + window.LAHE.normalize.blockWords(window.LAHE.normalize.cleanMarkup(el.innerHTML));
      });
    }, sample.html);
    expect(dom, sample.name).toEqual(stringShape(sample.html));
  }
});

test("leafWalk from an insert point reads only what comes after it", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const h2 = document.querySelector("section h2");
    return b.leafWalk(document.body, b.insertPointAfter(h2)).map((el) => el.textContent.trim().slice(0, 12));
  });
  expect(got).toEqual(["We stopped m", "A second par", "What comes n", "Fewer meetin"]);
});

test("runElementsFor finds a placed run one-to-one", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const h2 = document.querySelector("section h2");
    const record = {
      placement: "after_anchor",
      new_blocks: [
        { tag: "p", html: "We stopped measuring motion and started measuring outcomes." },
        { tag: "p", html: "A second paragraph in the first section." }
      ]
    };
    const found = b.runElementsFor(record, document, h2);
    const ps = document.querySelectorAll("section:first-of-type > p");
    return {
      statuses: found.blocks.map((x) => x.status),
      same: found.blocks[0].elements[0] === ps[0] && found.blocks[1].elements[0] === ps[1],
      startIsSection: found.start.parent === h2.closest("section")
    };
  });
  expect(got).toEqual({ statuses: ["whole", "whole"], same: true, startIsSection: true });
});

test("runElementsFor reports a missing block", async ({ page }) => {
  await open(page, "free_writing/md_render.html");
  const got = await page.evaluate(() => {
    const h2 = document.querySelector("section h2");
    const record = {
      placement: "after_anchor",
      new_blocks: [
        { tag: "p", html: "We stopped measuring motion and started measuring outcomes." },
        { tag: "p", html: "This paragraph was never placed by the agent." }
      ]
    };
    return window.LAHE.blocks.runElementsFor(record, document, h2).blocks.map((x) => [x.status, x.elements.length]);
  });
  expect(got).toEqual([["whole", 1], ["missing", 0]]);
});

test("runElementsFor works for a container anchor", async ({ page }) => {
  await open(page, "free_writing/empty_notes.html");
  const got = await page.evaluate(() => {
    const main = document.querySelector("main");
    const h2 = document.createElement("h2");
    h2.textContent = "First heading";
    const p = document.createElement("p");
    p.textContent = "Notes under it";
    main.appendChild(h2);
    main.appendChild(p);
    const record = {
      placement: "start_of_container",
      new_blocks: [{ tag: "h2", html: "First heading" }, { tag: "p", html: "Notes under it" }]
    };
    const found = window.LAHE.blocks.runElementsFor(record, document, main);
    return found.blocks.map((x) => x.status + ":" + (x.elements[0] === (x.index === 0 ? h2 : p)));
  });
  expect(got).toEqual(["whole:true", "whole:true"]);
});

test("runElementsFor matches remove_blocks for a take-back", async ({ page }) => {
  await open(page, "free_writing/blog.html");
  const got = await page.evaluate(() => {
    const p1 = document.getElementById("p1");
    const record = { placement: "after_anchor", remove_blocks: [{ tag: "h2", html: "What changed" }] };
    const found = window.LAHE.blocks.runElementsFor(record, document, p1);
    return found.blocks.map((x) => x.status + ":" + (x.elements[0] && x.elements[0].id));
  });
  expect(got).toEqual(["whole:h2"]);
});

test("canHoldRun is false in a td and a figcaption, and true in an article", async ({ page }) => {
  await open(page, "free_writing/blog.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    document.body.insertAdjacentHTML(
      "beforeend",
      "<table><tr><td><p id='inCell'>cell words</p></td><td id='bareCell'>bare cell</td></tr></table>" +
        "<figure><img alt=''><figcaption id='cap'>A caption</figcaption></figure>"
    );
    return {
      td: b.canHoldRun(document.getElementById("inCell")),
      bareTd: b.canHoldRun(document.getElementById("bareCell")),
      figcaption: b.canHoldRun(document.getElementById("cap")),
      article: b.canHoldRun(document.getElementById("p1"))
    };
  });
  expect(got).toEqual({ td: false, bareTd: false, figcaption: false, article: true });
});

test("swapTag keeps the stamp and the children, and refuses a tag outside the six", async ({ page }) => {
  await open(page, "free_writing/blog.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const p = document.getElementById("p2");
    p.setAttribute("data-lahe-id", "stamp1");
    const strong = p.querySelector("strong");
    const swapped = b.swapTag(p, "h2");
    return {
      tag: swapped.tagName.toLowerCase(),
      stamp: swapped.getAttribute("data-lahe-id"),
      id: swapped.id,
      sameChild: swapped.querySelector("strong") === strong,
      inPage: document.getElementById("p2") === swapped,
      refused: b.swapTag(swapped, "script"),
      refusedDiv: b.swapTag(swapped, "div"),
      stillH2: document.getElementById("p2").tagName.toLowerCase()
    };
  });
  expect(got).toEqual({ tag: "h2", stamp: "stamp1", id: "p2", sameChild: true, inPage: true, refused: null, refusedDiv: null, stillH2: "h2" });
});

test("writeBlock builds a cleaned block, and refuses script", async ({ page }) => {
  await open(page, "free_writing/blog.html");
  const got = await page.evaluate(() => {
    const b = window.LAHE.blocks;
    const el = b.writeBlock("p", 'Fish &amp; <b onclick="x()">chips</b> &lt;3<br>');
    const list = b.writeBlock("ul", "<li>One</li><li>Two</li>");
    return {
      html: el.outerHTML,
      list: list.outerHTML,
      script: b.writeBlock("script", "alert(1)"),
      forged: b.writeBlock("p", "<img src=x onerror=alert(1)>")
    };
  });
  expect(got).toEqual({
    html: "<p>Fish &amp; <strong>chips</strong> &lt;3</p>",
    list: "<ul><li>One</li><li>Two</li></ul>",
    script: null,
    forged: null
  });
});
