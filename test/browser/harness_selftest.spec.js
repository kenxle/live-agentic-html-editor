// Self-tests for the browser test harness.
//
// The harness is the thing every other builder writes their tests against, so it
// gets tested itself, and specifically it gets tested in BOTH directions. Each
// of the two hard assertions has a positive half (it passes when the behavior is
// there) and a negative half (it throws when the behavior is switched off). A
// positive half on its own proves nothing: an assertion that can never fail
// passes every time and catches nothing, which is exactly how the tool being
// replaced ended up with no coverage where it hurts.
//
// The negative halves switch behavior off through the stub's configure(), which
// is the harness's stand-in for the one-line deliberate revert the plan requires
// of every builder.

const {
  test,
  expect,
  assertCaretSurvivesTyping,
  assertCaretRestoredAcrossRepaints,
  assertNoSecondWrite,
  assertCaretUnmoved,
  captureCaret,
  placeCaret,
  compareCaret,
  typeInto,
  focusRegion,
  enableEditing,
  commitRegion,
  configureStub,
  replayTimes,
  regionText,
  configureFixture,
  forceRepaint,
  forceRepaints,
  startRepaints,
  stopRepaints,
  readCounters,
  waitForCounter,
  observeMutations,
  openTwoContexts,
  openTwoTabs
} = require("../helpers");

const TEN = "0123456789";

async function openRepainting(page, fixtureServer, knobs = {}) {
  await page.goto(fixtureServer.urlFor("repainting.html"));
  await page.waitForFunction(function () {
    return !!(window.__lahe && window.__lahe.ready && window.__lahe.fixture);
  });
  await configureFixture(page, Object.assign({ target: '[data-repaint-target="live"]' }, knobs));
  await enableEditing(page);
  return page;
}

// ---------------------------------------------------------------------------
// Fixture pages
// ---------------------------------------------------------------------------

test.describe("fixture pages", () => {
  test("the built-doc fixture has the shapes the anchoring tests need", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("built-doc.html"));

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h2")).toHaveCount(2);
    await expect(page.locator("#plan-list li")).toHaveCount(5);
    await expect(page.locator("#photo")).toBeVisible();
    await expect(page.locator("#diagram svg")).toBeVisible();

    // Three byte-identical list items: the case Law 1 has to fail closed on.
    const repeated = await page.evaluate(() =>
      ["#plan-1", "#plan-2", "#plan-3"].map((sel) => document.querySelector(sel).textContent)
    );
    expect(new Set(repeated).size).toBe(1);

    // Two identical paragraphs in different containers under one heading. Two
    // records, never one; the collision is a named shipped bug in the tool being
    // replaced.
    const twins = await page.evaluate(() => ({
      a: document.querySelector("#problem-a").textContent,
      b: document.querySelector("#problem-b").textContent,
      sameContainer: document.querySelector("#problem-a").parentElement === document.querySelector("#problem-b").parentElement
    }));
    expect(twins.a).toBe(twins.b);
    expect(twins.sameContainer).toBe(false);
  });

  test("the css-reset fixture really does hide markers and strip link styling", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("css-reset.html"));

    const styles = await page.evaluate(() => {
      const list = getComputedStyle(document.querySelector("#reset-list"));
      const link = getComputedStyle(document.querySelector("#reset-link"));
      const body = getComputedStyle(document.querySelector("#reset-intro"));
      return {
        listStyleType: list.listStyleType,
        listPaddingLeft: list.paddingLeft,
        linkDecoration: link.textDecorationLine,
        linkColor: link.color,
        bodyColor: body.color
      };
    });

    expect(styles.listStyleType).toBe("none");
    expect(styles.listPaddingLeft).toBe("0px");
    expect(styles.linkDecoration).toBe("none");
    // Link color inherits, so it matches body text. A created link will be
    // invisible as a link on this page, and per D12 that is correct: the tool
    // confirms the change through its own layer and leaves the artifact alone.
    expect(styles.linkColor).toBe(styles.bodyColor);
  });

  test("the repainting fixture writes the server's content back over an edit", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off" });

    const original = await regionText(page, "#live-note");
    await page.evaluate(() => {
      document.querySelector("#live-note").textContent = "typed by the reviewer";
    });
    expect(await regionText(page, "#live-note")).toBe("typed by the reviewer");

    await forceRepaint(page);
    expect(await regionText(page, "#live-note")).toBe(original);
  });

  test("the repaint engine only touches the subtree the test points it at", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off" });

    await page.evaluate(() => {
      document.querySelector("#sidebar-note").textContent = "changed in the sidebar";
      document.querySelector("#static-note").textContent = "changed outside every target";
    });

    await forceRepaint(page);

    // The engine is pointed at the live frame, so both of these survive.
    expect(await regionText(page, "#sidebar-note")).toBe("changed in the sidebar");
    expect(await regionText(page, "#static-note")).toBe("changed outside every target");

    // Point it at the sidebar and the sidebar reverts, the static block does not.
    await configureFixture(page, { target: '[data-repaint-target="sidebar"]' });
    await forceRepaint(page);
    expect(await regionText(page, "#sidebar-note")).toBe("Two clients have not accepted the invite yet.");
    expect(await regionText(page, "#static-note")).toBe("changed outside every target");
  });
});

