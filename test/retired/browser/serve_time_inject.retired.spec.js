// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// This describe block was moved out of test/browser/serve_time_inject.spec.js. Nothing
// runs this file: Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: it proved a page server keeps serving with the helper down. The helper now
// serves the page itself, so there is no second process to stay up. That the
// library comes from the page's own address is proved by V11 and sites_pages.

// THE STATIC SERVER IS THE ONE THAT CANNOT BE DOWN.
//
// The helper and this server are separate processes, and the helper really does
// go down while the server keeps answering. When a copy of the bundle sat beside
// the page, the script line's onerror loaded it relatively and covered that
// case. Nothing is written beside the page any more, so the injected line points
// its src at the server's own reserved library route instead: the process that
// just answered the request for the page answers for the library too.
test.describe("the helper is down and the rail still loads, from the server that served the page", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-serve-nohelper-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(FIRST_BODY, ""));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    const output = execFileSync(process.execPath, [CLI, "review", pagePath, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const session = labelled(output, "session");
    const review = labelled(output, "review");
    const open = labelled(output, "open");
    expect(open, "`lahe review` printed the served URL").toBeTruthy();

    // Stop the HELPER and nothing else. `session close` would take the static
    // server with it, and the static server staying up is the whole point.
    const ready = JSON.parse(fs.readFileSync(path.join(stateDir, "service.json"), "utf8"));
    process.kill(ready.pid, "SIGTERM");
    await pollUntil(() => portClosed(ready.port), {
      timeoutMs: 15000,
      message: "the helper's port to stop accepting connections"
    });

    world = { root, stateDir, pagePath, env, session, review, open };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      execFileSync(process.execPath, [CLI, "session", "close", world.session], {
        cwd: REPO_ROOT,
        env: world.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // The helper is already gone; a close that complains about it is not a
      // test failure.
    }
    // The close leaves the helper up while the page is open. Stop it, and any
    // page server the close could not reach.
    await stopTempHelpers(world.stateDir);
  });

  test("the library comes off the static server's own route, with no helper and no file beside the page", async ({ page }) => {
    expect(
      fs.existsSync(path.join(path.dirname(world.pagePath), "lahe-layer.js")),
      "there is no sibling copy of the bundle to fall back to"
    ).toBe(false);

    await page.goto(world.open);
    await booted(page);

    expect(await page.evaluate(() => window.__lahe.review), "the rail is on this review").toBe(world.review);

    // It came from the primary src, which is this server's reserved route. The
    // onerror fallback names the helper, and the helper is down, so if the route
    // had not answered nothing would have booted at all.
    const srcs = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll("script"), (s) => s.getAttribute("src"))
    );
    expect(srcs, "the page loaded the library from the static server: " + JSON.stringify(srcs)).toContain(
      "/.lahe-library/lahe-layer.js"
    );

    // And it tells the reviewer the truth about the helper rather than pretending.
    await pollPage(page, () => window.__lahe.status() === "kept_locally", undefined, {
      timeoutMs: 20000,
      message: "the rail to say the work is kept in this browser"
    });
    const chips = await page.evaluate(() => window.__lahe.failures().map((chip) => chip.code));
    expect(chips, "the reviewer is told the helper is unreachable").toContain("HELPER_UNREACHABLE");
  });
});
