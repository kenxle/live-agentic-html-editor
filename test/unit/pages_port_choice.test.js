// A test that ran `serve({port: 0})` directly, without the test runner's
// LAHE_PAGES_PORT=0, bound the real pages port 1483. A helper asked for a free
// API port now takes a free pages port too, unless it is given one. Pure: this
// file binds nothing.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../../src/service/index.js");
const protocol = require("../../src/shared/protocol.js");

function withEnv(t, value) {
  const prior = process.env[protocol.PAGES.PORT_ENV];
  if (value === undefined) delete process.env[protocol.PAGES.PORT_ENV];
  else process.env[protocol.PAGES.PORT_ENV] = value;
  t.after(() => {
    if (prior === undefined) delete process.env[protocol.PAGES.PORT_ENV];
    else process.env[protocol.PAGES.PORT_ENV] = prior;
  });
}

test("a helper on a free API port takes a free pages port, never 1483", (t) => {
  withEnv(t, undefined);
  assert.equal(service.pagesPortFrom({ port: 0 }), 0);
});

test("a pages port given outright wins, and the default stays 1483 for a real helper", (t) => {
  withEnv(t, undefined);
  assert.equal(service.pagesPortFrom({ port: 0, pagesPort: 5555 }), 5555);
  assert.equal(service.pagesPortFrom({ port: 7817 }), protocol.PAGES.PORT);
  assert.equal(service.pagesPortFrom({}), protocol.PAGES.PORT);
});

test("LAHE_PAGES_PORT still sets the pages port of a real helper", (t) => {
  withEnv(t, "0");
  assert.equal(service.pagesPortFrom({ port: 7817 }), 0);
});
