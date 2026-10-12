// The helper's own name server for `.lahe` (stable addresses, macOS opt-in).
//
// Owner: stable addresses, lahe-names workstream. `lahe install --lahe-names`
// writes /etc/resolver/lahe, which sends every `.lahe` lookup on this Mac to
// 127.0.0.1 at the port install.json records. This answers them.
//
// WHAT IT ANSWERS. A query for a name under `.lahe` (one label or more before
// it) gets A 127.0.0.1 or AAAA ::1, marked authoritative. Another record type
// for such a name gets no error and no answer. Anything else, the bare `lahe`
// included, gets REFUSED. A packet that is not one well-formed standard query
// gets nothing at all: no reply, no exception.
//
// WHY THAT LITTLE. It only has to make `<name>.lahe` reach this computer. The
// helper still checks every Host against its registry, and it refuses `.lahe`
// Hosts until it has proved that this server is what answers `.lahe` lookups
// here (src/service/addresses.js). So the server reports each name it is asked,
// for that proof.
//
// Node `dgram` only. Bound to 127.0.0.1, never to another interface.

"use strict";

var dgram = require("node:dgram");

var TYPE = { A: 1, AAAA: 28 };
var CLASS_IN = 1;
var RCODE = { NOERROR: 0, REFUSED: 5 };
var TTL_SECONDS = 5;
var ENDING = "lahe";

/**
 * The one question in a standard query, or null when the packet is not one.
 *
 * @param {Buffer} packet
 * @returns {{id: number, rd: boolean, name: string, type: number, qclass: number, end: number}|null}
 */
function parseQuery(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12) return null;
  var flags = packet.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response
  if ((flags >> 11) & 0x0f) return null; // not opcode QUERY
  if (packet.readUInt16BE(4) !== 1) return null;
  var at = 12;
  var labels = [];
  var length = 0;
  for (;;) {
    if (at >= packet.length) return null;
    var size = packet[at];
    at += 1;
    if (size === 0) break;
    if (size > 63) return null; // a compression pointer, or too long
    if (at + size > packet.length) return null;
    labels.push(packet.toString("latin1", at, at + size).toLowerCase());
    length += size + 1;
    if (length > 255) return null;
    at += size;
  }
  if (at + 4 > packet.length) return null;
  return {
    id: packet.readUInt16BE(0),
    rd: !!(flags & 0x0100),
    name: labels.join("."),
    type: packet.readUInt16BE(at),
    qclass: packet.readUInt16BE(at + 2),
    end: at + 4
  };
}

/** Is this a name the server answers: one label or more, then `lahe`? */
function isLaheName(name) {
  var labels = String(name).split(".");
  return labels.length >= 2 && labels[labels.length - 1] === ENDING && labels.every(Boolean);
}

function record(type, data) {
  var head = Buffer.alloc(12);
  head.writeUInt16BE(0xc00c, 0); // the name, pointing at the question
  head.writeUInt16BE(type, 2);
  head.writeUInt16BE(CLASS_IN, 4);
  head.writeUInt32BE(TTL_SECONDS, 6);
  head.writeUInt16BE(data.length, 10);
  return Buffer.concat([head, data]);
}

/**
 * The response to a query packet, or null to drop it.
 *
 * @param {Buffer} packet
 * @returns {Buffer|null}
 */
function respond(packet) {
  var q = parseQuery(packet);
  if (!q) return null;
  var ours = q.qclass === CLASS_IN && isLaheName(q.name);
  var answer = [];
  if (ours && q.type === TYPE.A) answer.push(record(TYPE.A, Buffer.from([127, 0, 0, 1])));
  if (ours && q.type === TYPE.AAAA) {
    var six = Buffer.alloc(16);
    six[15] = 1;
    answer.push(record(TYPE.AAAA, six));
  }
  var header = Buffer.alloc(12);
  header.writeUInt16BE(q.id, 0);
  header.writeUInt16BE(0x8000 | 0x0400 | (q.rd ? 0x0100 : 0) | (ours ? RCODE.NOERROR : RCODE.REFUSED), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answer.length, 6);
  return Buffer.concat([header, packet.slice(12, q.end)].concat(answer));
}

/**
 * A UDP name server on 127.0.0.1.
 *
 * @param {{port: number, onQuery?: function(string): void, log?: function(string): void}} options
 *   `onQuery` gets each well-formed query's name, lowercased
 * @returns {{start: function(): Promise<void>, port: function(): number|null, close: function(): Promise<void>}}
 */
function createNameServer(options) {
  var opts = options || {};
  var socket = null;
  function say(line) {
    if (typeof opts.log === "function") {
      try { opts.log(line); } catch (err) { /* a log that cannot be written is not a reason to stop answering */ }
    }
  }
  return {
    start: function () {
      return new Promise(function (resolve, reject) {
        socket = dgram.createSocket("udp4");
        socket.once("error", reject);
        socket.on("message", function (packet, from) {
          var q = parseQuery(packet);
          if (!q) return;
          if (typeof opts.onQuery === "function") {
            try { opts.onQuery(q.name); } catch (err) { /* the answer still goes out */ }
          }
          var reply = respond(packet);
          if (reply) socket.send(reply, from.port, from.address);
        });
        socket.bind(opts.port || 0, "127.0.0.1", function () {
          socket.removeListener("error", reject);
          socket.on("error", function (err) { say("name server error: " + err.message); });
          resolve();
        });
      });
    },
    port: function () {
      try { return socket ? socket.address().port : null; } catch (err) { return null; }
    },
    close: function () {
      return new Promise(function (resolve) {
        if (!socket) return resolve();
        var s = socket;
        socket = null;
        try { s.close(resolve); } catch (err) { resolve(); }
      });
    }
  };
}

module.exports = {
  TYPE: TYPE,
  RCODE: RCODE,
  ENDING: ENDING,
  parseQuery: parseQuery,
  isLaheName: isLaheName,
  respond: respond,
  createNameServer: createNameServer
};
