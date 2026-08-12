// MutationObserver capture over a subtree.
//
// This is the observation instrument behind the idempotence assertion, and it is
// worth being precise about why it exists.
//
// Final DOM equality is not a test of idempotence. If replay rewrites a region
// with byte-identical text on every pass, the final DOM is exactly what you
// expected, the equality assertion passes, and the reviewer's caret was
// destroyed on every pass along the way. The observable difference between "did
// nothing" and "did the same thing twice" is the mutation record, so that is
// what we observe.
//
// The observer runs inside the page and its records are serialized as they
// arrive, because a MutationRecord holds live node references that mean nothing
// once they cross the wire.

"use strict";

const { installBridge } = require("./bridge");

let tokenSeq = 0;

function nextToken() {
  tokenSeq += 1;
  return "obs-" + tokenSeq + "-" + Date.now();
}

const DEFAULT_OBSERVER_OPTIONS = {
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  subtree: true,
  attributes: false
};

/**
 * Start observing a subtree.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, options?: MutationObserverInit}} config
 *   `options` is merged over the defaults. Turn `attributes` on when the
 *   assertion is about the host DOM staying clean (AC6), and pass
 *   `attributeFilter` to keep the noise down.
 * @returns {Promise<{token: string, records: () => Promise<object[]>,
 *                    count: () => Promise<number>, stop: () => Promise<object[]>}>}
 */
async function observeMutations(page, config) {
  await installBridge(page);
  const token = nextToken();
  const selector = config.selector;
  const options = Object.assign({}, DEFAULT_OBSERVER_OPTIONS, config.options || {});

  await page.evaluate(
    function (args) {
      const reg = window.__laheTest;
      const root = document.querySelector(args.selector);
      if (!root) throw new Error("observeMutations: no element matches " + args.selector);
      const records = [];
      const observer = new MutationObserver(function (list) {
        for (let i = 0; i < list.length; i += 1) {
          records.push(reg.utils.serializeMutation(list[i]));
        }
      });
      observer.observe(root, args.options);
      reg.observers[args.token] = { observer: observer, records: records, selector: args.selector };
    },
    { token: token, selector: selector, options: options }
  );

  async function drain(disconnect) {
    return page.evaluate(
      function (args) {
        const reg = window.__laheTest;
        const entry = reg.observers[args.token];
        if (!entry) throw new Error("observeMutations: unknown observer token " + args.token);
        // MutationObserver callbacks are scheduled as microtasks, so records can
        // be pending when we look. takeRecords() flushes them, which is the
        // difference between a reliable assertion and a race.
        const pending = entry.observer.takeRecords();
        for (let i = 0; i < pending.length; i += 1) {
          entry.records.push(reg.utils.serializeMutation(pending[i]));
        }
        if (args.disconnect) {
          entry.observer.disconnect();
          delete reg.observers[args.token];
        }
        return entry.records.slice();
      },
      { token: token, disconnect: disconnect }
    );
  }

  return {
    token: token,
    selector: selector,
    /** Records so far, without stopping. */
    records: function () {
      return drain(false);
    },
    /** How many records so far, without stopping. */
    count: async function () {
      const records = await drain(false);
      return records.length;
    },
    /** Stop observing and return everything seen. */
    stop: function () {
      return drain(true);
    }
  };
}

/**
 * Run an action with an observer over a subtree and return what it saw.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, options?: MutationObserverInit,
 *          action: () => Promise<any>}} config
 * @returns {Promise<{records: object[], result: any}>}
 */
async function recordMutationsDuring(page, config) {
  const observer = await observeMutations(page, config);
  const result = await config.action();
  const records = await observer.stop();
  return { records: records, result: result };
}

/**
 * Format records for a failure message. One line per record, capped, because a
 * runaway replay can produce hundreds and the first few say everything.
 */
function formatRecords(records, limit = 8) {
  if (records.length === 0) return "(none)";
  const shown = records.slice(0, limit).map(function (record, index) {
    const parts = [index + 1 + ". " + record.type + " on " + record.targetPath];
    if (record.type === "characterData") {
      parts.push("     was: " + JSON.stringify(String(record.oldValue).slice(0, 120)));
      parts.push("     now: " + JSON.stringify(String(record.newValue).slice(0, 120)));
    }
    if (record.type === "childList") {
      parts.push("     removed " + record.removedCount + ", added " + record.addedCount);
      if (record.removedText) parts.push("     removed text: " + JSON.stringify(record.removedText.slice(0, 120)));
      if (record.addedText) parts.push("     added text:   " + JSON.stringify(record.addedText.slice(0, 120)));
    }
    if (record.type === "attributes") {
      parts.push("     " + record.attributeName + ": " + JSON.stringify(record.oldValue) + " -> " + JSON.stringify(record.newValue));
    }
    return parts.join("\n");
  });
  const more = records.length > limit ? "\n... and " + (records.length - limit) + " more" : "";
  return shown.join("\n") + more;
}

module.exports = {
  DEFAULT_OBSERVER_OPTIONS,
  observeMutations,
  recordMutationsDuring,
  formatRecords
};
