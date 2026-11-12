/*
 * read-when: Changing how text with its breaks is read from markup, from plain text or from a live node, or how markup is cut into paragraphs.
 */

import { isToolNode } from "../contract/markers.ts";
import { cleanMarkup } from "./clean-markup.ts";
import {
  breakOfTag,
  isBlockTag,
  isDroppedSubtreeTag,
  isVoidTag,
  isWhitespacePreservingTag,
  nbspToSpace,
  tokenizeMarkup
} from "./html-syntax.ts";
import type { TagToken } from "./html-syntax.ts";
import { LINE_BREAK, PARAGRAPH_BREAK, collapseSpaces, normalizeBlockText, normalizeText } from "./text.ts";

export interface TextSourceNode {
  readonly nodeType: number;
  readonly firstChild?: TextSourceNode | null;
  readonly nextSibling?: TextSourceNode | null;
  readonly tagName?: string;
  readonly data?: string;
  readonly nodeValue?: string | null;
  readonly getAttribute?: (name: string) => string | null;
}

export interface BlockTextOptions {
  readonly skip?: (node: TextSourceNode) => boolean;
}

const NODE_TYPE = { ELEMENT: 1, TEXT: 3, CDATA: 4, DOCUMENT: 9, FRAGMENT: 11 } as const;

const PRE_SPACE = "\uE000";
const PRE_NEWLINE = "\uE001";
const PRE_TAB = "\uE002";

function protectPreformatted(text: string): string {
  return text.replace(/ /g, PRE_SPACE).replace(/\n/g, PRE_NEWLINE).replace(/\t/g, PRE_TAB);
}

function restorePreformatted(text: string): string {
  return text.replaceAll(PRE_SPACE, " ").replaceAll(PRE_NEWLINE, "\n").replaceAll(PRE_TAB, "\t");
}

function finishText(parts: readonly string[]): string {
  return restorePreformatted(normalizeBlockText(parts.join("")));
}

function nextPreformattedDepth(depth: number, tag: TagToken): number {
  if (!isWhitespacePreservingTag(tag.name)) return depth;
  if (tag.kind === "end") return Math.max(0, depth - 1);
  return tag.selfClosing ? depth : depth + 1;
}

function nextDroppedDepth(depth: number, tag: TagToken): number {
  if (tag.kind === "end") return Math.max(0, depth - 1);
  return tag.selfClosing ? depth : depth + 1;
}

export function blockText(html: string): string {
  const parts: string[] = [];
  let preDepth = 0;
  for (const token of tokenizeMarkup(cleanMarkup(html))) {
    if (token.kind === "text") {
      parts.push(preDepth > 0 ? protectPreformatted(token.text) : token.text);
      continue;
    }
    preDepth = nextPreformattedDepth(preDepth, token.tag);
    parts.push(breakOfTag(token.tag.name));
  }
  return finishText(parts);
}

export function textOf(value: string): string {
  const parts: string[] = [];
  let dropDepth = 0;
  let preDepth = 0;
  for (const token of tokenizeMarkup(value)) {
    if (token.kind === "text") {
      if (dropDepth > 0) continue;
      const text = nbspToSpace(token.text);
      parts.push(preDepth > 0 ? protectPreformatted(text) : text);
      continue;
    }
    if (isDroppedSubtreeTag(token.tag.name) && (token.tag.kind === "end" || !token.tag.selfClosing)) {
      dropDepth = nextDroppedDepth(dropDepth, token.tag);
      continue;
    }
    preDepth = nextPreformattedDepth(preDepth, token.tag);
    if (dropDepth === 0) parts.push(breakOfTag(token.tag.name));
  }
  return finishText(parts);
}

function collectNodeText(
  node: TextSourceNode,
  parts: string[],
  skip: (node: TextSourceNode) => boolean,
  preDepth: number
): void {
  const type = node.nodeType;
  if (type === NODE_TYPE.TEXT || type === NODE_TYPE.CDATA) {
    const data = node.data ?? node.nodeValue ?? "";
    parts.push(preDepth > 0 ? protectPreformatted(data) : collapseSpaces(data));
    return;
  }
  const isElement = type === NODE_TYPE.ELEMENT;
  if (!isElement && type !== NODE_TYPE.DOCUMENT && type !== NODE_TYPE.FRAGMENT) return;

  let childDepth = preDepth;
  let isBlock = false;
  if (isElement) {
    if (skip(node)) return;
    const tag = node.tagName?.toLowerCase() ?? "";
    if (isDroppedSubtreeTag(tag)) return;
    if (tag === "br") {
      parts.push(LINE_BREAK);
      return;
    }
    isBlock = isBlockTag(tag);
    if (isBlock) parts.push(PARAGRAPH_BREAK);
    if (isWhitespacePreservingTag(tag)) childDepth += 1;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectNodeText(child, parts, skip, childDepth);
  }
  if (isBlock) parts.push(PARAGRAPH_BREAK);
}

export function blockTextFromNode(node: TextSourceNode, options: BlockTextOptions = {}): string {
  const parts: string[] = [];
  collectNodeText(node, parts, options.skip ?? isToolNode, 0);
  return finishText(parts);
}

export function topLevelBlocks(html: string): readonly string[] | null {
  const candidates: string[] = [];
  let loose = "";
  let inner = "";
  let inBlock = false;
  let depth = 0;

  for (const token of tokenizeMarkup(cleanMarkup(html))) {
    if (token.kind === "text") {
      if (inBlock) inner += token.text;
      else loose += token.text;
      continue;
    }
    const tag = token.tag;
    const isVoid = isVoidTag(tag.name) || (tag.kind === "start" && tag.selfClosing);
    if (depth === 0 && tag.kind === "start") {
      if (tag.name === "br" || tag.name === "hr") {
        candidates.push(loose);
        loose = "";
        continue;
      }
      if (!isVoid && isBlockTag(tag.name)) {
        candidates.push(loose);
        loose = "";
        inner = "";
        inBlock = true;
        depth = 1;
        continue;
      }
    }
    if (tag.kind === "end") {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0 && inBlock) {
        candidates.push(inner);
        inBlock = false;
        continue;
      }
    } else if (!isVoid) {
      depth += 1;
    }
    if (inBlock) inner += token.source;
    else loose += token.source;
  }
  if (depth !== 0 || inBlock) return null;
  candidates.push(loose);

  const pieces: string[] = [];
  for (const candidate of candidates) {
    const markup = candidate.trim();
    if (markup === "") continue;
    if (normalizeText(textOf(markup)) === "") return null;
    pieces.push(markup);
  }
  return pieces;
}
