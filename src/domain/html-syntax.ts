/*
 * read-when: Changing how a tag, an attribute value or a character reference is read, or the tables of block, void and dropped elements.
 */

import { LINE_BREAK, PARAGRAPH_BREAK } from "./text.ts";
import type { TextBreak } from "./text.ts";

export interface TagAttribute {
  readonly name: string;
  readonly value: string;
}

export type TagToken =
  | {
      readonly kind: "start";
      readonly name: string;
      readonly attributes: readonly TagAttribute[];
      readonly selfClosing: boolean;
      readonly end: number;
    }
  | { readonly kind: "end"; readonly name: string; readonly end: number };

export type MarkupToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tag"; readonly tag: TagToken; readonly source: string };

export const BLOCK_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
] as const;
export type BlockTag = (typeof BLOCK_TAGS)[number];

export const DROP_SUBTREE_TAGS = [
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset"
] as const;
export type DroppedSubtreeTag = (typeof DROP_SUBTREE_TAGS)[number];

const BLOCK_TAG_SET: ReadonlySet<string> = new Set<string>(BLOCK_TAGS);
const DROP_SUBTREE_TAG_SET: ReadonlySet<string> = new Set<string>(DROP_SUBTREE_TAGS);
const VOID_TAG_SET: ReadonlySet<string> = new Set<string>([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
const WHITESPACE_PRESERVING_TAG_SET: ReadonlySet<string> = new Set<string>(["pre", "textarea"]);

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00A0"]
]);

const MAX_CODE_POINT = 0x10ffff;
const ASCII_LETTER = /[A-Za-z]/;
const NAME_CHARACTER = /[A-Za-z0-9:_-]/;
const ATTRIBUTE_NAME_END = /[\s=/>]/;
const UNQUOTED_VALUE_END = /[\s>]/;
const WHITESPACE = /\s/;
const REFERENCE = /&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g;
const NBSP_SPELLING = /&(?:nbsp|#160|#xa0);/gi;

export function isBlockTag(name: string): name is BlockTag {
  return BLOCK_TAG_SET.has(name);
}

export function isDroppedSubtreeTag(name: string): name is DroppedSubtreeTag {
  return DROP_SUBTREE_TAG_SET.has(name);
}

export function isVoidTag(name: string): boolean {
  return VOID_TAG_SET.has(name);
}

export function isWhitespacePreservingTag(name: string): boolean {
  return WHITESPACE_PRESERVING_TAG_SET.has(name);
}

export function breakOfTag(name: string): TextBreak | "" {
  if (name === "br") return LINE_BREAK;
  return isBlockTag(name) ? PARAGRAPH_BREAK : "";
}

export function decodeEntities(text: string): string {
  return text.replace(REFERENCE, (whole: string, body: string) => {
    if (body.startsWith("#")) {
      const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES.get(body.toLowerCase()) ?? whole;
  });
}

export function nbspToSpace(text: string): string {
  return text.replace(NBSP_SPELLING, " ");
}

export function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function skipWhitespace(html: string, from: number): number {
  let at = from;
  while (at < html.length && WHITESPACE.test(html.charAt(at))) at += 1;
  return at;
}

export function readTag(html: string, at: number): TagToken | null {
  const closing = html.charAt(at + 1) === "/";
  const nameStart = at + (closing ? 2 : 1);
  if (!ASCII_LETTER.test(html.charAt(nameStart))) return null;
  let i = nameStart;
  while (i < html.length && NAME_CHARACTER.test(html.charAt(i))) i += 1;
  const name = html.slice(nameStart, i).toLowerCase();

  if (closing) {
    const bracket = html.indexOf(">", i);
    return { kind: "end", name, end: bracket === -1 ? html.length : bracket + 1 };
  }

  const attributes: TagAttribute[] = [];
  let selfClosing = false;
  while (i < html.length) {
    i = skipWhitespace(html, i);
    const next = html.charAt(i);
    if (next === ">") {
      i += 1;
      break;
    }
    if (next === "/" && html.charAt(i + 1) === ">") {
      selfClosing = true;
      i += 2;
      break;
    }
    if (i >= html.length) break;
    const nameFrom = i;
    while (i < html.length && !ATTRIBUTE_NAME_END.test(html.charAt(i))) i += 1;
    if (i === nameFrom) {
      i += 1;
      continue;
    }
    const attributeName = html.slice(nameFrom, i).toLowerCase();
    const afterName = i;
    let value = "";
    i = skipWhitespace(html, i);
    if (html.charAt(i) === "=") {
      i = skipWhitespace(html, i + 1);
      const quote = html.charAt(i);
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? html.length : close;
        value = html.slice(i + 1, stop);
        i = close === -1 ? html.length : close + 1;
      } else {
        const valueFrom = i;
        while (i < html.length && !UNQUOTED_VALUE_END.test(html.charAt(i))) i += 1;
        value = html.slice(valueFrom, i);
      }
    } else {
      i = afterName;
    }
    attributes.push({ name: attributeName, value: decodeEntities(value) });
  }
  return { kind: "start", name, attributes, selfClosing, end: Math.min(i, html.length) };
}

export function tokenizeMarkup(html: string): readonly MarkupToken[] {
  const tokens: MarkupToken[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ kind: "text", text: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: "text", text: html.slice(i, lt) });
    const tag = readTag(html, lt);
    if (tag === null) {
      tokens.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }
    tokens.push({ kind: "tag", tag, source: html.slice(lt, tag.end) });
    i = tag.end;
  }
  return tokens;
}

export function skipDeclaration(html: string, at: number): number | null {
  if (html.startsWith("<!--", at)) {
    const close = html.indexOf("-->", at + 4);
    return close === -1 ? html.length : close + 3;
  }
  const next = html.charAt(at + 1);
  if (next !== "!" && next !== "?") return null;
  const bracket = html.indexOf(">", at);
  return bracket === -1 ? html.length : bracket + 1;
}
