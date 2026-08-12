// Two browser contexts on one target.
//
// Separate contexts, not two tabs in one context, because separate contexts have
// separate storage. That is what makes them useful for two different tests, and
// the difference matters enough to state:
//
//   openTwoContexts    two independent browsers as far as storage is concerned.
//                      Use for "this origin's storage holds only its own slice"
//                      and for anything about a fresh session.
//   openTwoTabs        two pages sharing one context, so they share one browser
//                      storage bucket. This is the case D6 says must be refused
//                      with a reason: the second tab on the same target, where
//                      the loser writes its stale array over the winner's.
//
// A test that means the second and writes the first will pass while the bug it
// was written for is still there.

"use strict";

/**
 * Two independent contexts, each with a page at the same URL.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} url
 * @param {{contextOptions?: object}} [options]
 * @returns {Promise<{first: object, second: object, pages: object[], closeAll: () => Promise<void>}>}
 */
async function openTwoContexts(browser, url, options = {}) {
  const contextOptions = options.contextOptions || {};
  const firstContext = await browser.newContext(contextOptions);
  const secondContext = await browser.newContext(contextOptions);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  await firstPage.goto(url);
  await secondPage.goto(url);

  return {
    first: { context: firstContext, page: firstPage },
    second: { context: secondContext, page: secondPage },
    pages: [firstPage, secondPage],
    closeAll: async function () {
      await firstContext.close();
      await secondContext.close();
    }
  };
}

/**
 * Two pages in ONE context, so they share browser storage. This is the shape the
 * second-tab refusal (D6) is about.
 *
 * @returns {Promise<{context: object, first: object, second: object,
 *                    pages: object[], closeAll: () => Promise<void>}>}
 */
async function openTwoTabs(browser, url, options = {}) {
  const context = await browser.newContext(options.contextOptions || {});
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();

  await firstPage.goto(url);
  await secondPage.goto(url);

  return {
    context: context,
    first: { page: firstPage },
    second: { page: secondPage },
    pages: [firstPage, secondPage],
    closeAll: async function () {
      await context.close();
    }
  };
}

module.exports = {
  openTwoContexts,
  openTwoTabs
};
