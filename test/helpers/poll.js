// Waiting, and the rule about it.
//
// harness-allow-timer: this file is the ONE place in the harness where a timer
// is allowed to exist, and it exists only to drive a condition poll. Every other
// file under test/ is scanned by test/unit/no_arbitrary_sleeps.test.js and will
// fail the gate if it reaches for a timeout. If you find yourself wanting to
// wait "about 300ms for things to settle", the answer is a counter or a
// condition, and it goes through here.
//
// Why the rule is enforced rather than documented: a flaky browser test gets its
// determinism fixed, never its assertion loosened, and a sleep is how an
// assertion gets loosened without anyone noticing.

"use strict";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERVAL_MS = 25;

/**
 * Poll a node side condition until it returns something truthy.
 *
 * @param {() => any | Promise<any>} check runs repeatedly; its truthy return is
 *   the resolved value, so it can return the thing you were waiting for.
 * @param {{timeoutMs?: number, intervalMs?: number, message?: string,
 *          describe?: () => any | Promise<any>}} options
 *   `message` names the condition in the timeout error. `describe` is called on
 *   timeout to add context to the error, which is the difference between a
 *   useful failure and a rerun.
 * @returns {Promise<any>}
 */
async function pollUntil(check, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const message = options.message ?? "condition";
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) {
      let context = "";
      if (typeof options.describe === "function") {
        try {
          context = "\nContext: " + JSON.stringify(await options.describe());
        } catch (err) {
          context = "\nContext unavailable: " + err.message;
        }
      }
      throw new Error("Timed out after " + timeoutMs + "ms waiting for " + message + "." + context);
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, intervalMs);
    });
  }
}

/**
 * Poll a condition evaluated inside the page. Thin wrapper over Playwright's own
 * waitForFunction, which polls on animation frames rather than on a clock, plus
 * a readable message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} pageFunction evaluated in the page, must return truthy
 * @param {any} arg passed to pageFunction
 * @param {{timeoutMs?: number, message?: string}} options
 */
async function pollPage(page, pageFunction, arg = undefined, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    await page.waitForFunction(pageFunction, arg, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(
      "Timed out after " +
        timeoutMs +
        "ms waiting in the page for " +
        (options.message ?? "condition") +
        ". Underlying: " +
        err.message
    );
  }
}

/**
 * Yield one macrotask turn. Not a sleep: a zero-delay task boundary, used where
 * a test must observe "after the microtask queue drained and the next task ran"
 * (the write-epoch tests depend on exactly that ordering). Duration is always
 * zero, so there is nothing to tune and nothing to flake.
 */
function nextTask() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  pollUntil,
  pollPage,
  nextTask
};
