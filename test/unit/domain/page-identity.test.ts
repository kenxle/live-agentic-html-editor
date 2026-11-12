/*
 * read-when: Changing src/domain/page-identity.ts, which page a record belongs to or how a page is named, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FILE_ORIGIN, KIND, STATE } from "../../../src/contract/record.ts";
import { newItem } from "../../../src/domain/item-revisions.ts";
import {
  identityOrigin,
  pageFrom,
  pageIdentityKey,
  pageIdentityKeyFor,
  pageKey,
  pageKeyFor,
  samePage,
  shortPath
} from "../../../src/domain/page-identity.ts";
import { callUntyped } from "../contract/support/untyped.ts";

function itemOn(origin: string, path: string): ReturnType<typeof newItem> {
  return newItem({
    kind: KIND.COMMENT,
    state: STATE.READY,
    note: "say which week this is about",
    page_origin: origin,
    page_path: path,
    page_title: "A page",
    page_seq: 1
  });
}

function pageOn(origin: string, path: string): { readonly origin: string; readonly path: string } {
  return { origin, path };
}

function fileLocation(path: string): { readonly origin: string; readonly pathname: string; readonly href: string } {
  return { origin: "null", pathname: path, href: "file://" + path };
}

test("a served page is its origin, its pathname, its title and the options the helper wrote, in this key order", () => {
  const page = pageFrom({ origin: "http://localhost:3000", pathname: "/dashboard", href: "http://localhost:3000/dashboard?tab=2#top", title: "Dashboard" });
  assert.deepEqual(page, {
    origin: "http://localhost:3000",
    path: "/dashboard",
    title: "Dashboard",
    seq: null,
    source_hint: null,
    aliases: [],
    path_aliases: [],
    spellings: []
  });
  assert.deepEqual(Object.keys(page), ["origin", "path", "title", "seq", "source_hint", "aliases", "path_aliases", "spellings"]);
});

test("the query string and the fragment collapse away", () => {
  const page = pageFrom({ origin: "http://localhost:3000", pathname: "/dashboard", href: "http://localhost:3000/dashboard?tab=2#top", title: "Dashboard" });
  assert.equal(page.path, "/dashboard");
  assert.equal(page.origin, "http://localhost:3000");
  assert.equal(page.title, "Dashboard");
});

test("a page with no pathname has no path, and a title that is not a string is no title", () => {
  assert.equal(pageFrom({ origin: "http://x", pathname: "" }).path, null);
  assert.equal(pageFrom({ origin: "http://x", pathname: "/a", title: 5 }).title, null);
  assert.equal(pageFrom({ origin: "http://x", pathname: "/a", title: "" }).title, "");
});

test("the options fill the sequence, the source hint and the three lists", () => {
  const page = pageFrom(
    { origin: "http://x.lahe.localhost", pathname: "/a" },
    {
      seq: 4,
      source_hint: "app/views/a.html.erb",
      aliases: ["http://127.0.0.1:61234", 7, "http://old"],
      path_aliases: ["/old.html", "old.html", 3, "/x/y"],
      spellings: ["http://a /p", "nospace", " leading", 9, "http://b /q r"]
    }
  );
  assert.equal(page.seq, 4);
  assert.equal(page.source_hint, "app/views/a.html.erb");
  assert.deepEqual(page.aliases, ["http://127.0.0.1:61234", "http://old"], "only strings are kept");
  assert.deepEqual(page.path_aliases, ["/old.html", "/x/y"], "only strings that start with a slash");
  assert.deepEqual(page.spellings, ["http://a /p", "http://b /q r"], "only strings that hold a space after their first character");
});

test("the lists are copies, and missing or wrong-typed options give empty lists and null", () => {
  const aliases = ["http://old"];
  const page = pageFrom({ origin: "http://x", pathname: "/a" }, { aliases });
  assert.notEqual(page.aliases, aliases);
  const bare = pageFrom({ origin: "http://x", pathname: "/a" }, { seq: "3", source_hint: null, aliases: "x", path_aliases: {}, spellings: null });
  assert.equal(bare.seq, null);
  assert.equal(bare.source_hint, null);
  assert.deepEqual([bare.aliases, bare.path_aliases, bare.spellings], [[], [], []]);
});

test("a page opened from disk gets the origin file and its last two path segments", () => {
  const page = pageFrom({ origin: "null", pathname: "/Users/x/docs/brief.html", href: "file:///Users/x/docs/brief.html" });
  assert.equal(page.origin, FILE_ORIGIN);
  assert.equal(page.path, "docs/brief.html");
});

test("a file page drops the query and the fragment, and is found by any of the three signs of a file", () => {
  assert.equal(pageFrom({ href: "file:///Users/x/docs/brief.html?q#f" }).path, "docs/brief.html");
  assert.equal(pageFrom({ origin: "http://x", href: "FILE:///Users/x/docs/brief.html" }).origin, "file");
  assert.equal(pageFrom({ origin: "null", pathname: "/Users/x/docs/brief.html" }).path, "docs/brief.html", "no href: the pathname names it");
  assert.equal(pageFrom({ pathname: "/Users/x/a.html" }).origin, "file", "no origin at all");
  assert.equal(pageFrom({ origin: "", pathname: "/a/b/c.html" }).path, "b/c.html");
});

test("a page with nothing to name it is the document", () => {
  assert.deepEqual(pageFrom(null), {
    origin: "file",
    path: "document",
    title: null,
    seq: null,
    source_hint: null,
    aliases: [],
    path_aliases: [],
    spellings: []
  });
  assert.equal(pageFrom(undefined).path, "document");
  assert.equal(pageFrom({}).path, "document");
});

test("the group key is origin plus path, so two dev servers do not collapse", () => {
  const a = itemOn("http://localhost:3000", "/dashboard");
  const b = itemOn("http://localhost:4000", "/dashboard");
  assert.equal(pageKey(a), "http://localhost:3000|/dashboard");
  assert.notEqual(pageKey(a), pageKey(b));
  assert.equal(pageKey(a), pageKey(itemOn("http://localhost:3000", "/dashboard")));
});

test("pageKeyFor and pageKey spell the same key, so an item and its page agree", () => {
  const item = itemOn("http://127.0.0.1:8080", "/report.html");
  assert.equal(pageKey(item), pageKeyFor(pageOn("http://127.0.0.1:8080", "/report.html")));
});

test("pageKey and pageKeyFor refuse a value that is not an object, and name which", () => {
  for (const value of [null, undefined, "x", 3]) {
    assert.throws(() => callUntyped(pageKey, value), { name: "TypeError", message: "pageKey expects an item" });
    assert.throws(() => callUntyped(pageKeyFor, value), { name: "TypeError", message: "pageKeyFor expects a page" });
  }
});

test("a missing origin or path is spelled as the word undefined, a known edge kept as it was", () => {
  assert.equal(callUntyped(pageKey, { page_path: "/a" }), "undefined|/a");
  assert.equal(callUntyped(pageKeyFor, { origin: null, path: "/a" }), "null|/a");
});

test("every spelling of a stable address is one name, and any other origin is itself", () => {
  assert.equal(identityOrigin("http://notes.lahe.localhost:7818"), "lahe-site:notes");
  assert.equal(identityOrigin("http://notes.lahe.localhost"), "lahe-site:notes");
  assert.equal(identityOrigin("http://notes.lahe"), "lahe-site:notes");
  assert.equal(identityOrigin("http://brief.docs.lahe.localhost:1483"), "lahe-site:brief.docs");
  assert.equal(identityOrigin("http://127.0.0.1:5000"), "http://127.0.0.1:5000");
  assert.equal(identityOrigin("http://notes.example.com"), "http://notes.example.com");
  assert.equal(identityOrigin("http://-bad.lahe"), "http://-bad.lahe", "a site name starts with a letter or digit");
  assert.equal(identityOrigin("http://Notes.lahe"), "http://Notes.lahe", "and is lowercase");
  assert.equal(identityOrigin(null), "null");
});

test("the identity keys join the identity origin and the path, and refuse what is not an object", () => {
  const item = itemOn("http://notes.lahe.localhost:7818", "/p.html");
  assert.equal(pageIdentityKey(item), "lahe-site:notes|/p.html");
  assert.equal(pageIdentityKeyFor(pageOn("http://notes.lahe", "/p.html")), "lahe-site:notes|/p.html");
  assert.equal(pageIdentityKey(itemOn("http://127.0.0.1:5000", "/p")), "http://127.0.0.1:5000|/p");
  assert.throws(() => callUntyped(pageIdentityKey, null), { name: "TypeError", message: "pageIdentityKey expects an item" });
  assert.throws(() => callUntyped(pageIdentityKeyFor, "x"), { name: "TypeError", message: "pageIdentityKeyFor expects a page" });
});

const FORMS = ["http://brief.docs.lahe.localhost:1483", "http://brief.docs.lahe.localhost", "http://brief.docs.lahe"];

test("every spelling of one stable address is the same page", () => {
  for (const a of FORMS) {
    for (const b of FORMS) {
      assert.equal(samePage(itemOn(a, "/page.html"), pageOn(b, "/page.html")), true, a + " vs " + b);
    }
  }
});

test("a different name, path or plain loopback port is still a different page", () => {
  const item = itemOn("http://brief.docs.lahe.localhost:1483", "/page.html");
  assert.equal(samePage(item, pageOn("http://other.docs.lahe.localhost", "/page.html")), false);
  assert.equal(samePage(item, pageOn("http://brief.docs.lahe.localhost", "/other.html")), false);
  assert.equal(samePage(itemOn("http://127.0.0.1:5000", "/p.html"), pageOn("http://127.0.0.1:5001", "/p.html")), false);
  assert.equal(samePage(item, pageOn("http://brief.docs.example.com", "/page.html")), false);
});

test("an item made on this page is this page's, and two documents on one origin never see each other's items", () => {
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/report.html"), pageOn("http://127.0.0.1:8080", "/report.html")), true);
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/report.html"), pageOn("http://127.0.0.1:8080", "/one-pager.html")), false);
});

test("two dev servers both serving /dashboard are two pages, as pageKey says", () => {
  assert.equal(samePage(itemOn("http://127.0.0.1:3000", "/dashboard"), pageOn("http://127.0.0.1:4000", "/dashboard")), false);
});

test("a spelling in the page's list matches an item written at that spelling", () => {
  const page = { ...pageOn("http://127.0.0.1:61234", "/index.html"), spellings: ["http://other.lahe.localhost:1483 /deep/page.html", "http://x.lahe /a b.html"] };
  assert.equal(samePage(itemOn("http://other.lahe", "/deep/page.html"), page), true, "the spelling's origin reads through identityOrigin");
  assert.equal(samePage(itemOn("http://x.lahe.localhost", "/a b.html"), page), true, "the path is everything after the first space");
  assert.equal(samePage(itemOn("http://other.lahe", "/deep/else.html"), page), false);
  assert.equal(samePage(itemOn("http://127.0.0.1:9999", "/deep/page.html"), page), false);
});

test("an old origin alias matches only at the page's own path or a path alias, never alone", () => {
  const page = {
    ...pageOn("http://brief.docs.lahe.localhost:1483", "/page.html"),
    aliases: ["http://127.0.0.1:61234"],
    path_aliases: ["/rendered/old.html"]
  };
  assert.equal(samePage(itemOn("http://127.0.0.1:61234", "/page.html"), page), true);
  assert.equal(samePage(itemOn("http://127.0.0.1:61234", "/rendered/old.html"), page), true);
  assert.equal(samePage(itemOn("http://127.0.0.1:61234", "/else.html"), page), false);
  assert.equal(
    samePage(itemOn("http://127.0.0.1:55555", "/rendered/old.html"), page),
    false,
    "a path alias never matches without an alias origin"
  );
});

test("a document opened from disk and served over http is one page, both ways round", () => {
  assert.equal(samePage(itemOn(FILE_ORIGIN, "report.html"), pageOn("http://127.0.0.1:8080", "/docs/report.html")), true);
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/docs/report.html"), pageOn(FILE_ORIGIN, "report.html")), true);
  assert.equal(samePage(itemOn(FILE_ORIGIN, "docs/report.html"), pageOn("http://127.0.0.1:8080", "/docs/report.html")), true);
});

test("two different documents from disk stay apart, and a file item and a differently named served one too", () => {
  assert.equal(samePage(itemOn(FILE_ORIGIN, "report.html"), pageOn(FILE_ORIGIN, "one-pager.html")), false);
  assert.equal(samePage(itemOn(FILE_ORIGIN, "report.html"), pageOn("http://127.0.0.1:8080", "/docs/one-pager.html")), false);
});

test("pageFrom builds a file page the rule can match", () => {
  const page = pageFrom(fileLocation("/Users/ken/docs/report.html"));
  assert.equal(page.origin, FILE_ORIGIN);
  assert.equal(page.path, "docs/report.html");
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/report.html"), page), true);
});

test("two index.html files in two folders are two pages, both off disk", () => {
  const a = pageFrom(fileLocation("/Users/ken/notes/index.html"));
  const b = pageFrom(fileLocation("/Users/ken/deck/index.html"));
  assert.notEqual(pageKeyFor(a), pageKeyFor(b), "the two keys are not the same key");
  assert.equal(samePage(itemOn(a.origin, a.path ?? ""), b), false);
  assert.equal(samePage(itemOn(b.origin, b.path ?? ""), a), false);
});

test("one index.html visited twice off disk is one page", () => {
  const a = pageFrom(fileLocation("/Users/ken/notes/index.html"));
  assert.equal(samePage(itemOn(a.origin, a.path ?? ""), a), true);
});

test("the mixed case: one document off disk and served, folder and all", () => {
  const fromDisk = pageFrom(fileLocation("/Users/ken/notes/index.html"));
  const item = itemOn(fromDisk.origin, fromDisk.path ?? "");
  assert.equal(samePage(item, pageOn("http://127.0.0.1:8080", "/notes/index.html")), true);
  assert.equal(samePage(item, pageOn("http://127.0.0.1:8080", "/deck/index.html")), false, "a different folder's index.html is not that document");
});

test("a record written before the folder rule still matches on its name alone", () => {
  assert.equal(samePage(itemOn(FILE_ORIGIN, "report.html"), pageOn("http://127.0.0.1:8080", "/docs/report.html")), true);
});

test("a document served at the origin root is the index document, both directions", () => {
  assert.equal(samePage(itemOn(FILE_ORIGIN, "index.html"), pageOn("http://127.0.0.1:8080", "/")), true);
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/"), pageOn(FILE_ORIGIN, "index.html")), true);
});

test("a directory path deeper in is that directory's index document", () => {
  const fromDisk = pageFrom(fileLocation("/Users/ken/docs/index.html"));
  assert.equal(samePage(itemOn(fromDisk.origin, fromDisk.path ?? ""), pageOn("http://127.0.0.1:8080", "/docs/")), true);
});

test("the root is not every document: a named page there stays its own page", () => {
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/"), pageOn(FILE_ORIGIN, "report.html")), false);
  assert.equal(samePage(itemOn(FILE_ORIGIN, "index.html"), pageOn("http://127.0.0.1:8080", "/report.html")), false);
  assert.equal(samePage(itemOn("http://127.0.0.1:8080", "/docs/report.html"), pageOn(FILE_ORIGIN, "index.html")), false);
});

test("the tail is as many segments as the shorter side has, with the query and fragment dropped", () => {
  assert.equal(samePage(itemOn(FILE_ORIGIN, "report.html?x=1#top"), pageOn("http://h", "/a/b/report.html")), true);
  assert.equal(samePage(itemOn(FILE_ORIGIN, "b/report.html"), pageOn("http://h", "/x/b/report.html")), true, "the shorter side is two segments");
  assert.equal(samePage(itemOn(FILE_ORIGIN, "a/b/report.html"), pageOn("http://h", "/x/c/b/report.html")), false);
  assert.equal(samePage(itemOn(FILE_ORIGIN, "x/y/report.html"), pageOn("http://h", "/a/b/report.html")), false, "equal depth compares every segment");
});

test("two documents served from two origins are never compared by tail", () => {
  assert.equal(samePage(itemOn("http://h:1", "/docs/report.html"), pageOn("http://h:2", "/docs/report.html")), false);
});

test("samePage refuses to guess at a missing item or page", () => {
  assert.throws(() => callUntyped(samePage, null, pageOn("http://x", "/a")), { name: "TypeError", message: "samePage expects an item" });
  assert.throws(() => callUntyped(samePage, itemOn("http://x", "/a"), null), { name: "TypeError", message: "samePage expects a page" });
  assert.throws(() => callUntyped(samePage, "x", pageOn("http://x", "/a")), TypeError);
});

test("a short path is the last two non-empty segments, the query and fragment dropped", () => {
  assert.equal(shortPath("/a/b/c.html?x"), "b/c.html");
  assert.equal(shortPath("c.html#top"), "c.html");
  assert.equal(shortPath("/Users/ken/docs/report.html"), "docs/report.html");
  assert.equal(shortPath("/a//b/"), "a/b");
});

test("a path with no segments comes back as it was, and nothing is an empty string", () => {
  assert.equal(shortPath("/"), "/");
  assert.equal(shortPath("?q=1"), "?q=1");
  assert.equal(shortPath(""), "");
  assert.equal(shortPath(null), "");
  assert.equal(shortPath(undefined), "");
});
