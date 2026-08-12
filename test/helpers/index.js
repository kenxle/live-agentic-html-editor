// The harness, one import.
//
//   const { test, expect, typeInto, assertCaretSurvivesTyping } = require("../helpers");
//
// Read test/helpers/README.md before writing your first test with this. It is
// short, and it names the four things a builder has to change when the real
// review layer lands.

"use strict";

const { test, expect } = require("./test");
const poll = require("./poll");
const bridge = require("./bridge");
const counters = require("./counters");
const caret = require("./caret");
const mutations = require("./mutations");
const repaint = require("./repaint");
const typing = require("./typing");
const assertions = require("./assertions");
const servers = require("./servers");
const service = require("./service");
const contexts = require("./contexts");
const stub = require("./stub");

module.exports = Object.assign(
  { test: test, expect: expect },
  poll,
  bridge,
  counters,
  caret,
  mutations,
  repaint,
  typing,
  assertions,
  servers,
  service,
  contexts,
  stub
);
