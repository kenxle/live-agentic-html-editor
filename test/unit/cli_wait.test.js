// `lahe wait`, against a real helper.
//
// Owner: 3A. The five exit codes, the JSON-lines output, the cursor, and the
// promise that matters most: it consumes nothing. Two waits in a row on the
// same cursor say the same thing, and neither one changes an item.
//
// The helper here is the real one (src/service/index.js), started in process on
// an ephemeral port with its own temporary state directory. A wait tested
// against a fake helper proves nothing about the route's watermark.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const helperModule = require("../../src/service/index.js");
const wait = require("../../src/cli/commands/wait.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

const REVIEW = "wait-review";
// The page's own origin, registered on the review the way `add` registers it.
// D11's origin check allows only registered origins, and `wait` presents the
// one it reads out of the helper's owner-only readiness file.
const PAGE_ORIGIN = "http://127.0.0.1:4321";
const EXIT = protocol.WAIT.EXIT;

function collector() {
  const lines = [];
  const write = (text) => {
    lines.push(text);
  };
  write.lines = () => lines.join("").split("\n").filter(Boolean);
  write.json = () => write.lines().map((line) => JSON.parse(line));
  write.text = () => lines.join("");
  return write;
}

async function withHelper(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-wait-"));
  const helper = await helperModule.serve({
    port: 0,
    stateDir: dir,
    reviews: [REVIEW],
    origins: [PAGE_ORIGIN],
    quiet: true
  });
  try {
    return await run({ helper, dir });
  } finally {
    await helper.close();
  }
}

let counter = 0;
function postReadyItem(helper, overrides) {
  const item = record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the reviewer's words",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Coach",
        page_seq: 1
      },
      overrides || {}
    )
  );
  counter += 1;
  helper.log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "evt_wait_" + counter,
      review: REVIEW,
      item: item.id,
      rev: item.rev,
      page_path: item.page_path,
      page_title: item.page_title,
      page_seq: item.page_seq,
      payload: { draft: false, record: item }
    })
  ]);
  return item;
}

test("bad usage exits 4 and prints the usage", async () => {
  const out = collector();
  const err = collector();
  assert.equal(await wait.run([], { stdout: out, stderr: err }), EXIT.BAD_USAGE);
  assert.match(err.text(), /--review is required/);
  assert.match(err.text(), /usage: lahe wait/);

  const err2 = collector();
  assert.equal(await wait.run(["--review", "r1", "--sinse", "3"], { stdout: out, stderr: err2 }), EXIT.BAD_USAGE);
  assert.match(err2.text(), /unknown option/);

  const err3 = collector();
  assert.equal(await wait.run(["--review", "../etc"], { stdout: out, stderr: err3 }), EXIT.BAD_USAGE);
  assert.match(err3.text(), /safe id/);
});

test("no helper at all exits 2 and says how to start one", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-nohelper-"));
  const out = collector();
  const err = collector();
  const code = await wait.run(["--review", REVIEW], { stateDir: emptyDir, stdout: out, stderr: err });
  assert.equal(code, EXIT.HELPER_UNREACHABLE);
  assert.match(err.text(), /lahe serve/);
});

test("a review the helper has never heard of exits 3", async () => {
  await withHelper(async ({ dir }) => {
    const out = collector();
    const err = collector();
    const code = await wait.run(["--review", "no-such-review"], { stateDir: dir, stdout: out, stderr: err });
    assert.equal(code, EXIT.UNKNOWN_REVIEW);
    assert.match(err.text(), /no-such-review/);
  });
});

test("--state-dir points wait at a helper somewhere other than the default", async () => {
  await withHelper(async ({ dir, helper }) => {
    // No `stateDir` option: everything wait knows about this helper has to come
    // from the flag. `add` and `serve` both take it; before this, an agent on a
    // non-default state directory could only reach it through the environment.
    const parsed = wait.parseArgs(["--review", REVIEW, "--state-dir", dir]);
    assert.equal(parsed.error, null, "the flag is not a usage error");
    assert.equal(parsed.stateDir, dir);

    const out = collector();
    const err = collector();
    const code = await wait.run(
      ["--review", REVIEW, "--since", String(helper.log.currentSeq(REVIEW)), "--timeout", "0", "--state-dir", dir],
      { stdout: out, stderr: err }
    );
    assert.equal(
      code,
      EXIT.TIMEOUT,
      "it found the helper and the review's token through the flag alone:\n" + err.text()
    );
    assert.equal(out.json()[0].items, 0);
  });
});

test("nothing new inside the timeout exits 1, and still prints the cursor", async () => {
  await withHelper(async ({ dir, helper }) => {
    const seqBefore = helper.log.currentSeq(REVIEW);
    const out = collector();
    const code = await wait.run(["--review", REVIEW, "--since", String(seqBefore), "--timeout", "0"], {
      stateDir: dir,
      stdout: out,
      stderr: collector()
    });
    assert.equal(code, EXIT.TIMEOUT);
    const printed = out.json();
    assert.equal(printed.length, 1);
    assert.equal(printed[0].items, 0);
    assert.equal(typeof printed[0].cursor, "number");
  });
});