// ---------------------------------------------------------------------------
// Repaint flavors
// ---------------------------------------------------------------------------

test.describe("forceRepaint flavors", () => {
  test("turbo-frame destroys the text node; react-text keeps it and wipes the text", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off" });

    // Tag the live text node so we can ask afterwards whether it is the same one.
    async function markNode() {
      return page.evaluate(() => {
        const node = document.querySelector("#live-note").firstChild;
        window.__laheTest = window.__laheTest || {};
        window.__laheTest.markedNode = node;
        return node.nodeValue;
      });
    }
    async function nodeSurvived() {
      return page.evaluate(() => document.querySelector("#live-note").firstChild === window.__laheTest.markedNode);
    }

    await markNode();
    await page.evaluate(() => {
      document.querySelector("#live-note").firstChild.nodeValue = "reviewer text one";
    });
    await forceRepaint(page, { flavor: "turbo-frame" });
    expect(await nodeSurvived()).toBe(false);

    await markNode();
    await page.evaluate(() => {
      document.querySelector("#live-note").firstChild.nodeValue = "reviewer text two";
    });
    const original = await page.evaluate(() => window.__lahe.stub.records().length >= 0);
    expect(original).toBe(true);
    await forceRepaint(page, { flavor: "react-text" });
    // Same node, and the reviewer's text is gone anyway. This is why node
    // identity on its own is not the caret assertion.
    expect(await nodeSurvived()).toBe(true);
    expect(await regionText(page, "#live-note")).not.toContain("reviewer text two");
  });

  test("a vetoed repaint still counts, so a test can tell veto from breakage", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await focusRegion(page, "#live-note");
    await placeCaret(page, { selector: "#live-note", offset: 4 });
    await page.keyboard.type("XY", { delay: 10 });

    const before = await readCounters(page);
    await forceRepaint(page);
    const after = await readCounters(page);

    expect(after.repaints).toBe(before.repaints + 1);
    expect(after.repaintsVetoed).toBe(before.repaintsVetoed + 1);
    expect(await regionText(page, "#live-note")).toContain("XY");
  });
});

// ---------------------------------------------------------------------------
// assertCaretUnmoved
// ---------------------------------------------------------------------------

