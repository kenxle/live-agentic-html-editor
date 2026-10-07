// The zoom viewer's pure rules (src/layer/zoom.js): which graphs and images get
// the button, and the arithmetic of fit, zoom toward a point, and the wheel.
// The DOM half is test/browser/zoom_viewer.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const zoom = require("../../src/layer/zoom.js");

function rect(width, height) {
  return { width: width, height: height };
}

test("an svg qualifies when its shorter side is at least SVG_MIN_SIDE", () => {
  assert.equal(zoom.svgQualifies(rect(400, zoom.SVG_MIN_SIDE), null, false), true);
  assert.equal(zoom.svgQualifies(rect(400, zoom.SVG_MIN_SIDE - 1), null, false), false);
});

test("a short svg still qualifies when it is shown smaller than its own size, or is Mermaid", () => {
  // A wide left-to-right flowchart shrunk to the page width: 2400x300 shown at 680x85.
  assert.equal(zoom.svgQualifies(rect(680, 85), { width: 2400, height: 300 }, false), true);
  assert.equal(zoom.svgQualifies(rect(300, 80), { width: 300, height: 80 }, true), true);
  assert.equal(zoom.svgQualifies(rect(300, 80), { width: 300, height: 80 }, false), false);
});

test("nothing under MIN_SIDE qualifies, whatever else is true", () => {
  assert.equal(zoom.svgQualifies(rect(600, zoom.MIN_SIDE - 1), { width: 2400, height: 300 }, true), false);
  assert.equal(zoom.imgQualifies(rect(zoom.MIN_SIDE - 1, 600), { width: 2000, height: 3000 }), false);
});

test("an image qualifies when shown smaller than its natural size or large on screen", () => {
  assert.equal(zoom.imgQualifies(rect(680, 425), { width: 1600, height: 1000 }), true);
  assert.equal(zoom.imgQualifies(rect(480, 320), { width: 480, height: 320 }), true);
  assert.equal(zoom.imgQualifies(rect(200, 150), { width: 200, height: 150 }), false);
  assert.equal(zoom.imgQualifies(rect(32, 32), { width: 32, height: 32 }), false);
  assert.equal(zoom.imgQualifies(rect(200, 150), null), false, "an image with no natural size has not loaded");
});

test("fit scales the content into the window with a margin, centred", () => {
  const view = zoom.fitView(1280, 720, 1600, 1000, 48);
  const want = Math.min((1280 - 96) / 1600, (720 - 96) / 1000);
  assert.equal(view.scale, want);
  assert.equal(view.x, (1280 - 1600 * want) / 2);
  assert.equal(view.y, (720 - 1000 * want) / 2);
});

test("zooming about a point keeps the point under it still", () => {
  const view = { scale: 0.5, x: 100, y: 40 };
  const px = 300;
  const py = 200;
  const before = [(px - view.x) / view.scale, (py - view.y) / view.scale];
  const next = zoom.zoomAbout(view, 1.7, px, py);
  assert.equal(next.scale, 1.7);
  assert.deepEqual([(px - next.x) / next.scale, (py - next.y) / next.scale], before);
});

test("zoom is held between MIN_SCALE and MAX_SCALE", () => {
  assert.equal(zoom.zoomAbout({ scale: 1, x: 0, y: 0 }, 1000, 0, 0).scale, zoom.MAX_SCALE);
  assert.equal(zoom.zoomAbout({ scale: 1, x: 0, y: 0 }, 0.0001, 0, 0).scale, zoom.MIN_SCALE);
});

test("the wheel zooms in on an upward scroll, harder for a pinch, and reads line deltas as pixels", () => {
  assert.ok(zoom.wheelFactor(-100, 0, false, 800) > 1);
  assert.ok(zoom.wheelFactor(100, 0, false, 800) < 1);
  assert.ok(zoom.wheelFactor(-10, 0, true, 800) > zoom.wheelFactor(-10, 0, false, 800));
  assert.equal(zoom.wheelFactor(-3, 1, false, 800), zoom.wheelFactor(-48, 0, false, 800));
});

test("a small icon drawn from a large viewBox gets no button", () => {
  // A 64px logo from a 512x512 viewBox is shown smaller than its own size, and
  // is still an icon: the shrunk rule needs IMG_MIN_LONG on the longer side.
  assert.equal(zoom.svgQualifies(rect(64, 64), { width: 512, height: 512 }, false), false);
  assert.equal(zoom.svgQualifies(rect(680, 85), { width: 2400, height: 300 }, false), true);
});

function fakeSvg(attrs, viewBox) {
  return {
    viewBox: viewBox ? { baseVal: viewBox } : undefined,
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null)
  };
}

test("an svg's own size is its width and height attributes in px, before its viewBox", () => {
  const own = zoom.svgOwnSize(fakeSvg({ width: "600", height: "600" }, { width: 24, height: 24 }));
  assert.equal(own.width, 600);
  assert.equal(own.height, 600);
  assert.equal(own.viewBox, true, "it still has a viewBox to scale against");
  const px = zoom.svgOwnSize(fakeSvg({ width: "320px", height: "200px" }, null));
  assert.deepEqual([px.width, px.height, px.viewBox], [320, 200, false]);
});

test("an svg sized in percent or other units falls back to its viewBox", () => {
  const own = zoom.svgOwnSize(fakeSvg({ width: "100%" }, { width: 2400, height: 300 }));
  assert.deepEqual([own.width, own.height], [2400, 300]);
  const em = zoom.svgOwnSize(fakeSvg({ width: "10em", height: "4em" }, { width: 100, height: 40 }));
  assert.deepEqual([em.width, em.height], [100, 40]);
  assert.equal(zoom.svgOwnSize(fakeSvg({}, null)), null);
});

test("the button sits at the top right of the picture's visible part", () => {
  const S = zoom.BUTTON_SIZE;
  const I = zoom.BUTTON_INSET;
  // Wholly on screen, no rail: the picture's own corner.
  assert.deepEqual(zoom.buttonSpot({ left: 300, top: 200, right: 980, bottom: 300 }, 1280, 800, null), {
    left: 980 - I - S,
    top: 200 + I
  });
  // The rail open from x 872: the corner moves left of it.
  assert.deepEqual(zoom.buttonSpot({ left: 128, top: 200, right: 1152, bottom: 600 }, 1280, 800, 872), {
    left: 872 - I - S,
    top: 200 + I
  });
  // Scrolled so the top is off screen: the corner is at the viewport's top.
  assert.deepEqual(zoom.buttonSpot({ left: 300, top: -1500, right: 900, bottom: 900 }, 1280, 800, null), {
    left: 900 - I - S,
    top: I
  });
});

test("no button when no visible part is big enough to hold one", () => {
  // Under the rail all but 20px.
  assert.equal(zoom.buttonSpot({ left: 852, top: 200, right: 1200, bottom: 600 }, 1280, 800, 872), null);
  // Only a sliver showing at the bottom of the window.
  assert.equal(zoom.buttonSpot({ left: 300, top: 790, right: 900, bottom: 1400 }, 1280, 800, null), null);
});
