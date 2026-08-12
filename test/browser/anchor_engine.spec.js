// The anchor engine (task 1C) against a real DOM, in a real browser.
//
// test/unit/anchor_engine.test.js runs the same bar over a simulated DOM, which
// is fast and jsdom-free. It cannot prove the engine reads a real document
// correctly: real textContent carries the whitespace between tags, real element
// children are live collections, and a real page has a head, scripts, and an
// svg in it. That is what this file is for.
//
// The pages: test/fixtures/built-doc.html (the static reviewed document, which
// deliberately holds three identical list items and two identical paragraphs in
// different containers) and the multi-page app fixture in test/fixtures/app/,
// whose content morphs under the engine's feet.
//
// The library modules are loaded as plain script tags, the way the built bundle
// loads them, in the manifest's dependency order. dist/ is never built here:
// builders do not commit it, and a browser test that depended on it would go
// stale against its own source.

"use strict";

const path = require("path");
const { test, expect } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const SRC = path.resolve(__dirname, "..", "..", "src");

const LAYER_SCRIPTS = [
  "shared/markers.js",
  "shared/normalize.js",
  "shared/uniqueness.js",
  "shared/regions.js",
  "layer/anchor.js"
];

async function loadEngine(page) {
  for (const relative of LAYER_SCRIPTS) {
    await page.addScriptTag({ path: path.join(SRC, relative) });
  }
  // The engine has to be there before anything asserts on its verdicts;
  // otherwise a typo in a path reads as a failed anchor.
  expect(await page.evaluate(() => typeof window.LAHE.anchor.mint)).toBe("function");
}

// Everything below drives the engine from inside the page, because the whole
// point is that it runs against live nodes. Verdicts come back as plain data,
// and node identity is asserted in the page with ===, never by comparing
// serialized markup.

