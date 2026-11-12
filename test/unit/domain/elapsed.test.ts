/*
 * read-when: Changing src/domain/elapsed.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { elapsedPhrase } from "../../../src/domain/elapsed.ts";

const NOW = Date.parse("2026-08-18T04:40:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function startedAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function phraseFor(msAgo: number): string {
  return elapsedPhrase(startedAgo(msAgo), { now: NOW });
}

test("under a minute reads as less than a minute", () => {
  assert.equal(phraseFor(0), "for less than a minute");
  assert.equal(phraseFor(20 * SECOND), "for less than a minute");
  assert.equal(phraseFor(59 * SECOND + 400), "for less than a minute");
});

test("elapsed seconds round to the nearest, so 59.6 seconds is already a minute", () => {
  assert.equal(phraseFor(59 * SECOND + 600), "for the last 1 minute");
});

test("a start in the future counts as no time at all", () => {
  assert.equal(phraseFor(-5 * MINUTE), "for less than a minute");
});

test("from a minute on it counts minutes, singular for one", () => {
  assert.equal(phraseFor(MINUTE), "for the last 1 minute");
  assert.equal(phraseFor(89 * SECOND), "for the last 1 minute");
  assert.equal(phraseFor(90 * SECOND), "for the last 2 minutes");
  assert.equal(phraseFor(4 * MINUTE), "for the last 4 minutes");
  assert.equal(phraseFor(89 * MINUTE), "for the last 89 minutes");
  assert.equal(phraseFor(89 * MINUTE + 59 * SECOND), "for the last 90 minutes");
});

test("from 90 minutes on it names the start as a local date and time, never the ISO form", () => {
  const exactly = startedAgo(90 * MINUTE);
  assert.equal(elapsedPhrase(exactly, { now: NOW }), "since " + new Date(exactly).toLocaleString());
  const hoursAgo = startedAgo(5 * 60 * MINUTE);
  const phrase = elapsedPhrase(hoursAgo, { now: NOW });
  assert.equal(phrase, "since " + new Date(hoursAgo).toLocaleString());
  assert.equal(phrase.indexOf(hoursAgo), -1);
  assert.equal(phrase.indexOf("T"), -1, "a local date and time, never the ISO form");
});

test("the start may be epoch milliseconds or a Date as well as an ISO string", () => {
  assert.equal(elapsedPhrase(NOW - 4 * MINUTE, { now: NOW }), "for the last 4 minutes");
  assert.equal(elapsedPhrase(new Date(NOW - 4 * MINUTE), { now: NOW }), "for the last 4 minutes");
});

test("a start that is not a time is echoed rather than guessed at", () => {
  assert.equal(elapsedPhrase("not a time"), "since not a time");
  assert.equal(elapsedPhrase("", { now: NOW }), "since ");
});

test("without a clock it measures from now", () => {
  assert.equal(elapsedPhrase(new Date(Date.now() - 4 * MINUTE).toISOString()), "for the last 4 minutes");
});

test("the old path still loads the same module for code that requires it", () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../src/shared/elapsed.js");
  assert.ok(typeof old === "object" && old !== null && "elapsedPhrase" in old);
  assert.equal(old.elapsedPhrase, elapsedPhrase);
});
