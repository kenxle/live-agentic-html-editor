// The scripted agent for the seam specs (plan Task 3.4).
//
// It follows the contract in review.json, and it knows only two things: the
// item, parsed from review.json (or from a drain line), and the source text.
// It never reads the page, the browser's store or window.__lahe. What it
// returns is the new source text; the spec writes it and rebuilds.
//
// What it does, by the contract's lines:
//   new_blocks        placed after the anchor, in order, each with its tag and
//                     its bold and italic; only the blocks not already there
//   placement         after_anchor, or start_of_container (top of the file)
//   from_anchor       the anchor is split: it becomes anchor_after_html, and the
//                     tail is placed as its own block
//   anchor_tag_after  the anchor's element changes to that tag
//   literal text      Markdown: every syntax character backslash-escaped, < as
//                     &lt; and & as &amp;. HTML: the block's html is already
//                     escaped markup and goes in as it is
//   remove_blocks     a take-back: those blocks come out, nothing goes in
//   after_history     a block that still shows an earlier revision's words in
//                     its place is rewritten to this revision's (the fixes)
//   region.stamp      carried onto the anchor in HTML when stamp_carriable
//
// The old-contract agent (options.oldContract) predates new_blocks: in HTML it
// applies after_html as the anchor's content, and in Markdown it pastes after
// as paragraphs in place of the anchor.

"use strict";

const path = require("node:path");

const normalize = require(path.join(__dirname, "..", "..", "..", "src", "shared", "normalize.js"));

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function fold(text) {
  return normalize.foldTypography(String(text || "")).replace(/\s+/g, " ").trim();
}

function decode(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** The words of a piece of html: tags gone, entities read. */
function htmlWords(html) {
  return fold(decode(String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<\/li>/gi, " ").replace(/<[^>]*>/g, " ")));
}

function blockWords(block) {
  return htmlWords(block.html);
}

// ---------------------------------------------------------------------------
// The item
// ---------------------------------------------------------------------------

/** A drain line holds the page's text under page; lift it to the item's shape. */
function itemFromDrainLine(line) {
  const out = Object.assign({}, line);
  delete out.page;
  Object.assign(out, line.page || {});
  if (!out.id && line.item) out.id = line.item;
  return out;
}

/** The edit's words: review.json calls them after_full. */
function afterText(item) {
  return item.after_full != null ? item.after_full : item.after;
}

function runBlocks(item) {
  return Array.isArray(item.new_blocks) ? item.new_blocks : [];
}

/** The anchor's tag, from the innermost hop of region.where ("p#p2.lede"). */
function anchorTag(item) {
  const where = item.region && item.region.where;
  const hops = Array.isArray(where) ? where : typeof where === "string" ? where.split(/\s*>\s*/) : [];
  const last = hops.length ? String(hops[hops.length - 1]) : "";
  const m = /^([a-z0-9]+)/i.exec(last);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Every earlier revision's run, newest first. review.json's after_history
 * entries carry the whole sitting as after_html (the anchor's words, then each
 * block as its element), so the blocks are read back out of it.
 */
function historyRuns(item) {
  const history = Array.isArray(item.after_history) ? item.after_history : [];
  return history
    .filter((h) => h && h.rev !== item.rev)
    .reverse()
    .map((h) => {
      if (Array.isArray(h.new_blocks)) return h.new_blocks;
      const out = [];
      const re = /<(h[2-4]|p|ul|ol)>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = re.exec(String(h.after_html || "")))) out.push({ tag: m[1].toLowerCase(), html: m[2] });
      return out;
    })
    .filter((r) => r.length);
}

