// The choice group's look, from the house stylesheet alone: no review layer,
// no helper, no script tag. The fixture is rendered the way the helper renders
// Markdown and served by a plain static server, so what the test sees is what a
// reader with no Lahe running sees.
//
// Plan rows V14 (R17: a data-chosen button reads as decided with no Lahe, and
// in print) and V23 (R2: the look, page half), in
// docs/features/20261013.01_choice_buttons/03_plan_choice_buttons.md.
//
// The state attributes Lahe paints (data-lahe-pressed, data-lahe-choice-state,
// data-lahe-inert) are set by hand here. The layer workstream proves it paints
// them; this file proves the stylesheet draws them.
//
// Set CHOICE_SHOTS=<folder> to also write the V23 screenshots there.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, startStaticServer } = require("../helpers");
const markdown = require("../../src/service/markdown.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "choice-doc.md");
const INK = "rgb(31, 30, 26)";
const WHITE = "rgb(255, 255, 255)";
const PURPLE = "rgb(70, 24, 140)";
const PURPLE_TINT = "rgb(241, 235, 250)";
const SHOTS = process.env.CHOICE_SHOTS || "";

async function servedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-choice-style-"));
  const source = path.join(root, "choice-doc.md");
  fs.copyFileSync(FIXTURE, source);
  const artifact = markdown.writeArtifact(path.join(root, "state"), "s_choice_style", source);
  const server = await startStaticServer({ root: path.dirname(artifact.target), label: "choice-style" });
  return { server, url: server.origin + "/" + path.basename(artifact.target) };
}

function group(page, name) {
  return page.locator(".choice[data-choice=\"" + name + "\"]");
}

async function look(locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopWidth + " " + cs.borderTopStyle,
      borderColor: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      backgroundImage: cs.backgroundImage
    };
  });
}

function after(locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el, "::after");
    return { content: cs.content, background: cs.backgroundColor, color: cs.color };
  });
}

async function decidedLook(page) {
  const decided = group(page, "lesson-monitor-setting");
  const chosen = decided.locator("button[data-chosen]");
  const other = decided.locator("button[value=\"promote\"]");
  const chosenLook = await look(chosen);
  const otherLook = await look(other);
  expect(chosenLook.background).toBe(INK);
  expect(chosenLook.color).toBe(WHITE);
  expect(otherLook.background).toBe(WHITE);
  expect(otherLook.border).toBe("1px solid");
  // A decided group with no Lahe reads as Done, in words.
  expect((await after(decided)).content).toBe("\"Done\"");
}

test("a data-chosen button reads as decided with no Lahe, on screen and in print (V14)", async ({ page }) => {
  const { server, url } = await servedFixture();
  try {
    await page.goto(url);
    await expect(page.locator("script[data-lahe-review], script[src*=\"lahe\"]")).toHaveCount(0);
    await expect(page.locator(".choice")).toHaveCount(4);
    await decidedLook(page);

    // An undecided group: every button outlined in ink on the page ground.
    for (const button of await group(page, "lesson-reveal-timer").locator("button").all()) {
      const l = await look(button);
      expect(l.background).toBe(WHITE);
      expect(l.border).toBe("1px solid");
      expect(l.borderColor).toEqual([INK, INK, INK, INK]);
    }

    await page.emulateMedia({ media: "print" });
    await decidedLook(page);
  } finally {
    await server.close();
  }
});

test("the house rules hold: square, no shadow, no colored edge, the badge in purple (V23)", async ({ page }) => {
  const { server, url } = await servedFixture();
  try {
    await page.goto(url);
    for (const button of await page.locator(".choice > button").all()) {
      const l = await look(button);
      expect(l.radius).toBe("0px");
      expect(l.shadow).toBe("none");
      expect(l.backgroundImage).toBe("none");
      expect(new Set(l.borderColor).size).toBe(1);
    }
    const box = await look(group(page, "lesson-css-counter"));
    expect(new Set(box.borderColor).size).toBe(1);
    expect(box.shadow).toBe("none");

    const badge = await after(page.locator(".choice > button[data-recommended]").first());
    expect(badge.content).toBe("\"Recommended\"");
    expect(badge.background).toBe(PURPLE_TINT);
    expect(badge.color).toBe(PURPLE);
    // No recommendation, no badge.
    expect((await after(group(page, "lesson-reveal-timer").locator("button").first())).content).toBe("none");
  } finally {
    await server.close();
  }
});