test.describe("anchor engine: a real document", () => {
  test("binds a unique region, and keeps binding it after the page is rewritten around it", async ({
    page,
    fixtureServer
  }) => {
    await page.goto(fixtureServer.urlFor("built-doc.html"));
    await loadEngine(page);

    const minted = await page.evaluate(() => {
      const element = document.getElementById("plan-4");
      const ref = window.LAHE.anchor.mint({ element: element, root: document.body });
      window.__anchor = { ref: ref, node: element };
      return ref;
    });
    expect(minted.ok).toBe(true);
    expect(minted.probe).toBe("Run four easy miles on Tuesday");

    // Every transformation the plan names, applied to a real document, one
    // after another. The bar after each: the same node, or an honest failure.
    const results = await page.evaluate(() => {
      const anchor = window.LAHE.anchor;
      const ref = window.__anchor.ref;
      const node = window.__anchor.node;
      const out = [];

      function record(label) {
        const verdict = anchor.resolve(ref, document.body);
        out.push({
          label: label,
          bound: verdict.bound,
          reason: verdict.reason,
          failureCode: verdict.failureCode,
          sameNode: verdict.element === node,
          wrongNode: verdict.bound && verdict.element !== node
        });
      }

      record("untouched");

      // 1. Whitespace expansion, then collapse, on the region and its neighbours.
      const list = document.getElementById("plan-list");
      Array.from(list.children).forEach((li) => {
        li.textContent = "\n\t  " + li.textContent.replace(/ /g, "   ") + "  \n";
      });
      record("whitespace expanded");
      Array.from(list.children).forEach((li) => {
        li.textContent = li.textContent.replace(/\s+/g, " ").trim();
      });
      record("whitespace collapsed");

      // 2. Sibling blocks reordered: the last item moves to the front.
      list.insertBefore(list.lastElementChild, list.firstElementChild);
      record("siblings reordered");

      // 3. A duplicate paragraph inserted elsewhere on the page.
      const duplicate = document.createElement("p");
      duplicate.textContent = node.textContent;
      document.body.appendChild(duplicate);
      record("duplicate inserted elsewhere");
      duplicate.remove();

      // 4. A neighbouring block deleted.
      const neighbour = node.nextElementSibling || node.previousElementSibling;
      neighbour.remove();
      record("neighbour deleted");

      // 5. A wrapper element added around the region.
      const wrapper = document.createElement("div");
      node.parentNode.insertBefore(wrapper, node);
      wrapper.appendChild(node);
      record("wrapper added");

      return out;
    });

    for (const r of results) {
      expect(r.wrongNode, `${r.label}: resolved to a DIFFERENT node, the one forbidden outcome`).toBe(false);
      if (!r.bound) {
        expect(typeof r.failureCode, `${r.label}: an honest failure names its code`).toBe("string");
      }
    }
    // These five are not allowed to merely fail honestly: the region is still
    // uniquely there in every one of them.
    const mustBind = ["untouched", "whitespace expanded", "whitespace collapsed", "neighbour deleted", "wrapper added"];
    for (const label of mustBind) {
      const r = results.find((x) => x.label === label);
      expect(r.bound, `${label}: ${r.reason}`).toBe(true);
      expect(r.sameNode, `${label}: bound to the wrong node`).toBe(true);
    }
  });

  test("two identical paragraphs in different containers are told apart by their context", async ({
    page,
    fixtureServer
  }) => {
    // built-doc.html holds the same sentence in #container-a and #container-b.
    // Each is an only child, so the context has to be read from the container,
    // not from inside it. This is the case the label rules call a collision.
    await page.goto(fixtureServer.urlFor("built-doc.html"));
    await loadEngine(page);

    const result = await page.evaluate(() => {
      const anchor = window.LAHE.anchor;
      const b = document.getElementById("problem-b");
      const ref = anchor.mint({ element: b, root: document.body });
      const verdict = anchor.resolve(ref, document.body);
      return {
        minted: ref.ok,
        failure: ref.failure,
        bound: verdict.bound,
        reason: verdict.reason,
        boundToB: verdict.element === b,
        boundToA: verdict.element === document.getElementById("problem-a")
      };
    });

    expect(result.minted, JSON.stringify(result.failure)).toBe(true);
    expect(result.bound).toBe(true);
    expect(result.boundToB).toBe(true);
    expect(result.boundToA).toBe(false);
  });

  test("three identical list items: each binds to itself, and never to one of the others", async ({
    page,
    fixtureServer
  }) => {
    // built-doc.html's plan list opens with the same sentence three times. They
    // are not indistinguishable: what follows each one differs, and widening
    // finds that. This asserts the outcome that matters, which is that no item
    // ever binds to a different item.
    await page.goto(fixtureServer.urlFor("built-doc.html"));
    await loadEngine(page);

    const results = await page.evaluate(() => {
      const anchor = window.LAHE.anchor;
      return ["plan-1", "plan-2", "plan-3"].map((id) => {
        const element = document.getElementById(id);
        const ref = anchor.mint({ element: element, root: document.body });
        const verdict = ref.ok ? anchor.resolve(ref, document.body) : null;
        return {
          id: id,
          minted: ref.ok,
          failure: ref.failure,
          bound: verdict ? verdict.bound : false,
          boundToItself: verdict ? verdict.element === element : false,
          boundToAnother: verdict ? verdict.bound && verdict.element !== element : false
        };
      });
    });

    for (const r of results) {
      expect(r.boundToAnother, `${r.id}: bound to a DIFFERENT identical item`).toBe(false);
      if (r.minted) {
        expect(r.bound, r.id).toBe(true);
        expect(r.boundToItself, r.id).toBe(true);
      } else {
        expect(typeof r.failure.failureCode, `${r.id}: an honest failure names its code`).toBe("string");
      }
    }
  });

  test("a region whose context is symmetric with a copy of itself: mint fails honestly", async ({
    page,
    fixtureServer
  }) => {
    // The dangerous case D9 exists for: two exact copies, each with the same
    // neighbours on both sides, all the way out to the containing block. Any
    // scalar score rates both high and picks one. Widening cannot separate
    // them, so mint refuses rather than minting a reference that will bind to
    // whichever copy the search happens to reach first.
    await page.goto(fixtureServer.urlFor("built-doc.html"));
    await loadEngine(page);

    const result = await page.evaluate(() => {
      const section = document.createElement("section");
      ["A lead-in line.", "The repeated region.", "A trailing line.", "A lead-in line.", "The repeated region.", "A trailing line."].forEach(
        (text) => {
          const p = document.createElement("p");
          p.textContent = text;
          section.appendChild(p);
        }
      );
      document.body.appendChild(section);

      const first = section.children[1];
      const ref = window.LAHE.anchor.mint({ element: first, root: section });
      return { ok: ref.ok, failure: ref.failure };
    });

    expect(result.ok, "position could pick one; D9 says position never places a write").toBe(false);
    expect(result.failure.reason).toBe("not_unique_in_containing_block");
    expect(result.failure.failureCode).toBe("ANCHOR_AMBIGUOUS");
  });

  test("occurrence four of five survives the deletion of occurrence two", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("built-doc.html"));
    await loadEngine(page);

    const result = await page.evaluate(() => {
      const anchor = window.LAHE.anchor;

      // Five copies of one sentence, each with its own neighbours, appended to
      // the real document so the engine walks a real page around them.
      const section = document.createElement("section");
      const occurrences = [];
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].forEach((day, i) => {
        const lead = document.createElement("p");
        lead.textContent = "Session " + (i + 1) + " is on " + day + ".";
        section.appendChild(lead);
        const repeated = document.createElement("p");
        repeated.textContent = "Warm up for ten minutes";
        section.appendChild(repeated);
        occurrences.push(repeated);
        const tail = document.createElement("p");
        tail.textContent = "Then cool down and log the " + day + " session.";
        section.appendChild(tail);
      });
      document.body.appendChild(section);

      const target = occurrences[3];
      const ref = anchor.mint({ element: target, root: section });
      const before = anchor.resolve(ref, section);

      occurrences[1].remove();
      const after = anchor.resolve(ref, section);

      return {
        minted: ref.ok,
        failure: ref.failure,
        beforeBound: before.bound,
        beforeSame: before.element === target,
        afterBound: after.bound,
        afterReason: after.reason,
        afterSame: after.element === target
      };
    });

    expect(result.minted, JSON.stringify(result.failure)).toBe(true);
    expect(result.beforeBound).toBe(true);
    expect(result.beforeSame).toBe(true);
    expect(result.afterBound, result.afterReason).toBe(true);
    expect(result.afterSame, "bound to occurrence four, not to whatever shifted into its place").toBe(true);
  });

  test("a region on the morphing app fixture survives the app's own re-render", async ({ page }) => {
    // The engine's whole reason to exist: the page rewrites itself, the nodes
    // are replaced, and the reference still finds the region. Nothing is stored
    // on the node, so nothing is lost when the node is.
    const app = await startAppServer();
    try {
      await page.goto(app.urlFor("/"));
      await loadEngine(page);

      const minted = await page.evaluate(() => {
        const anchor = window.LAHE.anchor;
        const feed = document.querySelector("[data-region]") || document.querySelector("p");
        const ref = anchor.mint({ element: feed, root: document.body });
        window.__ref = ref;
        window.__text = feed.textContent.replace(/\s+/g, " ").trim();
        return { ok: ref.ok, failure: ref.failure, probe: ref.probe };
      });
      expect(minted.ok, JSON.stringify(minted.failure)).toBe(true);

      const after = await page.evaluate(() => {
        const anchor = window.LAHE.anchor;
        const verdict = anchor.resolve(window.__ref, document.body);
        return {
          bound: verdict.bound,
          reason: verdict.reason,
          failureCode: verdict.failureCode,
          text: verdict.element ? verdict.element.textContent.replace(/\s+/g, " ").trim() : null
        };
      });

      if (after.bound) {
        expect(after.text).toBe(minted.probe);
      } else {
        expect(typeof after.failureCode).toBe("string");
      }
    } finally {
      await app.close();
    }
  });
});
