// Typing with real key events.
//
// Real key events matter here more than in most projects. The editing surface is
// a contenteditable, and the whole tool is a bet about what happens between a
// keystroke and a repaint. Setting textContent from a script skips beforeinput,
// input, composition, and the browser's own caret bookkeeping, which is every
// mechanism under test. So typing goes through the keyboard.
//
// The per-keystroke delay is Playwright's own `delay` option, handled inside the
// browser driver. It is input cadence, not a wait, which is why it does not
// violate the no-arbitrary-sleeps rule: the scenario is "ten characters, one per
// 50ms", and the cadence is part of the scenario rather than a guess about how
// long something takes.

"use strict";

const { placeCaret } = require("./caret");

const DEFAULT_KEYSTROKE_DELAY_MS = 50;

/**
 * Focus a region without moving the caret with a click. A click would place the
 * caret wherever the pointer landed, which defeats the point of an offset.
 */
async function focusRegion(page, selector) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("focusRegion: no element matches " + sel);
    el.focus();
    if (document.activeElement !== el) {
      throw new Error(
        "focusRegion: " +
          sel +
          " did not take focus. It is probably not editable yet; call enableEditing first."
      );
    }
  }, selector);
}

/**
 * Type into a region with real key events.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, text: string, caretOffset?: number|null,
 *          textNodeIndex?: number, delayMs?: number, focus?: boolean}} options
 *   `caretOffset` places the caret before typing. Omit it (or pass null) to type
 *   wherever the caret already is.
 * @returns {Promise<{selector: string, text: string, caretOffset: number|null}>}
 */
async function typeInto(page, options) {
  const selector = options.selector;
  const text = options.text;
  const delayMs = options.delayMs ?? DEFAULT_KEYSTROKE_DELAY_MS;
  const caretOffset = options.caretOffset ?? null;

  if (options.focus !== false) await focusRegion(page, selector);
  if (caretOffset !== null) {
    await placeCaret(page, {
      selector: selector,
      offset: caretOffset,
      textNodeIndex: options.textNodeIndex ?? 0
    });
  }

  await page.keyboard.type(text, { delay: delayMs });
  return { selector: selector, text: text, caretOffset: caretOffset };
}

/**
 * Press a key with real key events, for the gesture table (Escape, the toggle,
 * modifier clicks live in their own helpers when those tasks land).
 */
async function pressKey(page, key, options = {}) {
  await page.keyboard.press(key, options);
}

module.exports = {
  DEFAULT_KEYSTROKE_DELAY_MS,
  focusRegion,
  typeInto,
  pressKey
};
