// The helper's name server for `.lahe` (src/service/name_server.js).
//
//   V54  Answers names under `.lahe` with loopback (A 127.0.0.1, AAAA ::1),
//        refuses everything else, and drops malformed packets without falling
//        over.
//
// Every server here binds a free UDP port on 127.0.0.1 and is closed in
// teardown. Nothing touches /etc/resolver.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");

const nameServer = require("../../src/service/name_server.js");

/** A DNS query packet for one name and type, built by hand. */
function query(name, type, options) {
  const opts = options || {};
  const labels = name.split(".").filter(Boolean);
  const parts = [];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(opts.id === undefined ? 0x1234 : opts.id, 0);
  header.writeUInt16BE(opts.flags === undefined ? 0x0100 : opts.flags, 2); // RD
  header.writeUInt16BE(opts.qdcount === undefined ? 1 : opts.qdcount, 4);
  parts.push(header);
  labels.forEach((label) => {
    parts.push(Buffer.from([label.length]));
    parts.push(Buffer.from(label, "ascii"));
  });
  parts.push(Buffer.from([0]));
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(opts.qclass === undefined ? 1 : opts.qclass, 2);
  parts.push(tail);
  return Buffer.concat(parts);
}

function rcode(packet) {
  return packet.readUInt16BE(2) & 0x0f;
}

/** The rdata of each answer, read from a response this server wrote. */
function answers(packet, questionLength) {
  const count = packet.readUInt16BE(6);
  const out = [];
  let at = 12 + questionLength;
  for (let i = 0; i < count; i += 1) {
    at += 2; // name pointer
    const type = packet.readUInt16BE(at);
    const length = packet.readUInt16BE(at + 8);
    out.push({ type, ttl: packet.readUInt32BE(at + 4), data: packet.slice(at + 10, at + 10 + length) });
    at += 10 + length;
  }
  return out;
}

test("an A query under .lahe gets 127.0.0.1, authoritative, same id and question", () => {
  const q = query("docs.ongoing.lahe", nameServer.TYPE.A);
  const r = nameServer.respond(q);
  assert.equal(r.readUInt16BE(0), 0x1234);
  const flags = r.readUInt16BE(2);
  assert.ok(flags & 0x8000, "a response");
  assert.ok(flags & 0x0400, "authoritative");
  assert.ok(flags & 0x0100, "RD echoed");
  assert.equal(rcode(r), 0);
  assert.deepEqual(r.slice(12, q.length), q.slice(12), "the question is echoed");
  const a = answers(r, q.length - 12);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, nameServer.TYPE.A);
  assert.deepEqual([...a[0].data], [127, 0, 0, 1]);
});

test("an AAAA query under .lahe gets ::1, and names are matched without regard to case", () => {
  const q = query("Docs.LAHE", nameServer.TYPE.AAAA);
  const a = answers(nameServer.respond(q), q.length - 12);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, nameServer.TYPE.AAAA);
  assert.deepEqual([...a[0].data], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test("another record type under .lahe is a name with no such record: no error, no answer", () => {
  const q = query("a.lahe", 16);
  const r = nameServer.respond(q);
  assert.equal(rcode(r), 0);
  assert.equal(r.readUInt16BE(6), 0);
});

test("names outside .lahe, the bare ending, and other classes are refused", () => {
  for (const name of ["example.com", "lahe.example.com", "a.lahe.localhost", "lahe", "evil-lahe"]) {
    const r = nameServer.respond(query(name, nameServer.TYPE.A));
    assert.equal(rcode(r), nameServer.RCODE.REFUSED, name);
    assert.equal(r.readUInt16BE(6), 0, name + " gets no answer");
  }
  assert.equal(rcode(nameServer.respond(query("a.lahe", nameServer.TYPE.A, { qclass: 3 }))), nameServer.RCODE.REFUSED);
});

test("malformed packets get no answer at all", () => {
  const good = query("a.lahe", nameServer.TYPE.A);
  const cases = {
    empty: Buffer.alloc(0),
    "short header": good.slice(0, 11),
    "a response, not a query": query("a.lahe", 1, { flags: 0x8100 }),
    "not a standard query": query("a.lahe", 1, { flags: 0x0900 }),
    "two questions": query("a.lahe", 1, { qdcount: 2 }),
    "no question": query("a.lahe", 1, { qdcount: 0 }),
    "cut off in the name": good.slice(0, 15),
    "cut off before the type": good.slice(0, good.length - 3),
    "a compression pointer in the name": Buffer.concat([good.slice(0, 12), Buffer.from([0xc0, 0x0c, 0, 1, 0, 1])]),
    "a label longer than 63": Buffer.concat([good.slice(0, 12), Buffer.from([64]), Buffer.alloc(64, 97), Buffer.from([0, 0, 1, 0, 1])])
  };
  for (const [what, packet] of Object.entries(cases)) {
    assert.equal(nameServer.respond(packet), null, what);
  }
});

function ask(port, packet) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", reject);
    socket.once("message", (msg) => {
      socket.close();
      resolve(msg);
    });
    socket.send(packet, port, "127.0.0.1");
  });
}

test("the server answers over UDP, reports each name it is asked, and survives garbage", async (t) => {
  const seen = [];
  const server = nameServer.createNameServer({ port: 0, onQuery: (name) => seen.push(name) });
  await server.start();
  t.after(() => server.close());
  const port = server.port();
  assert.ok(port > 0);

  await new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.send(Buffer.from([1, 2, 3]), port, "127.0.0.1", () => {
      socket.close();
      resolve();
    });
  });
  const q = query("V0123abcd.lahe", nameServer.TYPE.A);
  const r = await ask(port, q);
  assert.deepEqual([...answers(r, q.length - 12)[0].data], [127, 0, 0, 1]);
  assert.deepEqual(seen, ["v0123abcd.lahe"], "the name, lowercased; the garbage was never a query");
});
