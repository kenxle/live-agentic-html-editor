"use strict";

// The Library page's content policy (Library fix round, SEC6). It used to set
// only script-src 'self', leaving connect, image, font and style open. The full
// header is pinned here: everything defaults to 'none', and each kind the page
// uses is allowed from its own origin only. The page's one inline <style> is
// allowed by its hash, not by 'unsafe-inline'.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const catalogPage = require("../../src/service/catalog_page.js");

function inlineStyleHash(html) {
  const styles = html.match(/<style>([\s\S]*?)<\/style>/g) || [];
  assert.equal(styles.length, 1, "the page has exactly one inline <style>");
  const body = styles[0].replace(/^<style>/, "").replace(/<\/style>$/, "");
  return "'sha256-" + crypto.createHash("sha256").update(body, "utf8").digest("base64") + "'";
}

test("the Library page's content policy is default-src 'none' with self-only connect, image, font and style, and the inline style by hash", () => {
  const html = catalogPage.renderPage("tok_test");
  const csp = catalogPage.securityHeaders()["Content-Security-Policy"];
  assert.equal(
    csp,
    [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self' " + inlineStyleHash(html),
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
  assert.equal(csp.includes("unsafe-inline"), false);
  assert.equal(/style="/.test(html), false, "no style attribute, which a hash would not allow");
});