test("new ready work exits 0, prints one JSON line per item, then the cursor", async () => {
  await withHelper(async ({ dir, helper }) => {
    const since = helper.log.currentSeq(REVIEW);
    const item = postReadyItem(helper, { note: "shorten this heading", context: { quote: "Nine clients", prefix: null, suffix: null, heading: null, element: "p" } });

    const out = collector();
    const code = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "5"], {
      stateDir: dir,
      stdout: out,
      stderr: collector()
    });
    assert.equal(code, EXIT.NEW_WORK);

    const printed = out.json();
    assert.equal(printed.length, 2, "one item, then the cursor line");
    assert.equal(printed[0].id, item.id);
    assert.equal(printed[0].note, "shorten this heading", "the reviewer's words, verbatim");
    assert.equal(printed[0].quote, "Nine clients", "page text in the same data-named field review.json uses");
    assert.equal(printed[0].state, "ready");
    assert.equal(printed[0].page.path, "/");
    assert.ok(printed[1].cursor > since, "the cursor moved past the work it printed");
  });
});

test("waiting consumes nothing: the same cursor says the same thing twice", async () => {
  await withHelper(async ({ dir, helper }) => {
    const since = helper.log.currentSeq(REVIEW);
    postReadyItem(helper, { note: "this stays outstanding" });

    const first = collector();
    const firstCode = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "5"], {
      stateDir: dir,
      stdout: first,
      stderr: collector()
    });
    const second = collector();
    const secondCode = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "5"], {
      stateDir: dir,
      stdout: second,
      stderr: collector()
    });

    assert.equal(firstCode, EXIT.NEW_WORK);
    assert.equal(secondCode, EXIT.NEW_WORK, "a second waiter on the same cursor wakes too");
    assert.deepEqual(second.json()[0], first.json()[0], "and reads the same item");

    // Nothing moved: the item is still ready and no reply exists.
    const projection = require("../../src/service/projection.js");
    const items = projection.itemsFrom(helper.log.read(REVIEW));
    assert.equal(items[items.length - 1].state, "ready");
    assert.equal(items[items.length - 1].reply, null);
  });
});

test("a draft is never new work", async () => {
  await withHelper(async ({ dir, helper }) => {
    const since = helper.log.currentSeq(REVIEW);
    const draft = record.newItem({
      kind: record.KIND.COMMENT,
      state: record.STATE.DRAFT,
      note: "half a thou",
      page_origin: "http://127.0.0.1:4321",
      page_path: "/"
    });
    helper.log.append(REVIEW, [
      protocol.newEvent({
        event: protocol.EVENT.ITEM_CONTENT,
        event_id: "evt_draft_1",
        review: REVIEW,
        item: draft.id,
        rev: 1,
        payload: { draft: true, record: draft }
      })
    ]);

    const out = collector();
    const code = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "0"], {
      stateDir: dir,
      stdout: out,
      stderr: collector()
    });
    assert.equal(code, EXIT.TIMEOUT, "a draft keystroke does not wake a waiting agent");
    assert.equal(out.json()[0].items, 0);
  });
});

test("new events with an unreadable projection do not advance the cursor", async () => {
  // Finding 14: the wait route reported new work, but the follow-up review.read
  // fails. itemsFor then resolves nothing. Printing the cursor and exiting
  // NEW_WORK here would step the caller's watermark past events it never saw: a
  // silent, permanent skip. The command must refuse to advance instead.
  await withHelper(async ({ dir, helper }) => {
    const since = helper.log.currentSeq(REVIEW);
    postReadyItem(helper, { note: "ready work the read cannot resolve" });

    const realFetch = fetch;
    const readPath = protocol.route("review.read").path;
    const fakeFetch = async (url, init) => {
      if (String(url).indexOf(readPath) !== -1) {
        throw new Error("simulated review.read failure");
      }
      return realFetch(url, init);
    };

    const out = collector();
    const err = collector();
    const code = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "5"], {
      stateDir: dir,
      stdout: out,
      stderr: err,
      fetch: fakeFetch
    });

    assert.equal(code, EXIT.HELPER_UNREACHABLE, "an unresolved read is unreachable, not new work");
    assert.equal(out.text(), "", "the cursor is NOT printed, so the caller cannot advance past the ready work");
    assert.match(err.text(), /not advancing the cursor/i);
  });
});

test("a folded reply wakes a waiting agent", async () => {
  await withHelper(async ({ dir, helper }) => {
    const item = postReadyItem(helper, { note: "the item another agent answered" });
    const since = helper.log.currentSeq(REVIEW);
    helper.log.append(REVIEW, [
      protocol.newEvent({
        event: protocol.EVENT.REPLY_FOLDED,
        event_id: "evt_fold_1",
        review: REVIEW,
        item: item.id,
        rev: 1,
        payload: {
          accepted: true,
          state: record.STATE.NOT_HANDLED,
          file: "replies-other.jsonl",
          reply: { status: "not_handled", agent: "other", reason: "that file is generated" }
        }
      })
    ]);

    const out = collector();
    const code = await wait.run(["--review", REVIEW, "--since", String(since), "--timeout", "5"], {
      stateDir: dir,
      stdout: out,
      stderr: collector()
    });
    assert.equal(code, EXIT.NEW_WORK);
    const printed = out.json();
    assert.equal(printed[0].id, item.id);
    assert.equal(printed[0].reply.agent, "other");
    assert.equal(printed[0].reply.reason, "that file is generated");
  });
});
