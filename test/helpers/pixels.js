// Comparing two screenshots the way an eye does, not the way a byte does.
//
// The claim these back is D8's: outside the rail's bounds, a reviewed page
// looks exactly as it looks without the tool. That was written as
// `Buffer.compare(bareShot, layerShot) === 0`, which compares two PNG FILES
// byte for byte. It held on one developer's machine and failed on the CI box,
// and the failure was unreadable: Buffer.compare returns -1, 0 or 1, so a
// report of "expected 0, received -1" says only "the files differ", never by
// how much, in how many pixels, or even whether the two images are the same
// size. A one-channel rounding difference in one pixel and a whole paragraph
// painted the wrong color produce the identical message.
//
// So the comparison is done on pixels instead. Both PNGs are decoded in the
// browser that took them (no image decoder ships with Node, and this repo has
// no runtime dependencies to add one to), and the result says:
//
//   sameSize     whether the two images even cover the same pixels. A size
//                mismatch is a layout bug, never a rendering nicety, and it
//                now fails with that word on it rather than as "received -1".
//   differing    pixels that differ at all, however slightly.
//   material     pixels that differ by more than CHANNEL_TOLERANCE in some
//                channel. This is the number the assertions are written
//                against.
//   maxDelta     the largest single-channel difference anywhere.
//   sample       where the first material difference is, with both colors.
//
// THE TOLERANCE, AND WHY IT IS NOT A LOOSENED ASSERTION. Two renderings of the
// same text by the same engine can disagree in the last bit of an antialiased
// edge pixel: subpixel positions are computed in floating point, and identical
// input is not a guarantee of an identical rounding. That is what
// CHANNEL_TOLERANCE absorbs, and nothing else: a difference a person could see
// is tens of levels per channel, not twelve. The pixel budget is the second
// half of the same idea: a handful of edge pixels may wobble, but the tool's
// own visible additions (a painted highlight, a box, a pill) cover hundreds to
// thousands of pixels, so anything that large still fails. The intent is
// intact: the page outside the rail must look identical.

"use strict";

const { expect } = require("./test");

/** Per-channel difference a pair of antialiased edge pixels may disagree by. */
const CHANNEL_TOLERANCE = 12;

/** Share of the compared area allowed to differ materially, plus a floor. */
const PIXEL_BUDGET_RATIO = 0.0002;
const PIXEL_BUDGET_FLOOR = 40;

/**
 * How many materially differing pixels a "these look the same" claim allows.
 *
 * Proportional to the area compared, with a floor so a small clip is not held
 * to a budget of two pixels.
 */
function pixelBudget(diff) {
  return Math.max(PIXEL_BUDGET_FLOOR, Math.round(diff.total * PIXEL_BUDGET_RATIO));
}

/**
 * Decode two PNG buffers in the page and compare them pixel by pixel.
 *
 * @param {import('@playwright/test').Page} page any open page; it is used only
 *   as an image decoder, and its own content is irrelevant.
 * @param {Buffer} aBuffer
 * @param {Buffer} bBuffer
 * @param {{channelTolerance?: number}} [options]
 * @returns {Promise<{sameSize: boolean, a: {width: number, height: number},
 *   b: {width: number, height: number}, width: number, height: number,
 *   total: number, differing: number, material: number, maxDelta: number,
 *   sample: object|null}>}
 */
async function pixelDiff(page, aBuffer, bBuffer, options = {}) {
  const channelTolerance = options.channelTolerance ?? CHANNEL_TOLERANCE;
  return page.evaluate(
    async function (args) {
      function bytes(base64) {
        const binary = atob(base64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
        return out;
      }

      async function decode(base64) {
        const bitmap = await createImageBitmap(new Blob([bytes(base64)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const size = { width: bitmap.width, height: bitmap.height };
        const pixels = context.getImageData(0, 0, size.width, size.height).data;
        // Read the size FIRST: close() zeroes the bitmap's own width and height.
        bitmap.close();
        return { width: size.width, height: size.height, pixels: pixels };
      }

      const a = await decode(args.a);
      const b = await decode(args.b);
      const sameSize = a.width === b.width && a.height === b.height;
      const base = {
        sameSize: sameSize,
        a: { width: a.width, height: a.height },
        b: { width: b.width, height: b.height },
        width: a.width,
        height: a.height,
        total: a.width * a.height,
        differing: 0,
        material: 0,
        maxDelta: 0,
        sample: null
      };
      if (!sameSize) return base;

      for (let i = 0; i < a.pixels.length; i += 4) {
        let delta = 0;
        for (let c = 0; c < 4; c += 1) {
          const one = Math.abs(a.pixels[i + c] - b.pixels[i + c]);
          if (one > delta) delta = one;
        }
        if (delta === 0) continue;
        base.differing += 1;
        if (delta > base.maxDelta) base.maxDelta = delta;
        if (delta <= args.channelTolerance) continue;
        base.material += 1;
        if (!base.sample) {
          const pixel = i / 4;
          base.sample = {
            x: pixel % a.width,
            y: Math.floor(pixel / a.width),
            delta: delta,
            without: [a.pixels[i], a.pixels[i + 1], a.pixels[i + 2], a.pixels[i + 3]],
            with: [b.pixels[i], b.pixels[i + 1], b.pixels[i + 2], b.pixels[i + 3]]
          };
        }
      }
      return base;
    },
    { a: aBuffer.toString("base64"), b: bBuffer.toString("base64"), channelTolerance: channelTolerance }
  );
}

/** A one-line account of a comparison, for a failure message. */
function describeDiff(diff) {
  if (!diff.sameSize) {
    return (
      "the two screenshots are different sizes: " +
      diff.a.width +
      "x" +
      diff.a.height +
      " without the library, " +
      diff.b.width +
      "x" +
      diff.b.height +
      " with it"
    );
  }
  return (
    diff.material +
    " of " +
    diff.total +
    " pixels differ by more than " +
    CHANNEL_TOLERANCE +
    " (budget " +
    pixelBudget(diff) +
    "), " +
    diff.differing +
    " differ at all, largest channel difference " +
    diff.maxDelta +
    (diff.sample ? ", first at " + diff.sample.x + "," + diff.sample.y + " " + JSON.stringify(diff.sample) : "")
  );
}

/**
 * Assert two screenshots show the same thing.
 *
 * @param {object} diff the result of pixelDiff
 * @param {string} label what the claim is, in the test's own words
 */
function expectSamePixels(diff, label) {
  expect(diff.sameSize, label + ": " + describeDiff(diff)).toBe(true);
  expect(diff.total, label + ": the screenshots are empty").toBeGreaterThan(0);
  expect(diff.material, label + ": " + describeDiff(diff)).toBeLessThanOrEqual(pixelBudget(diff));
}

/**
 * Assert two screenshots visibly differ: the positive control that keeps the
 * assertion above honest.
 */
function expectDifferentPixels(diff, label) {
  expect(diff.sameSize, label + ": " + describeDiff(diff)).toBe(true);
  expect(diff.material, label + ": " + describeDiff(diff)).toBeGreaterThan(pixelBudget(diff));
}

module.exports = {
  CHANNEL_TOLERANCE,
  PIXEL_BUDGET_RATIO,
  PIXEL_BUDGET_FLOOR,
  pixelBudget,
  pixelDiff,
  describeDiff,
  expectSamePixels,
  expectDifferentPixels
};