/** The words the anchor may show in the source: its before, or its new words. */
function anchorWordsList(item) {
  const out = [];
  // A take-back's before is the undone sitting; its after is the anchor alone.
  if (Array.isArray(item.remove_blocks) && item.remove_blocks.length) {
    if (item.after_html != null) out.push(htmlWords(item.after_html));
    if (afterText(item) != null) out.push(fold(afterText(item)));
  }
  if (item.before_html != null) out.push(htmlWords(item.before_html));
  if (item.before != null) out.push(fold(item.before));
  if (item.anchor_after_html != null) out.push(htmlWords(item.anchor_after_html));
  return out.filter((w, i, all) => w && all.indexOf(w) === i);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const MD_HEADING = { h2: "## ", h3: "### ", h4: "#### " };

/** Literal text for a Markdown source: every syntax character escaped. */
function mdEscape(text) {
  let out = String(text)
    .replace(/\\/g, "\\\\")
    .replace(/[`*_[\]#+\-!|~>{}()]/g, (c) => "\\" + c)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  // "1." at the very start of a line would start a numbered list.
  out = out.replace(/^(\d+)\./, "$1\\.");
  return out;
}

/** Inline html (strong, em, br, text) as Markdown. */
function mdInline(html) {
  let out = "";
  const re = /<(\/?)(strong|b|em|i|br|not-bold|not-italic)\s*\/?>|([^<]+)|(<[^>]*>)/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    if (m[3] !== undefined) out += mdEscape(decode(m[3]));
    else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (tag === "br") out += "\\\n";
      else if (tag === "strong" || tag === "b") out += "**";
      else if (tag === "em" || tag === "i") out += "*";
    }
  }
  return out.replace(/\s+$/, "");
}

function mdItems(html) {
  const items = [];
  const re = /<li>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(String(html)))) items.push(m[1]);
  return items;
}

/** A block (tag and inner html) as Markdown source. */
function mdBlock(tag, html) {
  if (tag === "ul") return mdItems(html).map((li) => "- " + mdInline(li)).join("\n");
  if (tag === "ol") return mdItems(html).map((li, i) => i + 1 + ". " + mdInline(li)).join("\n");
  return (MD_HEADING[tag] || "") + mdInline(html);
}

/** Words of a Markdown block, as the page will show them. */
function mdWords(src) {
  const lines = String(src)
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""));
  let text = lines.join(" ");
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      out += text[i + 1] === "\n" ? " " : text[i + 1];
      i += 1;
    } else if (c === "*" || c === "_") {
      // emphasis marker
    } else out += c;
  }
  return fold(decode(out));
}

function mdKind(src) {
  const first = String(src).split("\n")[0];
  const h = /^(#{1,6})\s/.exec(first);
  if (h) return "h" + h[1].length;
  if (/^\s*[-*+]\s/.test(first)) return "ul";
  if (/^\s*\d+\.\s/.test(first)) return "ol";
  return "p";
}

function parseMd(text) {
  let front = null;
  let body = String(text);
  const fm = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (fm) {
    front = fm[0].replace(/\n$/, "");
    body = body.slice(fm[0].length);
  }
  const blocks = body
    .split(/\n[ \t]*\n/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim());
  return { front: front, blocks: blocks };
}

function writeMd(doc) {
  return (doc.front ? doc.front + "\n\n" : "") + doc.blocks.join("\n\n") + "\n";
}

function findMdAnchor(doc, item) {
  const wanted = anchorWordsList(item);
  for (let i = 0; i < doc.blocks.length; i += 1) {
    if (wanted.indexOf(mdWords(doc.blocks[i])) !== -1) return i;
  }
  throw new Error("scripted agent: the anchor '" + (wanted[0] || "") + "' is not in the Markdown source");
}

function placeMarkdown(text, item, options) {
  const opts = options || {};
  const doc = parseMd(text);
  const startOfContainer = item.placement === "start_of_container";
  let at = startOfContainer ? -1 : findMdAnchor(doc, item);

  if (opts.oldContract) {
    // The old contract: the edit's after, pasted as paragraphs.
    const paras = String(afterText(item) || "")
      .split(/\n\s*\n/)
      .map((p) => mdEscape(p.trim()))
      .filter(Boolean);
    if (at === -1) doc.blocks.splice(0, 0, ...paras);
    else doc.blocks.splice(at, 1, ...paras);
    return writeMd(doc);
  }

  if (Array.isArray(item.remove_blocks) && item.remove_blocks.length) {
    item.remove_blocks.forEach((b) => {
      const words = blockWords(b);
      for (let i = at + 1; i < doc.blocks.length; i += 1) {
        if (mdWords(doc.blocks[i]) === words) {
          doc.blocks.splice(i, 1);
          return;
        }
      }
    });
    // The take-back's after is what the anchor should say again.
    if (at !== -1 && item.after_html != null) {
      const tag = anchorTag(item) || mdKind(doc.blocks[at]);
      const again = mdBlock(tag, item.after_html);
      if (again !== doc.blocks[at] && htmlWords(item.after_html)) doc.blocks[at] = again;
    }
    return writeMd(doc);
  }

  if (at !== -1 && (item.anchor_tag_after || (item.anchor_after_html != null && item.anchor_after_html !== item.before_html))) {
    const tag = item.anchor_tag_after || anchorTag(item) || mdKind(doc.blocks[at]);
    doc.blocks[at] = mdBlock(tag, item.anchor_after_html != null ? item.anchor_after_html : item.before_html);
  }

  const earlier = historyRuns(item);
  let pos = at + 1;
  runBlocks(item).forEach((block, k) => {
    const want = mdBlock(block.tag, block.html);
    const here = doc.blocks[pos];
    if (here !== undefined && mdWords(here) === blockWords(block)) {
      doc.blocks[pos] = want;
    } else if (here !== undefined && earlier.some((run) => run[k] && mdWords(here) === blockWords(run[k]))) {
      doc.blocks[pos] = want;
    } else {
      doc.blocks.splice(pos, 0, want);
    }
    pos += 1;
  });
  return writeMd(doc);
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const HTML_LEAF = /<(h[1-6]|p|ul|ol)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

function htmlLeaves(text) {
  const out = [];
  let m;
  HTML_LEAF.lastIndex = 0;
  while ((m = HTML_LEAF.exec(text))) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      tag: m[1].toLowerCase(),
      attrs: m[2] || "",
      inner: m[3],
      words: htmlWords(m[3])
    });
  }
  return out;
}

function findHtmlAnchor(text, item) {
  const wanted = anchorWordsList(item);
  const leaves = htmlLeaves(text);
  for (let i = 0; i < leaves.length; i += 1) if (wanted.indexOf(leaves[i].words) !== -1) return i;
  throw new Error("scripted agent: the anchor '" + (wanted[0] || "") + "' is not in the HTML source");
}

function htmlBlock(tag, html) {
  return "<" + tag + ">" + html + "</" + tag + ">";
}

function splice(text, start, end, insert) {
  return text.slice(0, start) + insert + text.slice(end);
}

function withStamp(attrs, item) {
  const region = item.region || {};
  if (!region.stamp_carriable || !region.stamp || /data-lahe-id=/.test(attrs)) return attrs;
  return attrs + ' data-lahe-id="' + region.stamp + '"';
}

function containerStart(text, item) {
  const where = (item.region && item.region.where) || [];
  const wantMain = /main/.test(JSON.stringify(where)) || /<main[\s>]/i.test(text);
  const re = wantMain ? /<main(\s[^>]*)?>/i : /<body(\s[^>]*)?>/i;
  const m = re.exec(text);
  if (!m) throw new Error("scripted agent: no container in the HTML source");
  return m.index + m[0].length;
}

function placeHtml(text, item, options) {
  const opts = options || {};
  let src = String(text);
  const startOfContainer = item.placement === "start_of_container";

  if (opts.oldContract) {
    // The old contract: after_html is the anchor's new content. The stamp line
    // was in the old contract too.
    const leaf = htmlLeaves(src)[findHtmlAnchor(src, item)];
    const open = "<" + leaf.tag + withStamp(leaf.attrs, item) + ">";
    return splice(src, leaf.start, leaf.end, open + item.after_html + "</" + leaf.tag + ">");
  }

  let anchorIndex = startOfContainer ? -1 : findHtmlAnchor(src, item);

  if (Array.isArray(item.remove_blocks) && item.remove_blocks.length) {
    item.remove_blocks.forEach((b) => {
      const leaves = htmlLeaves(src);
      for (let i = anchorIndex + 1; i < leaves.length; i += 1) {
        if (leaves[i].words === blockWords(b)) {
          let start = leaves[i].start;
          while (start > 0 && /[ \t]/.test(src[start - 1])) start -= 1;
          if (src[start - 1] === "\n") start -= 1;
          src = splice(src, start, leaves[i].end, "");
          return;
        }
      }
    });
    if (anchorIndex !== -1 && item.after_html != null && htmlWords(item.after_html)) {
      const leaf = htmlLeaves(src)[anchorIndex];
      const tag = anchorTag(item) || leaf.tag;
      if (tag !== leaf.tag || leaf.inner !== item.after_html) {
        src = splice(src, leaf.start, leaf.end, "<" + tag + leaf.attrs + ">" + item.after_html + "</" + tag + ">");
      }
    }
    return src;
  }

  let insertAt;
  if (anchorIndex !== -1) {
    const leaf = htmlLeaves(src)[anchorIndex];
    const changed = item.anchor_tag_after || (item.anchor_after_html != null && item.anchor_after_html !== item.before_html);
    const tag = item.anchor_tag_after || leaf.tag;
    const inner = changed && item.anchor_after_html != null ? item.anchor_after_html : leaf.inner;
    const rebuilt = "<" + tag + withStamp(leaf.attrs, item) + ">" + inner + "</" + tag + ">";
    src = splice(src, leaf.start, leaf.end, rebuilt);
    insertAt = leaf.start + rebuilt.length;
  } else {
    insertAt = containerStart(src, item);
  }

  const earlier = historyRuns(item);
  runBlocks(item).forEach((block, k) => {
    const want = htmlBlock(block.tag, block.html);
    const next = htmlLeaves(src).find((l) => l.start >= insertAt);
    const between = next ? src.slice(insertAt, next.start) : "";
    const adjacent = next && /^\s*$/.test(between);
    if (adjacent && (next.words === blockWords(block) || earlier.some((run) => run[k] && next.words === blockWords(run[k])))) {
      src = splice(src, next.start, next.end, want);
      insertAt = next.start + want.length;
      return;
    }
    const piece = "\n  " + want;
    src = splice(src, insertAt, insertAt, piece);
    insertAt += piece.length;
  });
  return src;
}

/** Place by the source's kind, told by its file name. */
function place(file, text, item, options) {
  return /\.(md|markdown)$/i.test(file) ? placeMarkdown(text, item, options) : placeHtml(text, item, options);
}

module.exports = {
  itemFromDrainLine,
  place,
  placeMarkdown,
  placeHtml,
  mdEscape,
  mdBlock,
  mdWords,
  htmlWords,
  anchorTag
};
