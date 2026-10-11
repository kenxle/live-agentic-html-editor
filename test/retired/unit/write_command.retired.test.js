// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/write_command.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: Idle restarts, the one-page server's own Host check and its record are removed; V7, V8 and V15 cover a notes site.
// They are kept as they were, so they still name the helpers they used.

test("a one-page server restarted from its record, as the idle sweep does, is still a one-page server", async (t) => {
  const staticServers = require("../../src/service/static_servers.js");
  const r = await rig(t);
  const folder = tempDir("lahe-write-restart-");
  fs.writeFileSync(path.join(folder, "sibling.html"), "<p>not for you</p>");
  const out = r.run("write", [path.join(folder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const sessionId = out.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const url = openUrl(out.stdout);
  const meta = staticServers.list(r.state, sessionId).find((m) => String(m.port) === url.port);
  assert.ok(meta && staticServers.isPageRoot(meta.root), "the record's root is the page itself");
  await staticServers.stopOne(r.state, sessionId, meta, staticServers.IDLE_REASON);
  const again = await staticServers.start({ dir: r.state, sessionId: sessionId, root: meta.root, logicalRoot: meta.logical_root, preferredPort: meta.port });
  const origin = "http://" + again.meta.host + ":" + again.meta.port;
  assert.equal((await get(origin + url.pathname)).status, 200);
  assert.equal((await get(origin + "/sibling.html")).status, 404);
  await assert.rejects(staticServers.registerMount(r.state, sessionId, again.meta, "/.lahe-source/abc/", folder), /no mounts/);
});


test("the one-page server refuses a Host that is not its own loopback address", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-host-");
  const out = r.run("write", [path.join(folder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const url = openUrl(out.stdout);
  assert.equal((await getWithHost(url.href, "attacker.example:" + url.port)).status, 400);
  assert.equal((await getWithHost(url.href, "127.0.0.1:" + url.port)).status, 200);
  assert.equal((await getWithHost(url.href, "localhost:" + url.port)).status, 200);
});

// Code lead 23: the record says it is a one-page server.

test("a one-page server's record carries page: true", async (t) => {
  const staticServers = require("../../src/service/static_servers.js");
  const r = await rig(t);
  const out = r.run("write", [path.join(tempDir("lahe-write-pagerec-"), "n.md")]);
  const sessionId = out.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const url = openUrl(out.stdout);
  const meta = staticServers.list(r.state, sessionId).find((m) => String(m.port) === url.port);
  assert.equal(meta.page, true);
});

// Security review 5.
