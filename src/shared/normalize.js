// The one normalizer.
//
// Owner: 0A-kernel. Imported by: the edit recorder (2A) when it mints a
// record's plain text, replay (2C) when it compares the live DOM to a record,
// the anchor engine (1C) for whitespace-tolerant matching, and the projection
// (3A) when it renders a region's text into review.json.
//
// No other module may define its own text normalization (D9, one shared
// normalizer). If any two of those normalize differently, no region ever
// compares equal to its record,
// replay rewrites every region on every pass, and the reviewer's caret gets
// fought twice a second. That is the exact bug this tool exists to remove.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.normalize = factory(root.LAHE.markers);
  } else {
    module.exports = factory(require("./markers.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Character classes
  // ---------------------------------------------------------------------------

  // Unicode spaces that render as a space and must compare equal to one.
  // U+200A (hair space) is in here deliberately: it has bitten this codebase's
  // sibling project through a test fixture that looked identical to a space.
  var UNICODE_SPACES =
    /[\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

  // Invisible characters that carry no meaning in prose and would otherwise
  // make two identical-looking strings compare unequal.
  //
  // Deliberately NOT in this set: U+200D (zero width joiner) and U+200C (zero
  // width non-joiner). Both are meaningful, in emoji sequences and in Persian,
  // Hindi, and other scripts. Removing them would change the reviewer's text.
  var INVISIBLES = /[\u200B\uFEFF\u00AD]/g;

  // C0 controls except tab, newline, carriage return, plus C1 controls.
  var CONTROLS_KEEP_WS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  // Every control character, including tab, newline, and carriage return.
  var CONTROLS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

  function stripControls(input) {
    return String(input).replace(CONTROLS_KEEP_WS, "");
  }

  function stripAllControls(input) {
    return String(input).replace(CONTROLS_ALL, "");
  }

  // ---------------------------------------------------------------------------
  // normalizeText: THE comparison key
  // ---------------------------------------------------------------------------
  //
  // Guarantees, each one relied on by a caller:
  //  - Idempotent. normalizeText(normalizeText(x)) === normalizeText(x).
  //  - Whitespace-insensitive. Rewrapping and reindenting a paragraph does not
  //    change its key, which is what makes R16 (a comment survives
  //    reformatting) reachable.
  //  - Case-sensitive and typography-preserving. "Fix" and "fix" are different
  //    words, and a curly quote is a real difference in a document about
  //    wording. Verification has a separate, explicitly named fallback for
  //    typographic differences (see foldTypography) rather than folding them
  //    here, because folding here would make a reviewer's punctuation fix
  //    invisible to replay.
  //  - Throws on a non-string. Fail loud: a silent String(undefined) here
  //    produces the literal text "undefined" as a comparison key, which will
  //    match nothing forever and look like an anchoring bug.
  function normalizeText(input) {
    if (typeof input !== "string") {
      throw new TypeError("normalizeText expects a string, got " + typeof input);
    }
    var s = input.normalize("NFC");
    s = stripControls(s);
    s = s.replace(INVISIBLES, "");
    s = s.replace(UNICODE_SPACES, " ");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  }

  // True when two strings are the same text for every purpose in this tool.
  function textEquals(a, b) {
    return normalizeText(a) === normalizeText(b);
  }

  // An additional transform, applied ON TOP of normalizeText, never instead of
  // it. Verification (3B) uses it for a second pass when the literal pass
  // misses, because a markdown source holds a straight quote where the built
  // HTML holds a curly one. Nothing else may use it: replay folding typography
  // would silently discard a reviewer's punctuation fix.
  function foldTypography(input) {
    return normalizeText(input)
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      .replace(/\u2026/g, "...");
  }

  // ---------------------------------------------------------------------------
  // cleanMarkup: THE markup key
  // ---------------------------------------------------------------------------
  //
  // Takes serialized HTML (in the browser: element.innerHTML) and returns
  // canonical markup safe to put in a record's before_html / after_html and to
  // hand to an agent.
  //
  // It is a pure string function on purpose: it is unit-testable in node:test
  // with no DOM, and the browser side just serializes first. The plan forbids
  // jsdom for anything in the layer; this keeps the markup rules out of that
  // ban entirely.
  //
  // What it guarantees:
  //  - No tool DOM survives (R33). Chrome nodes go with their subtree, wrapper
  //    nodes are unwrapped, every data-lahe* attribute and lahe-* class token
  //    is stripped.
  //  - No style attribute survives (R34, R35, AC6). The tool never writes one
  //    and never reports one.
  //  - No executable scheme survives in a URL attribute (R66), checked after
  //    control characters and entities are resolved.
  //  - No event handler attribute survives.
  //  - Script, style, template, noscript, iframe, object, embed are dropped
  //    with their contents.
  //  - Output is stable under reserialization: tag and attribute names are
  //    lowercased, attributes are sorted by name, b/i are renamed to
  //    strong/em, whitespace is collapsed outside <pre>.
  //
  // Attribute sorting is a deliberate trade. It loses the author's attribute
  // order in the markup an agent reads, and it buys a before_html/after_html
  // comparison that does not report a formatting change because Chromium
  // reserialized two attributes in a different order.

  var VOID_TAGS = {
    area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
    link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
  };

  var DROP_SUBTREE_TAGS = {
    script: 1, style: 1, template: 1, noscript: 1, iframe: 1, object: 1,
    embed: 1, applet: 1, frame: 1, frameset: 1
  };

  var RENAME_TAGS = { b: "strong", i: "em" };

  var PRESERVE_WS_TAGS = { pre: 1, textarea: 1 };

  var URL_ATTRS = {
    href: 1, src: 1, srcset: 1, action: 1, formaction: 1, poster: 1,
    "xlink:href": 1, data: 1, cite: 1, background: 1
  };

  var SAFE_SCHEMES = { http: 1, https: 1, mailto: 1, tel: 1 };

  var DROP_ATTRS = {
    style: 1,
    contenteditable: 1,
    spellcheck: 1,
    autocorrect: 1,
    autocapitalize: 1,
    "data-turbo-permanent": 1,
    srcdoc: 1
  };

  function decodeForSchemeCheck(value) {
    var s = String(value);
    s = s.replace(/&#[xX]([0-9a-fA-F]+);?/g, function (_m, hex) {
      var code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
    s = s.replace(/&#(\d+);?/g, function (_m, dec) {
      var code = parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
    s = s
      .replace(/&colon;?/gi, ":")
      .replace(/&tab;?/gi, "")
      .replace(/&newline;?/gi, "")
      .replace(/&amp;?/gi, "&");
    // Control characters and whitespace are removed before the scheme is read.
    // Both are how "java\tscript:" gets past a naive prefix check.
    return stripAllControls(s).replace(/\s+/g, "");
  }

  // Returns true when the URL value is safe to keep.
  function isSafeUrlValue(value) {
    var s = decodeForSchemeCheck(value);
    var colon = s.indexOf(":");
    if (colon === -1) return true; // relative, fragment, or query only
    var beforeColon = s.slice(0, colon);
    // A colon that appears after a path separator is not a scheme.
    if (/[/?#]/.test(beforeColon)) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(beforeColon)) return true;
    return Object.prototype.hasOwnProperty.call(SAFE_SCHEMES, beforeColon.toLowerCase());
  }

  function escapeAttrValue(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Parses a start or end tag beginning at index `at`. Returns null when the
  // "<" is not actually a tag, so a bare "<" in prose survives as text.
  function parseTag(html, at) {
    var i = at + 1;
    var closing = false;
    if (html.charAt(i) === "/") {
      closing = true;
      i += 1;
    }
    var nameStart = i;
    while (i < html.length && /[a-zA-Z0-9:_-]/.test(html.charAt(i))) i += 1;
    if (i === nameStart) return null;
    var name = html.slice(nameStart, i).toLowerCase();
    var attrs = [];
    var selfClosing = false;

    while (i < html.length) {
      while (i < html.length && /\s/.test(html.charAt(i))) i += 1;
      var ch = html.charAt(i);
      if (ch === ">") {
        i += 1;
        break;
      }
      if (ch === "/" && html.charAt(i + 1) === ">") {
        selfClosing = true;
        i += 2;
        break;
      }
      if (i >= html.length) break;
      var aStart = i;
      while (i < html.length && !/[\s=/>]/.test(html.charAt(i))) i += 1;
      if (i === aStart) {
        i += 1;
        continue;
      }
      var aName = html.slice(aStart, i).toLowerCase();
      var aValue = "";
      var save = i;
      while (i < html.length && /\s/.test(html.charAt(i))) i += 1;
      if (html.charAt(i) === "=") {
        i += 1;
        while (i < html.length && /\s/.test(html.charAt(i))) i += 1;
        var q = html.charAt(i);
        if (q === '"' || q === "'") {
          i += 1;
          var vStart = i;
          while (i < html.length && html.charAt(i) !== q) i += 1;
          aValue = html.slice(vStart, i);
          i += 1;
        } else {
          var uStart = i;
          while (i < html.length && !/[\s>]/.test(html.charAt(i))) i += 1;
          aValue = html.slice(uStart, i);
        }
      } else {
        i = save;
      }
      attrs.push({ name: aName, value: aValue });
    }

    return { name: name, closing: closing, selfClosing: selfClosing, attrs: attrs, end: i };
  }

  function cleanAttrs(attrs) {
    var kept = [];
    for (var k = 0; k < attrs.length; k += 1) {
      var name = attrs[k].name;
      var value = attrs[k].value;
      if (markers.isToolAttrName(name)) continue;
      if (Object.prototype.hasOwnProperty.call(DROP_ATTRS, name)) continue;
      if (name.indexOf("on") === 0) continue;
      if (name === "class") {
        var tokens = String(value)
          .split(/\s+/)
          .filter(function (t) {
            return t && !markers.isToolClassToken(t);
          });
        if (!tokens.length) continue;
        kept.push({ name: name, value: tokens.join(" ") });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(URL_ATTRS, name) && !isSafeUrlValue(value)) continue;
      kept.push({ name: name, value: value });
    }
    kept.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return kept;
  }

  function serializeStartTag(name, attrs) {
    var out = "<" + name;
    for (var k = 0; k < attrs.length; k += 1) {
      out += " " + attrs[k].name + '="' + escapeAttrValue(attrs[k].value) + '"';
    }
    return out + ">";
  }

  function collapseText(text) {
    return text.replace(UNICODE_SPACES, " ").replace(/\s+/g, " ");
  }

  function cleanMarkup(html) {
    if (typeof html !== "string") {
      throw new TypeError("cleanMarkup expects a string, got " + typeof html);
    }

    var out = [];
    var stack = [];
    var dropDepth = 0;
    var preDepth = 0;
    var i = 0;
    var n = html.length;

    function emitText(text) {
      if (dropDepth > 0 || !text) return;
      var t = text
        .normalize("NFC")
        .replace(INVISIBLES, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#160;/g, " ")
        .replace(/&#[xX]a0;/g, " ");
      t = stripControls(t);
      out.push(preDepth > 0 ? t : collapseText(t));
    }

    while (i < n) {
      var lt = html.indexOf("<", i);
      if (lt === -1) {
        emitText(html.slice(i));
        break;
      }
      if (lt > i) emitText(html.slice(i, lt));

      if (html.substr(lt, 4) === "<!--") {
        var endC = html.indexOf("-->", lt + 4);
        i = endC === -1 ? n : endC + 3;
        continue;
      }
      if (html.charAt(lt + 1) === "!" || html.charAt(lt + 1) === "?") {
        var gt = html.indexOf(">", lt);
        i = gt === -1 ? n : gt + 1;
        continue;
      }

      var tag = parseTag(html, lt);
      if (!tag) {
        emitText("<");
        i = lt + 1;
        continue;
      }
      i = tag.end;

      if (tag.closing) {
        var found = -1;
        for (var s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s].name === tag.name) {
            found = s;
            break;
          }
        }
        if (found === -1) continue;
        for (var p = stack.length - 1; p >= found; p -= 1) {
          var entry = stack[p];
          if (entry.action === "drop") dropDepth -= 1;
          if (entry.preserve) preDepth -= 1;
          if (entry.action === "keep" && dropDepth === 0) out.push("</" + entry.emitName + ">");
        }
        stack.length = found;
        continue;
      }

      var role = null;
      var attrsRaw = tag.attrs;
      for (var a = 0; a < attrsRaw.length; a += 1) {
        if (attrsRaw[a].name === markers.TOOL_ATTR) role = attrsRaw[a].value;
      }

      var action = "keep";
      if (dropDepth > 0) {
        action = "drop";
      } else if (
        Object.prototype.hasOwnProperty.call(DROP_SUBTREE_TAGS, tag.name) ||
        role === markers.ROLE_CHROME
      ) {
        action = "drop";
      } else if (role === markers.ROLE_WRAP) {
        action = "unwrap";
      }

      var emitName = Object.prototype.hasOwnProperty.call(RENAME_TAGS, tag.name)
        ? RENAME_TAGS[tag.name]
        : tag.name;
      var isVoid = Object.prototype.hasOwnProperty.call(VOID_TAGS, tag.name) || tag.selfClosing;

      if (isVoid) {
        if (action === "keep" && dropDepth === 0) {
          out.push(serializeStartTag(emitName, cleanAttrs(tag.attrs)));
        }
        continue;
      }

      if (action === "drop") dropDepth += 1;
      var preserve = action === "keep" && Object.prototype.hasOwnProperty.call(PRESERVE_WS_TAGS, tag.name);
      if (preserve) preDepth += 1;
      if (action === "keep" && dropDepth === 0) {
        out.push(serializeStartTag(emitName, cleanAttrs(tag.attrs)));
      }
      stack.push({ name: tag.name, emitName: emitName, action: action, preserve: preserve });
    }

    // Close anything the source left open, so the output is well formed.
    for (var q = stack.length - 1; q >= 0; q -= 1) {
      if (stack[q].action === "drop") dropDepth -= 1;
      if (stack[q].action === "keep" && dropDepth === 0) out.push("</" + stack[q].emitName + ">");
    }

    return out.join("").trim();
  }

  function markupEquals(a, b) {
    return cleanMarkup(a) === cleanMarkup(b);
  }

  // ---------------------------------------------------------------------------
  // Deliberate breaks: the one piece of whitespace folding must not lose
  // ---------------------------------------------------------------------------
  //
  // normalizeText folds every run of whitespace to one space, which is what
  // makes a rewrapped paragraph compare equal to the paragraph it was rewrapped
  // from. A break the reviewer TYPED is the one run of whitespace that is not
  // incidental: they pressed Enter because they wanted the block to become two
  // paragraphs. Folded away, that commit compares equal to the text it started
  // as, the edit is thrown out as a no-op, and the break the reviewer is
  // looking at vanishes the next time the page is rebuilt. Ken reported exactly
  // that on 2026-08-20: "it looks like it keeps it and then some edit later
  // reverts it".
  //
  // So a break is read off the MARKUP and never off a whitespace character:
  //
  //   <br>              one newline, a line break
  //   a block boundary  a blank line, a paragraph break
  //
  // Every other run of whitespace still folds to a single space, including the
  // newlines an HTML source carries because its author wrapped a line. That
  // keeps both halves of the distinction the tool needs: a rewrapped line is
  // still not a change, and a typed break is.
  //
  // Two front-ends produce this text, because two callers hold two different
  // things: blockText takes markup (the record's own html, a test fixture) and
  // blockTextFromNode takes a live element (the anchor engine, replay). They
  // share this file's break vocabulary and this file's folding tail, so they
  // cannot drift, and a unit test asserts they answer the same on one fixture.

  var LINE_BREAK = "\n";
  var PARAGRAPH_BREAK = "\n\n";

  // Tags whose edges are a paragraph break in text. Table cells are in here for
  // the same reason list items are: two cells read as two things, and running
  // their words together is how "Helloworld" gets into a record.
  var BLOCK_TAGS = {
    address: 1, article: 1, aside: 1, blockquote: 1, dd: 1, details: 1, div: 1,
    dl: 1, dt: 1, fieldset: 1, figcaption: 1, figure: 1, footer: 1, form: 1,
    h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, header: 1, hgroup: 1, hr: 1,
    li: 1, main: 1, nav: 1, ol: 1, p: 1, pre: 1, section: 1, summary: 1,
    table: 1, tbody: 1, td: 1, tfoot: 1, th: 1, thead: 1, tr: 1, ul: 1
  };

  // Whitespace that folds to a space. Every unicode space EXCEPT the newline,
  // which the folding tail below handles on its own.
  var HORIZONTAL_SPACES =
    /[\u0009\u000B\u000C\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

  // Whitespace inside <pre> is content, not layout, so it is carried across the
  // folding tail on these three private-use stand-ins and put back after. A
  // reviewer editing a code block keeps their indentation.
  var PRE_SPACE = "\uE000";
  var PRE_NEWLINE = "\uE001";
  var PRE_TAB = "\uE002";

  function protectPre(text) {
    return String(text)
      .replace(/ /g, PRE_SPACE)
      .replace(/\n/g, PRE_NEWLINE)
      .replace(/\t/g, PRE_TAB);
  }

  function restorePre(text) {
    return String(text)
      .replace(new RegExp(PRE_SPACE, "g"), " ")
      .replace(new RegExp(PRE_NEWLINE, "g"), "\n")
      .replace(new RegExp(PRE_TAB, "g"), "\t");
  }

  function hasOwn(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  // What a tag contributes to the text: a line break, a paragraph break, or
  // nothing at all. One answer, asked by both front-ends.
  function breakForTag(name) {
    if (name === "br") return LINE_BREAK;
    return hasOwn(BLOCK_TAGS, name) ? PARAGRAPH_BREAK : "";
  }

  // The folding tail, and the comparison key for text that carries breaks.
  // Everything normalizeText does, except that a newline survives: runs of
  // horizontal whitespace fold to one space, spaces beside a newline go, and
  // three or more newlines are one blank line.
  function normalizeBlockText(input) {
    if (typeof input !== "string") {
      throw new TypeError("normalizeBlockText expects a string, got " + typeof input);
    }
    var s = input.normalize("NFC");
    s = stripControls(s);
    s = s.replace(INVISIBLES, "");
    s = s.replace(/\r\n?/g, "\n");
    s = s.replace(HORIZONTAL_SPACES, " ");
    s = s.replace(/ +/g, " ");
    s = s.replace(/ ?\n ?/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  // True when two strings are the same text INCLUDING the breaks in them.
  function blockTextEquals(a, b) {
    return normalizeBlockText(a) === normalizeBlockText(b);
  }

  /**
   * The break-aware text of a live DOM node, without serializing it.
   *
   * Answers what blockText(element.innerHTML) answers, for a caller that holds
   * the element. `options.skip` decides which subtrees are not page content;
   * it defaults to the library's own chrome, which is what cleanMarkup drops on
   * the markup side.
   */
  function blockTextFromNode(node, options) {
    var opts = options || {};
    var skip =
      typeof opts.skip === "function"
        ? opts.skip
        : markers && typeof markers.isToolNode === "function"
          ? markers.isToolNode
          : null;
    var parts = [];
    collectNodeText(node, parts, skip, 0);
    return restorePre(normalizeBlockText(parts.join("")));
  }

  function collectNodeText(node, parts, skip, preDepth) {
    if (!node) return;
    var type = node.nodeType;
    if (type === 3 || type === 4) {
      // `data` on a real text node; `nodeValue` is the same string, and the
      // simulated DOMs the unit tests use spell it that way.
      var data =
        typeof node.data === "string" ? node.data : typeof node.nodeValue === "string" ? node.nodeValue : "";
      // Outside <pre>, a text node's own whitespace is INCIDENTAL: it is there
      // because the source wrapped a line. It folds here, exactly as cleanMarkup
      // folds it on the markup side, so that every newline left in the joined
      // string came from a break tag and is therefore deliberate.
      parts.push(preDepth > 0 ? protectPre(data) : collapseText(data));
      return;
    }
    if (type === 1) {
      if (skip && skip(node)) return;
      var tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
      if (hasOwn(DROP_SUBTREE_TAGS, tag)) return;
      if (tag === "br") {
        parts.push(LINE_BREAK);
        return;
      }
      var isBlock = hasOwn(BLOCK_TAGS, tag);
      if (isBlock) parts.push(PARAGRAPH_BREAK);
      var childPre = preDepth + (hasOwn(PRESERVE_WS_TAGS, tag) ? 1 : 0);
      for (var child = node.firstChild; child; child = child.nextSibling) {
        collectNodeText(child, parts, skip, childPre);
      }
      if (isBlock) parts.push(PARAGRAPH_BREAK);
      return;
    }
    if (type !== 9 && type !== 11) return;
    for (var kid = node.firstChild; kid; kid = kid.nextSibling) {
      collectNodeText(kid, parts, skip, preDepth);
    }
  }

  /**
   * The break-aware text of a markup string. Plain text passes through with its
   * own breaks kept, so a caller holding a record's `after` and a caller
   * holding a region's innerHTML get the same answer.
   */
  function blockText(html) {
    return reduce(html, [], true);
  }

  // ---------------------------------------------------------------------------
  // The two comparison modes (D7's format-only branch, D9's one normalizer)
  // ---------------------------------------------------------------------------
  //
  // Ordinary records compare on normalized text. A format-only record cannot:
  // its whole point is a change normalizeText is built to ignore, so comparing
  // it on text makes replay's format-only branch a silent no-op.
  //
  // The formatting vocabulary is closed at bold and italic and nothing else in
  // v1 (D4). cleanMarkup has already renamed b to strong and i to em, so the
  // comparator only ever sees two tag names. Everything outside that list is
  // dropped, which is what keeps the structural comparison a comparison of
  // FORMATTING rather than a comparison of the page's markup: a framework that
  // reserializes a span or adds a wrapper class must not read as a format
  // change.
  //
  // structureOf returns a canonical string, so two structures are compared with
  // ===, which is the same comparison the text mode makes. Every downstream
  // caller asks equalsInMode and never picks a comparison of its own.

  var STRUCTURAL_TAGS = ["em", "strong"];

  var MODE = { TEXT: "text", STRUCTURE: "structure" };
  var MODES = [MODE.TEXT, MODE.STRUCTURE];

  // Which mode a record kind compares in. The kind vocabulary lives in
  // record.js; this function takes the string so the normalizer stays at the
  // bottom of the dependency order and depends on nothing.
  var FORMAT_ONLY_KIND = "format_only";

  function modeFor(kind) {
    return kind === FORMAT_ONLY_KIND ? MODE.STRUCTURE : MODE.TEXT;
  }

  // Reduces markup to its formatting skeleton: the normalized text with the
  // emphasis spans still around the words they cover, and nothing else.
  //
  // keepTags is the closed list of tags that survive. Passing an empty list
  // gives the text mode's view of the same input, which is what makes the two
  // modes comparable on one string: both take markup, and the only difference
  // between them is whether emphasis counts.
  //
  // keepBreaks says whether a break the markup states survives the fold. The
  // text mode keeps it: that is the difference between "the reviewer split this
  // paragraph" and "nothing changed". The structure mode does not, because its
  // question is only which words are emphasized; it still emits the break so
  // the words on either side of it do not run together into one made-up word.
  function reduce(html, keepTags, keepBreaks) {
    var clean = cleanMarkup(html);
    var out = [];
    var preDepth = 0;
    var i = 0;
    while (i < clean.length) {
      var lt = clean.indexOf("<", i);
      if (lt === -1) {
        out.push(emitChunk(clean.slice(i), preDepth));
        break;
      }
      if (lt > i) out.push(emitChunk(clean.slice(i, lt), preDepth));
      var tag = parseTag(clean, lt);
      if (!tag) {
        out.push("<");
        i = lt + 1;
        continue;
      }
      i = tag.end;
      if (keepTags.indexOf(tag.name) !== -1) {
        out.push(tag.closing ? "</" + tag.name + ">" : "<" + tag.name + ">");
        continue;
      }
      if (hasOwn(PRESERVE_WS_TAGS, tag.name) && !tag.selfClosing) {
        if (tag.closing) preDepth = preDepth > 0 ? preDepth - 1 : 0;
        else preDepth += 1;
      }
      // Every other tag contributes its break, if it has one, and nothing else;
      // its text is emitted by the loop.
      out.push(breakForTag(tag.name));
    }
    var joined = out.join("");
    // The text between the kept markers is folded the way normalizeText folds
    // it, so whitespace differences are never a structural difference, or the
    // way normalizeBlockText folds it, which is the same except that a break
    // the markup stated is not whitespace.
    if (keepBreaks) return restorePre(normalizeBlockText(joined));
    return normalizeText(restorePre(joined));
  }

  function emitChunk(text, preDepth) {
    return preDepth > 0 ? protectPre(text) : text;
  }

  function structureOf(html) {
    return reduce(html, STRUCTURAL_TAGS, false);
  }

  // The text mode's view: every tag gone, the words left, and every break kept.
  //
  // It takes either kind of string, because both callers exist: a record's
  // plain `after` (which states the reviewer's breaks with real newlines) and a
  // fragment of markup (a format-only record's after_html). So, unlike
  // blockText, it does NOT run cleanMarkup first: cleanMarkup folds the
  // whitespace inside a text run, which is right for markup and would erase the
  // newlines a record's text puts there on purpose.
  //
  // The rule that makes both safe: a newline already in the string is a break,
  // and a tag contributes the break its name says it does.
  function textOf(value) {
    if (typeof value !== "string") {
      throw new TypeError("textOf expects a string, got " + typeof value);
    }
    var out = [];
    var dropDepth = 0;
    var preDepth = 0;
    var i = 0;
    while (i < value.length) {
      var lt = value.indexOf("<", i);
      if (lt === -1) {
        out.push(textChunk(value.slice(i), dropDepth, preDepth));
        break;
      }
      if (lt > i) out.push(textChunk(value.slice(i, lt), dropDepth, preDepth));
      var tag = parseTag(value, lt);
      if (!tag) {
        out.push("<");
        i = lt + 1;
        continue;
      }
      i = tag.end;
      if (hasOwn(DROP_SUBTREE_TAGS, tag.name) && !tag.selfClosing) {
        if (tag.closing) dropDepth = dropDepth > 0 ? dropDepth - 1 : 0;
        else dropDepth += 1;
        continue;
      }
      if (hasOwn(PRESERVE_WS_TAGS, tag.name) && !tag.selfClosing) {
        if (tag.closing) preDepth = preDepth > 0 ? preDepth - 1 : 0;
        else preDepth += 1;
      }
      if (dropDepth === 0) out.push(breakForTag(tag.name));
    }
    return restorePre(normalizeBlockText(out.join("")));
  }

  function textChunk(text, dropDepth, preDepth) {
    if (dropDepth > 0 || !text) return "";
    var t = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/g, " ")
      .replace(/&#[xX]a0;/g, " ");
    return preDepth > 0 ? protectPre(t) : t;
  }

  function structureEquals(a, b) {
    return structureOf(a) === structureOf(b);
  }

  // The one entry point. Fails loud on an unknown mode: a comparison that
  // silently fell back to text is exactly the format-only no-op this exists to
  // prevent, and it would look like a working feature.
  function equalsInMode(mode, a, b) {
    if (MODES.indexOf(mode) === -1) {
      throw new Error("equalsInMode: unknown comparison mode " + String(mode) + "; expected one of " + MODES.join(", "));
    }
    if (mode === MODE.STRUCTURE) return structureEquals(a, b);
    return textOf(a) === textOf(b);
  }

  // ---------------------------------------------------------------------------
  // canonicalTarget: THE target identity
  // ---------------------------------------------------------------------------
  //
  // R11: a path reached through a symlink, a URL with or without a trailing
  // slash, and the localhost and 127.0.0.1 spellings of one address all resolve
  // to the same review.
  //
  // This function is pure and does no filesystem work, so symlink resolution is
  // the caller's job: the service calls fs.realpathSync first and passes
  // {resolved: true}. The returned object says which, so a downstream reader is
  // never guessing.
  //
  // It deliberately does NOT percent-decode a route path. Decoding is exactly
  // the traversal primitive D11 forbids: %2e%2e%2f decodes to "../". Percent
  // escapes are case-normalized instead, which is enough to converge two
  // spellings of the same route.

  var LOOPBACK_NAMES = { localhost: 1, "127.0.0.1": 1, "::1": 1, "[::1]": 1, "0:0:0:0:0:0:0:1": 1 };
  var CANONICAL_HOST = "localhost";
  var DEFAULT_PORTS = { "http:": "80", "https:": "443" };

  function isLoopbackHost(host) {
    if (typeof host !== "string" || !host) return false;
    var h = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (Object.prototype.hasOwnProperty.call(LOOPBACK_NAMES, h)) return true;
    if (Object.prototype.hasOwnProperty.call(LOOPBACK_NAMES, host.toLowerCase())) return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/\.localhost$/.test(h)) return true;
    return false;
  }

  function resolveSegments(pathname) {
    var parts = String(pathname).split("/");
    var outParts = [];
    for (var i = 0; i < parts.length; i += 1) {
      var seg = parts[i];
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        outParts.pop();
        continue;
      }
      outParts.push(seg.replace(/%[0-9a-fA-F]{2}/g, function (m) {
        return m.toUpperCase();
      }));
    }
    return "/" + outParts.join("/");
  }

  function canonicalTarget(input, options) {
    var opts = options || {};
    if (typeof input !== "string" || !input.trim()) {
      throw new TypeError("canonicalTarget expects a non-empty string");
    }
    var raw = stripAllControls(input.trim());

    if (/^https?:\/\//i.test(raw)) {
      var u = new URL(raw);
      var host = u.hostname.toLowerCase();
      if (isLoopbackHost(host)) host = CANONICAL_HOST;
      var port = u.port;
      if (port && DEFAULT_PORTS[u.protocol.toLowerCase()] === port) port = "";
      var pathPart = resolveSegments(u.pathname);
      if (pathPart !== "/" && pathPart.charAt(pathPart.length - 1) === "/") {
        pathPart = pathPart.slice(0, -1);
      }
      var search = u.search === "?" ? "" : u.search;
      var canonical = u.protocol.toLowerCase() + "//" + host + (port ? ":" + port : "") + pathPart + search;
      return {
        kind: "route",
        canonical: canonical,
        host: host,
        port: port || null,
        isLocal: isLoopbackHost(u.hostname),
        resolved: true
      };
    }

    var filePath = raw;
    if (/^file:\/\//i.test(raw)) {
      var fu = new URL(raw);
      if (fu.hostname && !isLoopbackHost(fu.hostname)) {
        throw new Error("canonicalTarget: a file:// URL with a remote host is not a local target: " + raw);
      }
      try {
        filePath = decodeURIComponent(fu.pathname);
      } catch (err) {
        throw new Error("canonicalTarget: malformed percent-escape in file URL: " + raw);
      }
    }

    if (filePath.charAt(0) !== "/") {
      throw new Error(
        "canonicalTarget: expected an absolute file path, a file:// URL, or an http(s) URL; got " + input
      );
    }

    var canonicalPath = resolveSegments(filePath).replace(/%[0-9A-F]{2}/g, function (m) {
      return decodeURIComponent(m);
    });
    if (canonicalPath.length > 1 && canonicalPath.charAt(canonicalPath.length - 1) === "/") {
      canonicalPath = canonicalPath.slice(0, -1);
    }
    return {
      kind: "file",
      canonical: canonicalPath,
      host: null,
      port: null,
      isLocal: true,
      resolved: opts.resolved === true
    };
  }

  // A human-readable, filesystem-safe fragment for a target. Never a path
  // component on its own: the review file writer pairs it with a hash of the
  // canonical target (D11, never derive a path component from untrusted text).
  var SLUG_MAX = 40;

  function targetSlug(canonical) {
    var s = typeof canonical === "string" ? canonical : String(canonical);
    var tail = s.split("?")[0].split("/").filter(Boolean).pop() || "target";
    var slug = tail
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/^-+|-+$/g, "");
    return slug || "target";
  }

  return {
    stripControls: stripControls,
    stripAllControls: stripAllControls,
    normalizeText: normalizeText,
    textEquals: textEquals,
    foldTypography: foldTypography,
    cleanMarkup: cleanMarkup,
    markupEquals: markupEquals,
    LINE_BREAK: LINE_BREAK,
    PARAGRAPH_BREAK: PARAGRAPH_BREAK,
    BLOCK_TAGS: BLOCK_TAGS,
    breakForTag: breakForTag,
    normalizeBlockText: normalizeBlockText,
    blockTextEquals: blockTextEquals,
    blockText: blockText,
    blockTextFromNode: blockTextFromNode,
    STRUCTURAL_TAGS: STRUCTURAL_TAGS,
    MODE: MODE,
    MODES: MODES,
    modeFor: modeFor,
    structureOf: structureOf,
    structureEquals: structureEquals,
    textOf: textOf,
    equalsInMode: equalsInMode,
    isSafeUrlValue: isSafeUrlValue,
    canonicalTarget: canonicalTarget,
    isLoopbackHost: isLoopbackHost,
    targetSlug: targetSlug,
    SLUG_MAX: SLUG_MAX,
    SAFE_SCHEMES: SAFE_SCHEMES
  };
});
