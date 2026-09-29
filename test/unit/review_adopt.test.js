"use strict";

// Adopting a pre-session (legacy) review into an agent session. A review that
// belongs to no session can be taken into one, once, and the log records it.
// A review that already belongs to a real session keeps its owner.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const projection = require("../../src/service/projection.js");

function world() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-adopt-")), "state");
  fs.mkdirSync(dir);
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  return { dir, log, reviews };
}

test("adopt: a legacy review joins the session, meta and log both say so, and the projection reads the new owner", () => {
  const w = world();
  w.reviews.create({ id: "r_old", target_path: "/x/doc.html" });
  const adopted = w.reviews.adopt("r_old", "s_agent");
  assert.equal(adopted.agent_session_id, "s_agent");
  const meta = JSON.parse(fs.readFileSync(path.join(w.dir, "reviews", "r_old", "meta.json"), "utf8"));
  assert.equal(meta.agent_session_id, "s_agent");
  const events = w.log.read("r_old");
  assert.equal(events.filter((e) => e.event === protocol.EVENT.REVIEW_ADOPTED).length, 1);
  assert.equal(projection.project("r_old", events).review.agent_session_id, "s_agent");
  // Again is a no-op, not a second event.
  w.reviews.adopt("r_old", "s_agent");
  assert.equal(w.log.read("r_old").filter((e) => e.event === protocol.EVENT.REVIEW_ADOPTED).length, 1);
});

test("adopt: a review that belongs to a real session is refused and keeps its owner", () => {
  const w = world();
  w.reviews.create({ id: "r_mine", agent_session_id: "s_one", target_path: "/x/doc.html" });
  assert.throws(() => w.reviews.adopt("r_mine", "s_two"), /belongs to agent session s_one/);
  const meta = JSON.parse(fs.readFileSync(path.join(w.dir, "reviews", "r_mine", "meta.json"), "utf8"));
  assert.equal(meta.agent_session_id, "s_one");
});

test("adopt: create with adopt takes a legacy review, and without it still refuses", () => {
  const w = world();
  w.reviews.create({ id: "r_old", target_path: "/x/doc.html" });
  assert.throws(() => w.reviews.create({ id: "r_old", agent_session_id: "s_agent" }), /belongs to agent session legacy/);
  const got = w.reviews.create({ id: "r_old", agent_session_id: "s_agent", adopt: true });
  assert.equal(got.agent_session_id, "s_agent");
});

test("adopt: a meta.json lost after adoption is recovered from the log with the new owner", () => {
  const w = world();
  w.reviews.create({ id: "r_old", target_path: "/x/doc.html" });
  w.reviews.adopt("r_old", "s_agent");
  fs.rmSync(path.join(w.dir, "reviews", "r_old", "meta.json"));
  const again = reviewsModule.createReviews({ dir: w.dir, log: logModule.createEventLog({ dir: w.dir }) });
  again.loadFromDisk();
  assert.equal(again.get("r_old").agent_session_id, "s_agent");
});

// --- review.write: a page script holds the review token, so adoption needs the
// reviewer's own pending Library pick-up -------------------------------------

const routes = require("../../src/service/routes.js");
const catalogRequests = require("../../src/service/catalog_requests.js");

function writeWith(w, reviewId, body) {
  const queue = catalogRequests.createQueue({ dir: w.dir });
  return { queue, result: () => routes.handlerFor("review.write")({ review: reviewId, query: {}, body }, { log: w.log, reviews: w.reviews, catalogQueue: queue, now: () => Date.now() }) };
}

test("review.write adopt_session: refused with no pending pick-up, and the owner stays legacy", () => {
  const w = world();
  w.reviews.create({ id: "r_old", target_path: "/x/doc.html" });
  const res = writeWith(w, "r_old", { adopt_session: "s_agent" }).result();
  assert.equal(res.status, 409);
  assert.equal(w.reviews.get("r_old").agent_session_id, "legacy");
});

test("review.write adopt_session: a pick-up pending for that session adopts; one for another session does not", () => {
  const w = world();
  w.reviews.create({ id: "r_old", target_path: "/x/doc.html" });
  const agentSessions = require("../../src/service/agent_sessions.js");
  const store = agentSessions.createStore({ dir: w.dir });
  store.create({ id: "s_agent" });
  store.create({ id: "s_other" });
  const call = writeWith(w, "r_old", { adopt_session: "s_agent" });
  // A pick-up the Library queued for another agent.
  catalogRequests.writeAttach(w.dir, "s_other", Date.now());
  store.touchActivity("s_other");
  call.queue.append({ action: "pickup", review: "r_old", session: "legacy", for: "s_other" }, Date.now());
  assert.equal(call.result().status, 409, "pending for s_other, not s_agent");
  // The reviewer attaches s_agent and asks it.
  catalogRequests.writeAttach(w.dir, "s_agent", Date.now() + 1);
  store.touchActivity("s_agent");
  call.queue.append({ action: "pickup", review: "r_old", session: "legacy", for: "s_agent" }, Date.now());
  const ok = call.result();
  assert.equal(ok.status, 200);
  assert.equal(ok.body.adopted_into, "s_agent");
  assert.equal(w.reviews.get("r_old").agent_session_id, "s_agent");
});

test("review.write adopt_session: a review with a real session is never adopted, even with a pick-up pending", () => {
  const w = world();
  w.reviews.create({ id: "r_mine", agent_session_id: "s_one", target_path: "/x/doc.html" });
  const call = writeWith(w, "r_mine", { adopt_session: "s_agent" });
  call.queue.append({ action: "pickup", review: "r_mine", session: "s_one", for: "s_agent" }, Date.now());
  assert.equal(call.result().status, 409);
  assert.equal(w.reviews.get("r_mine").agent_session_id, "s_one");
});