test.describe("assertCaretUnmoved", () => {
  test("passes across a repaint of a subtree the caret is not in", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off", target: '[data-repaint-target="sidebar"]' });

    await focusRegion(page, "#live-note");
    await placeCaret(page, { selector: "#live-note", offset: 10 });
    const caret = await captureCaret(page);

    await forceRepaints(page, 3);

    await assertCaretUnmoved(page, caret);
  });

  test("passes across a repaint the protection vetoes", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await focusRegion(page, "#live-note");
    await placeCaret(page, { selector: "#live-note", offset: 10 });
    // The region is protected on focus, so the repaint flows around it.
    const caret = await captureCaret(page);

    await forceRepaints(page, 3);

    await assertCaretUnmoved(page, caret);
  });

  test("throws when a repaint destroys the node the caret was in", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off" });

    await focusRegion(page, "#live-note");
    await placeCaret(page, { selector: "#live-note", offset: 10 });
    const caret = await captureCaret(page);

    await forceRepaint(page, { flavor: "turbo-frame" });

    let thrown = null;
    try {
      await assertCaretUnmoved(page, caret);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "assertCaretUnmoved must fail when the caret's node was destroyed").not.toBeNull();
    expect(thrown.message).toMatch(/DIFFERENT node|removed from the document/);

    // And the reason it is worth comparing by identity rather than by path: the
    // repaint left a lookalike behind. A fresh text node holding the same
    // characters sits at the same path inside an element with the same id, so an
    // assertion written against a path or an id would have passed here.
    const report = await compareCaret(page, caret);
    const lookalike = await page.evaluate(() => {
      const node = document.querySelector("#live-note").firstChild;
      return { isTextNode: node.nodeType === 3, text: node.nodeValue };
    });
    expect(lookalike.isTextNode).toBe(true);
    expect(lookalike.text).toBe(report.captured.text);
    expect(report.captured.connected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE CARET ASSERTION (plan test #1)
// ---------------------------------------------------------------------------

test.describe("assertCaretSurvivesTyping", () => {
  test("ten characters at 50ms survive a 200ms turbo-frame repaint", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto", flavor: "turbo-frame" });

    const result = await assertCaretSurvivesTyping(page, {
      selector: "#live-note",
      text: TEN,
      keystrokeDelayMs: 50,
      repaintIntervalMs: 200,
      minReplayPasses: 5
    });

    expect(result.actual).toBe(result.expected);
    expect(result.replayPasses).toBeGreaterThanOrEqual(5);
    expect(result.repaints).toBeGreaterThanOrEqual(5);
  });

  test("and survives a real per-element morph, where the rest of the frame does re-render", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto", flavor: "morph" });

    // Change the neighbouring paragraph so the morph has real work to do inside
    // the same frame. If the frame were being skipped wholesale, this would
    // still say "changed"; it must be reverted while the edited region is not.
    await page.evaluate(() => {
      document.querySelector("#live-second").firstChild.nodeValue = "changed, and the morph should revert this";
    });

    const result = await assertCaretSurvivesTyping(page, {
      selector: "#live-note",
      text: TEN,
      keystrokeDelayMs: 50,
      repaintIntervalMs: 200,
      minReplayPasses: 5
    });

    expect(result.actual).toBe(result.expected);
    expect(await regionText(page, "#live-second")).toBe(
      "Dana moved her long run to Saturday because of the weather."
    );
    const counters = await readCounters(page);
    expect(counters.repaintsVetoed).toBeGreaterThanOrEqual(5);
  });

  test("and survives a react-text repaint too", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto", flavor: "react-text" });

    const result = await assertCaretSurvivesTyping(page, {
      selector: "#live-note",
      text: TEN,
      keystrokeDelayMs: 50,
      repaintIntervalMs: 200,
      minReplayPasses: 5
    });

    expect(result.actual).toBe(result.expected);
  });

  test("throws under a morph when nothing vetoes the edited region", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off", flavor: "morph" });
    await configureStub(page, { protectOnEdit: false });

    let thrown = null;
    try {
      await assertCaretSurvivesTyping(page, {
        selector: "#live-note",
        text: TEN,
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "an unvetoed morph must fail the caret assertion").not.toBeNull();
    // The morph writes nodeValue in place, so the text node is alive and the
    // caret is technically still in it. Only the text check catches this, which
    // is the case that would slip past a node-identity-only assertion.
    expect(thrown.message).toContain("does not read as expected");
  });

  test("throws when the repaint is allowed to run under the caret", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off", flavor: "turbo-frame" });
    await configureStub(page, { protectOnEdit: false });

    let thrown = null;
    try {
      await assertCaretSurvivesTyping(page, {
        selector: "#live-note",
        text: TEN,
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "the caret assertion must fail when nothing protects the region").not.toBeNull();
    expect(thrown.message).toContain("assertCaretSurvivesTyping failed");
  });

  test("throws when replay never runs, so a no-op implementation cannot pass", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto", flavor: "turbo-frame" });

    // Freeze the replay pass counter: the layer is present and the text will be
    // perfect, because nothing ever repaints under it. Only the counter check
    // catches this.
    await page.evaluate(() => {
      const counters = window.__lahe.counters;
      Object.defineProperty(counters, "replayPasses", { value: 0, writable: false, configurable: true });
    });

    let thrown = null;
    try {
      await assertCaretSurvivesTyping(page, {
        selector: "#live-note",
        text: TEN,
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5,
        timeoutMs: 4000
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "a frozen replay counter must fail the assertion").not.toBeNull();

    // The text is fine. That is the point: without the counter check this passes.
    const text = await regionText(page, "#live-note");
    expect(text).toContain(TEN);
  });

  test("the edit survives commit and replay after the caret leaves", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto", flavor: "turbo-frame" });

    const original = await regionText(page, "#live-note");
    const offset = 10;
    const expected = original.slice(0, offset) + TEN + original.slice(offset);

    await typeInto(page, { selector: "#live-note", text: TEN, caretOffset: offset, delayMs: 20 });
    await commitRegion(page, "live-note");

    // The caret is gone from the region and protection has dropped, so the
    // repaint reverts it and replay has to put it back. Poll the counter rather
    // than waiting a while and hoping.
    const before = await readCounters(page);
    await startRepaints(page, 100);
    await waitForCounter(page, "regionsWritten", (before.regionsWritten || 0) + 1);
    await stopRepaints(page);

    expect(await regionText(page, "#live-note")).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// THE IDEMPOTENCE ASSERTION (plan test #13)
// ---------------------------------------------------------------------------

test.describe("assertNoSecondWrite", () => {
  test("five replay passes over an applied region write nothing", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await typeInto(page, { selector: "#live-note", text: TEN, caretOffset: 10, delayMs: 20 });
    await commitRegion(page, "live-note");
    // Blur alone does not move the selection out of the region in Chromium, and
    // the caret shield would then be the reason nothing is written. Clear the
    // selection so this test is about idempotence and only about idempotence.
    await page.evaluate(() => {
      document.querySelector("#live-note").blur();
      document.getSelection().removeAllRanges();
    });

    // The DOM already equals the record's `after`, so every pass should hit the
    // "already applied, skip" branch.
    const outcome = await assertNoSecondWrite(page, {
      selector: "#live-note",
      message: "replay is idempotent by comparison",
      minReplayPasses: 5,
      action: () => replayTimes(page, 5)
    });

    expect(outcome.records).toHaveLength(0);
    expect(outcome.replayPasses).toBeGreaterThanOrEqual(5);
    const counters = await readCounters(page);
    expect(counters.regionsSkippedIdentical).toBeGreaterThanOrEqual(5);
    expect(counters.replayPasses).toBeGreaterThanOrEqual(5);
  });

  test("throws when replay rewrites the same content, which final-DOM equality would miss", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await typeInto(page, { selector: "#live-note", text: TEN, caretOffset: 10, delayMs: 20 });
    await commitRegion(page, "live-note");
    await page.evaluate(() => document.querySelector("#live-note").blur());

    const textBefore = await regionText(page, "#live-note");

    // Switch off the three-way comparison. Replay now writes the identical
    // markup on every pass.
    await configureStub(page, { idempotent: false, respectCaret: false });

    let thrown = null;
    try {
      await assertNoSecondWrite(page, {
        selector: "#live-note",
        minReplayPasses: 5,
        action: () => replayTimes(page, 5)
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown, "a repeated identical rewrite must fail this assertion").not.toBeNull();
    expect(thrown.message).toContain("final-DOM equality");

    // The demonstration, spelled out: the final DOM is byte-identical, so the
    // weaker assertion passes here while the caret is destroyed five times.
    const textAfter = await regionText(page, "#live-note");
    expect(textAfter).toBe(textBefore);
  });

  test("a repeated identical rewrite really does destroy the caret", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await typeInto(page, { selector: "#live-note", text: TEN, caretOffset: 10, delayMs: 20 });
    await commitRegion(page, "live-note");
    await configureStub(page, { idempotent: false, respectCaret: false });

    await placeCaret(page, { selector: "#live-note", offset: 5 });
    const caret = await captureCaret(page);

    await replayTimes(page, 1);

    let thrown = null;
    try {
      await assertCaretUnmoved(page, caret);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "the rewrite must be observable as caret damage, not just as records").not.toBeNull();
  });

  test("it refuses to run at all without minReplayPasses", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    // Not a style preference. Without the number, the assertion cannot tell
    // "replay ran five times and chose not to write" from "replay never ran",
    // and those are the pass and the failure it exists to separate.
    let thrown = null;
    try {
      await assertNoSecondWrite(page, {
        selector: "#live-note",
        action: async () => {}
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "a missing minReplayPasses must be refused, not defaulted").not.toBeNull();
    expect(thrown.message).toContain("minReplayPasses is required");
  });

  test("throws when replay never ran, which is the hole a paused engine walks through", async ({
    page,
    fixtureServer
  }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });

    await typeInto(page, { selector: "#live-note", text: TEN, caretOffset: 10, delayMs: 20 });
    await commitRegion(page, "live-note");
    await page.evaluate(() => {
      document.querySelector("#live-note").blur();
      document.getSelection().removeAllRanges();
    });

    const textBefore = await regionText(page, "#live-note");

    // The engine is paused: the action does nothing at all. No writes land, the
    // DOM is untouched, and every part of this assertion except the counter is
    // perfectly happy.
    let thrown = null;
    try {
      await assertNoSecondWrite(page, {
        selector: "#live-note",
        minReplayPasses: 5,
        message: "a paused replay engine",
        action: async () => "nothing happened"
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown, "a paused engine must not pass an idempotence assertion").not.toBeNull();
    expect(thrown.message).toContain("replay pass counter only went up by 0");
    expect(await regionText(page, "#live-note")).toBe(textBefore);
  });

  test("the observer catches a write that the final DOM also shows", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "off" });

    const observer = await observeMutations(page, { selector: "#live-frame" });
    await page.evaluate(() => {
      document.querySelector("#live-note").firstChild.nodeValue = "a different sentence entirely";
    });
    const records = await observer.stop();

    expect(records.length).toBeGreaterThan(0);
    expect(records[0].type).toBe("characterData");
    expect(records[0].newValue).toBe("a different sentence entirely");
    expect(records[0].oldValue).toContain("Marcus");
  });

  test("the observer can be scoped to attributes, for the host-stays-clean assertions", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("css-reset.html"));
    await enableEditing(page);

    const observer = await observeMutations(page, {
      selector: "#reset-scratch",
      options: { attributes: true, attributeOldValue: true, attributeFilter: ["style", "class"] }
    });
    await page.evaluate(() => {
      document.querySelector("#reset-scratch").setAttribute("style", "color: red");
    });
    const records = await observer.stop();

    expect(records).toHaveLength(1);
    expect(records[0].attributeName).toBe("style");
    expect(records[0].newValue).toBe("color: red");
  });
});

// ---------------------------------------------------------------------------
// THE HOOK FLAVORS (what protection layers one and two have to hold on to)
// ---------------------------------------------------------------------------

test.describe("repaint hooks", () => {
  test("the cooperative-skip attribute carries the live element across a rebuild", async ({
    page,
    fixtureServer
  }) => {
    await openRepainting(page, fixtureServer, { protection: "off", flavor: "turbo-frame" });
    await configureStub(page, { protectOnEdit: false });

    // Layer one on its own: no listener, no veto, just the attribute. This is
    // data-turbo-permanent, and it is a DIFFERENT framework feature from the
    // cancelable event below.
    await page.evaluate(() => {
      const el = document.querySelector("#live-note");
      el.setAttribute("data-lahe-permanent", "");
      el.firstChild.nodeValue = "the reviewer typed this";
    });

    const before = await readCounters(page);
    await forceRepaint(page);
    const after = await readCounters(page);

    expect(await regionText(page, "#live-note")).toBe("the reviewer typed this");
    expect(after.elementsSkippedCooperative).toBeGreaterThan(before.elementsSkippedCooperative);
    // The rest of the frame did re-render, so this is a skip and not a no-op.
    expect(await regionText(page, "#live-second")).toBe(
      "Dana moved her long run to Saturday because of the weather."
    );
  });

  test("a listener can veto one element's morph, and the counter says it did", async ({
    page,
    fixtureServer
  }) => {
    await openRepainting(page, fixtureServer, { protection: "off", flavor: "morph" });
    await configureStub(page, { protectOnEdit: false });

    // Layer two on its own: no attribute, a listener that refuses the event in
    // the moment. This is turbo:before-morph-element.
    await page.evaluate(() => {
      document.addEventListener("lahe:before-morph-element", (event) => {
        if (event.target.id === "live-note") event.preventDefault();
      });
      document.querySelector("#live-note").firstChild.nodeValue = "vetoed by a listener";
      document.querySelector("#live-second").firstChild.nodeValue = "not vetoed";
    });

    const before = await readCounters(page);
    await forceRepaint(page);
    const after = await readCounters(page);

    expect(await regionText(page, "#live-note")).toBe("vetoed by a listener");
    expect(after.elementVetoes).toBeGreaterThan(before.elementVetoes);
    expect(await regionText(page, "#live-second")).toBe(
      "Dana moved her long run to Saturday because of the weather."
    );
  });

  test("the no-hook flavor offers nothing: no event, no attribute, no veto", async ({
    page,
    fixtureServer
  }) => {
    // Picked in the URL, before any script runs, which is how a test gets a page
    // whose framework never offered a hook in the first place.
    await page.goto(fixtureServer.urlFor("repainting.html") + "?repaint=no-hook");
    await page.waitForFunction(() => !!(window.__lahe && window.__lahe.ready && window.__lahe.fixture));
    await configureFixture(page, { target: '[data-repaint-target="live"]' });
    await enableEditing(page);
    await configureStub(page, { protectOnEdit: false });

    expect((await page.evaluate(() => window.__lahe.fixture.state())).hooks).toBe("off");

    let sawEvent = false;
    await page.evaluate(() => {
      window.__sawMorphEvent = false;
      document.addEventListener("lahe:before-morph-element", () => {
        window.__sawMorphEvent = true;
      });
      const el = document.querySelector("#live-note");
      el.setAttribute("data-lahe-permanent", "");
      el.setAttribute("data-lahe-protected", "");
      el.firstChild.nodeValue = "the reviewer typed this";
    });

    const before = await readCounters(page);
    await forceRepaint(page);
    const after = await readCounters(page);
    sawEvent = await page.evaluate(() => window.__sawMorphEvent);

    // Everything a cooperative framework offers is absent, and the reviewer's
    // text is gone. Only a restore afterwards can save this page.
    expect(sawEvent).toBe(false);
    expect(after.elementVetoes).toBe(before.elementVetoes);
    expect(after.elementsSkippedCooperative).toBe(before.elementsSkippedCooperative);
    expect(after.repaintsVetoed).toBe(before.repaintsVetoed);
    expect(await regionText(page, "#live-note")).not.toContain("the reviewer typed this");
  });

  test("configure switches the flavor at runtime too", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer, { protection: "veto" });
    expect((await page.evaluate(() => window.__lahe.fixture.state())).hooks).toBe("on");
    await configureFixture(page, { hooks: "off" });
    expect((await page.evaluate(() => window.__lahe.fixture.state())).hooks).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// PROTECTION LAYER THREE (plan test #1, the layer the other assertion cannot score)
// ---------------------------------------------------------------------------

async function openNoHook(page, fixtureServer, stubPatch = {}) {
  await page.goto(fixtureServer.urlFor("repainting.html") + "?repaint=no-hook");
  await page.waitForFunction(() => !!(window.__lahe && window.__lahe.ready && window.__lahe.fixture));
  await configureFixture(page, { target: '[data-repaint-target="live"]' });
  await enableEditing(page);
  // No cooperation at all: no protection attribute, no veto, no hook. The only
  // thing standing between the reviewer and a lost sentence is the restore.
  // commitOnBlur off as well: a repaint that destroys the focused region fires
  // blur, and a committed record would then be replayed back into the page,
  // repairing it for the wrong reason and leaving the restore unscored.
  await configureStub(
    page,
    Object.assign({ protectOnEdit: false, snapshotRestore: true, commitOnBlur: false }, stubPatch)
  );
  return page;
}

test.describe("assertCaretRestoredAcrossRepaints", () => {
  test("text and caret come back after every repaint on a page with no hook", async ({
    page,
    fixtureServer
  }) => {
    await openNoHook(page, fixtureServer);

    const result = await assertCaretRestoredAcrossRepaints(page, {
      selector: "#live-note",
      text: TEN,
      caretOffset: 10,
      minRestores: 10
    });

    expect(result.actual).toBe(result.expected);
    // One repaint per keystroke plus the trailing ones, every one of them
    // destroying the region and every one of them repaired.
    expect(result.repaints).toBeGreaterThanOrEqual(TEN.length);
    expect(result.restores).toBeGreaterThanOrEqual(TEN.length);
  });

  test("the node-identity assertion fails on the same page, which is why this one exists", async ({
    page,
    fixtureServer
  }) => {
    await openNoHook(page, fixtureServer);

    // Layer three is working here. assertCaretSurvivesTyping still fails,
    // because the restored caret is in a new node by construction. Running the
    // wrong assertion on this layer produces a failure no correct code can fix,
    // and the usual next move is to weaken the assertion for every other test.
    let thrown = null;
    try {
      await assertCaretSurvivesTyping(page, {
        selector: "#live-note",
        text: TEN,
        caretOffset: 10,
        keystrokeDelayMs: 20,
        repaintIntervalMs: 100,
        minReplayPasses: 3,
        timeoutMs: 6000
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "node identity cannot be met by a restore, by construction").not.toBeNull();
    expect(thrown.message).toMatch(/DIFFERENT node|removed from the document/);
  });

  test("throws when nothing restores, and names the keystroke the text was lost at", async ({
    page,
    fixtureServer
  }) => {
    await openNoHook(page, fixtureServer, { snapshotRestore: false });

    let thrown = null;
    try {
      await assertCaretRestoredAcrossRepaints(page, {
        selector: "#live-note",
        text: TEN,
        caretOffset: 10,
        repaintTimeoutMs: 1000
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "an unprotected no-hook repaint must fail this assertion").not.toBeNull();
    expect(thrown.message).toContain("did not come back");
    expect(thrown.message).toContain("after keystroke 1 of 10");
  });

  test("throws when the restore counter never moves, so a do-nothing page cannot pass", async ({
    page,
    fixtureServer
  }) => {
    await openNoHook(page, fixtureServer);

    // The restore still works, so the text and the caret are perfect. Only the
    // counter check catches this, and without it a page that never damaged the
    // region at all would score full marks for a layer it does not have.
    await page.evaluate(() => {
      const counters = window.__lahe.counters;
      const frozen = counters.caretRestores;
      Object.defineProperty(counters, "caretRestores", {
        value: frozen,
        writable: false,
        configurable: true
      });
    });

    let thrown = null;
    try {
      await assertCaretRestoredAcrossRepaints(page, {
        selector: "#live-note",
        text: "abc",
        caretOffset: 10
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "a frozen restore counter must fail the assertion").not.toBeNull();
    expect(thrown.message).toContain("counter went up by 0");

    // The text is fine. That is the point.
    expect(await regionText(page, "#live-note")).toContain("abc");
  });
});

// ---------------------------------------------------------------------------
// Typing, counters, contexts
// ---------------------------------------------------------------------------

test.describe("typing and counters", () => {
  test("typeInto fires real key events", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer);

    await page.evaluate(() => {
      window.__seen = { keydown: 0, beforeinput: 0, input: 0, keyup: 0 };
      const el = document.querySelector("#live-note");
      ["keydown", "beforeinput", "input", "keyup"].forEach((name) => {
        el.addEventListener(name, () => {
          window.__seen[name] += 1;
        });
      });
    });

    await typeInto(page, { selector: "#live-note", text: "abc", caretOffset: 3, delayMs: 10 });

    const seen = await page.evaluate(() => window.__seen);
    expect(seen.keydown).toBe(3);
    expect(seen.beforeinput).toBe(3);
    expect(seen.input).toBe(3);
    expect(seen.keyup).toBe(3);
  });

  test("editing surfaces have spellcheck and autocorrect off", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer);
    const attrs = await page.evaluate(() => {
      const el = document.querySelector("#live-note");
      return {
        editable: el.getAttribute("contenteditable"),
        spellcheck: el.getAttribute("spellcheck"),
        autocorrect: el.getAttribute("autocorrect"),
        autocapitalize: el.getAttribute("autocapitalize")
      };
    });
    expect(attrs).toEqual({
      editable: "true",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off"
    });
  });

  test("waitForCounter polls rather than sleeping", async ({ page, fixtureServer }) => {
    await openRepainting(page, fixtureServer);

    const before = await readCounters(page);
    await startRepaints(page, 30);
    const reached = await waitForCounter(page, "repaints", before.repaints + 4);
    await stopRepaints(page);

    expect(reached).toBeGreaterThanOrEqual(before.repaints + 4);
  });

  test("readCounters says something useful when the layer is not there", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("attacker.html"));
    await expect(readCounters(page)).rejects.toThrow(/window.__lahe.counters is missing/);
  });
});

test.describe("browser contexts", () => {
  test("two contexts on one target have separate storage", async ({ browser, fixtureServer }) => {
    const url = fixtureServer.urlFor("built-doc.html");
    const both = await openTwoContexts(browser, url);
    try {
      await both.first.page.evaluate(() => localStorage.setItem("lahe-selftest", "first"));
      const secondSees = await both.second.page.evaluate(() => localStorage.getItem("lahe-selftest"));
      expect(secondSees).toBeNull();
      await expect(both.second.page.locator("h1")).toHaveText(/Steady Pace/);
    } finally {
      await both.closeAll();
    }
  });

  test("two tabs in one context share storage, which is the second-tab case", async ({ browser, fixtureServer }) => {
    const url = fixtureServer.urlFor("built-doc.html");
    const both = await openTwoTabs(browser, url);
    try {
      await both.first.page.evaluate(() => localStorage.setItem("lahe-selftest", "first"));
      await both.second.page.reload();
      const secondSees = await both.second.page.evaluate(() => localStorage.getItem("lahe-selftest"));
      expect(secondSees).toBe("first");
    } finally {
      await both.closeAll();
    }
  });
});

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------

test.describe("CSP fixtures", () => {
  test("a real connect-src header blocks the sync while the layer still runs", async ({ page, cspServer }) => {
    const server = await cspServer("block-connect");
    const violations = [];
    page.on("console", (message) => {
      if (message.type() === "error") violations.push(message.text());
    });

    await page.goto(server.urlFor("csp-probe.html"));

    // The page's own scripts ran.
    expect(await page.evaluate(() => !!(window.__cspProbe && window.__cspProbe.inlineRan))).toBe(true);
    expect(await page.evaluate(() => !!(window.__lahe && window.__lahe.ready))).toBe(true);

    // The loopback call did not. Playwright injects evaluate through the
    // debugger, so it runs under script-src, but connect-src is enforced on the
    // document's own fetches either way.
    const outcome = await page.evaluate(async () => {
      try {
        await fetch("http://127.0.0.1:65000/items", { method: "POST", body: "{}" });
        return "allowed";
      } catch (err) {
        return "blocked:" + err.name;
      }
    });
    expect(outcome).toContain("blocked");

    const reported = await page.evaluate(() => window.__cspProbe.violations.map((v) => v.directive));
    expect(reported.join(",")).toContain("connect-src");
  });

  test("a real script-src header stops the layer from loading at all", async ({ page, cspServer }) => {
    const server = await cspServer("block-script");
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(server.urlFor("csp-probe.html"));

    // Neither the inline probe nor the layer's external script ran. This is the
    // refusal that must be named distinctly from service-down.
    expect(await page.evaluate(() => typeof window.__cspProbe)).toBe("undefined");
    expect(await page.evaluate(() => typeof window.__lahe)).toBe("undefined");
    expect(errors.join(" ")).toMatch(/Content Security Policy|Refused to (load|execute)/i);

    // The document itself is fine. Only the scripts were refused.
    await expect(page.locator("#probe-title")).toHaveText("CSP probe");
    await expect(page.locator("#probe-status")).toHaveText("Waiting.");
  });

  test("the same page with no CSP header loads the layer", async ({ page, fixtureServer }) => {
    await page.goto(fixtureServer.urlFor("csp-probe.html"));
    expect(await page.evaluate(() => !!(window.__lahe && window.__lahe.ready))).toBe(true);
  });
});