test("each state Lahe paints draws its word, and a newer press wins over data-chosen (V23)", async ({ page }) => {
  const { server, url } = await servedFixture();
  try {
    await page.goto(url);
    const words = {
      kept: "\"Kept in this browser\"",
      open: "\"Open\"",
      question: "\"Question\"",
      // The rail moved to the brand's three thread states (Done, Open, Question)
      // in PR #75, so a press the agent said no to reads Open on the group too,
      // with the reason on its thread. The attribute keeps not_handled.
      not_handled: "\"Open\"",
      done: "\"Done\""
    };
    const target = group(page, "lesson-css-counter");
    for (const state of Object.keys(words)) {
      await target.evaluate((el, s) => {
        el.setAttribute("data-lahe-choice-state", s);
        el.querySelector("button[value=\"discard\"]").setAttribute("data-lahe-pressed", "");
      }, state);
      expect((await after(target)).content).toBe(words[state]);
      expect((await look(target.locator("button[value=\"discard\"]"))).background).toBe(INK);
      expect((await look(target.locator("button[value=\"promote\"]"))).background).toBe(WHITE);
    }

    // A new press on a decided group: the pressed button is the answer and
    // the chosen one goes quiet.
    const decided = group(page, "lesson-monitor-setting");
    await decided.evaluate((el) => {
      el.setAttribute("data-lahe-choice-state", "open");
      el.querySelector("button[value=\"promote\"]").setAttribute("data-lahe-pressed", "");
    });
    expect((await look(decided.locator("button[value=\"promote\"]"))).background).toBe(INK);
    const quiet = await look(decided.locator("button[data-chosen]"));
    expect(quiet.background).toBe(WHITE);
    expect(quiet.color).not.toBe(WHITE);
    expect((await after(decided)).content).toBe("\"Open\"");

    // Refused: a dashed box and quiet buttons, no state word.
    const inert = group(page, "lesson-pandoc-section");
    await inert.evaluate((el) => el.setAttribute("data-lahe-inert", ""));
    const inertBox = await inert.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(inertBox).toBe("dashed");
    expect((await after(inert)).content).toBe("none");
  } finally {
    await server.close();
  }
});

// Not an assertion: the V23 pictures, one per look, from the built page.
test("V23 screenshots", async ({ page }) => {
  test.skip(!SHOTS, "set CHOICE_SHOTS to a folder to write the screenshots");
  const { server, url } = await servedFixture();
  try {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const shoot = async (name, groupName, paint) => {
      const target = group(page, groupName);
      await target.evaluate(paint || (() => {}));
      await target.scrollIntoViewIfNeeded();
      await target.screenshot({ path: path.join(SHOTS, name + ".png") });
    };
    // The whole first section at rest, so the group is seen in its page.
    await page.locator("section.sheet").first().screenshot({ path: path.join(SHOTS, "choice_in_page.png") });
    await shoot("choice_rest_badge", "lesson-css-counter");
    await shoot("choice_rest_no_recommendation", "lesson-reveal-timer");
    await shoot("choice_decided_no_lahe", "lesson-monitor-setting");
    await shoot("choice_pressed_kept", "lesson-css-counter", (el) => {
      el.setAttribute("data-lahe-choice-state", "kept");
      el.querySelector("button[value=\"promote\"]").setAttribute("data-lahe-pressed", "");
    });
    await shoot("choice_open", "lesson-css-counter", (el) => el.setAttribute("data-lahe-choice-state", "open"));
    await shoot("choice_question", "lesson-css-counter", (el) => el.setAttribute("data-lahe-choice-state", "question"));
    await shoot("choice_not_handled", "lesson-css-counter", (el) => el.setAttribute("data-lahe-choice-state", "not_handled"));
    await shoot("choice_done", "lesson-css-counter", (el) => el.setAttribute("data-lahe-choice-state", "done"));
    await shoot("choice_new_press_over_chosen", "lesson-monitor-setting", (el) => {
      el.setAttribute("data-lahe-choice-state", "open");
      el.querySelector("button[value=\"promote\"]").setAttribute("data-lahe-pressed", "");
    });
    await shoot("choice_inert", "lesson-pandoc-section", (el) => el.setAttribute("data-lahe-inert", ""));
  } finally {
    await server.close();
  }
});
