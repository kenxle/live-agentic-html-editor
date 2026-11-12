/*
 * read-when: Changing how the page's leaf blocks are read from a string, how a run's blocks are matched against them, or how a clash is found.
 */

import {
  FILE_TITLE_ATTR,
  FILE_TITLE_VALUE,
  OVERLAY_ROOT_ID,
  ROLE_CHROME,
  TOOL_ATTR
} from "../contract/markers.ts";
import { cleanMarkup } from "./clean-markup.ts";
import {
  escapeAttrValue,
  isBlockTag,
  isDroppedSubtreeTag,
  isVoidTag,
  readTag,
  skipDeclaration
} from "./html-syntax.ts";
import type { BlockTag, TagAttribute } from "./html-syntax.ts";
import { blockWords } from "./run-blocks.ts";
import type { BlockWords } from "./run-blocks.ts";

export const SHORT_BLOCK_WORDS = 5;
export const RUN_WALK_SLACK = 2;

export interface LeafBlock {
  readonly tag: BlockTag;
  readonly html: string;
  readonly words: BlockWords;
}

export type MatchEntry = { readonly words: BlockWords } | { readonly html: string };

export const MATCH_STATUS: {
  readonly WHOLE: "whole";
  readonly JOINED: "joined";
  readonly SPLIT: "split";
  readonly MISSING: "missing";
} = { WHOLE: "whole", JOINED: "joined", SPLIT: "split", MISSING: "missing" };
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

export type BlockMatch =
  | { readonly index: number; readonly status: "missing"; readonly leaves: readonly [] }
  | {
      readonly index: number;
      readonly status: "whole" | "joined" | "split";
      readonly leaves: readonly [number, ...number[]];
    };

export interface RunClash {
  readonly index: number;
  readonly blocks: number;
  readonly leaf: number;
}

interface TextNode {
  readonly kind: "text";
  readonly text: string;
}

interface ElementNode {
  readonly kind: "element";
  readonly name: string;
  readonly attributes: readonly TagAttribute[];
  readonly children: TreeNode[];
  readonly parent: ElementNode | null;
}

type TreeNode = TextNode | ElementNode;

interface Hit {
  readonly status: "whole" | "joined" | "split";
  readonly blocks: number;
  readonly leaves: number;
}

const ROOT_NAME = "#root";

const RAW_TEXT_TAGS: ReadonlySet<string> = new Set<string>(["script", "style", "textarea", "title", "xmp", "noscript"]);
const CLOSES_PARAGRAPH: ReadonlySet<string> = new Set<string>([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
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
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
  "li",
  "dd",
  "dt",
  "summary"
]);

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function findRawTextEnd(html: string, name: string, from: number): number {
  const closing = new RegExp("</" + name, "gi");
  closing.lastIndex = from;
  return closing.exec(html)?.index ?? -1;
}

function parseTree(html: string): ElementNode {
  const root: ElementNode = { kind: "element", name: ROOT_NAME, attributes: [], children: [], parent: null };
  let current = root;

  function nearestOpen(name: string, stopAtList: boolean): ElementNode | null {
    for (let node: ElementNode | null = current; node !== null && node !== root; node = node.parent) {
      if (stopAtList && (node.name === "ul" || node.name === "ol")) return null;
      if (node.name === name) return node;
    }
    return null;
  }

  function closeTo(node: ElementNode): void {
    current = node.parent ?? root;
  }

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const end = lt === -1 ? html.length : lt;
    if (end > i) current.children.push({ kind: "text", text: html.slice(i, end) });
    if (lt === -1) break;
    const skipped = skipDeclaration(html, lt);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    const tag = readTag(html, lt);
    if (tag === null) {
      current.children.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }
    i = tag.end;

    if (tag.kind === "end") {
      const open = nearestOpen(tag.name, false);
      if (open !== null) closeTo(open);
      continue;
    }

    const name = tag.name;
    if (CLOSES_PARAGRAPH.has(name)) {
      const paragraph = nearestOpen("p", false);
      if (paragraph !== null) closeTo(paragraph);
    }
    if (name === "li") {
      const item = nearestOpen("li", true);
      if (item !== null) closeTo(item);
    }
    const element: ElementNode = { kind: "element", name, attributes: tag.attributes, children: [], parent: current };
    current.children.push(element);
    if (isVoidTag(name) || tag.selfClosing) continue;
    if (RAW_TEXT_TAGS.has(name)) {
      const closeAt = findRawTextEnd(html, name, i);
      element.children.push({ kind: "text", text: html.slice(i, closeAt === -1 ? html.length : closeAt) });
      const bracket = closeAt === -1 ? -1 : html.indexOf(">", closeAt);
      i = bracket === -1 ? html.length : bracket + 1;
      continue;
    }
    current = element;
  }
  return root;
}

function attributeOf(element: ElementNode, name: string): string | null {
  return element.attributes.find((attribute) => attribute.name === name)?.value ?? null;
}

function isNotContent(element: ElementNode): boolean {
  if (isDroppedSubtreeTag(element.name) || element.name === "head") return true;
  if (attributeOf(element, TOOL_ATTR) === ROLE_CHROME) return true;
  return attributeOf(element, "id") === OVERLAY_ROOT_ID;
}

function isSkippedElement(element: ElementNode): boolean {
  return isNotContent(element) || attributeOf(element, FILE_TITLE_ATTR) === FILE_TITLE_VALUE;
}

function serializeTree(nodes: readonly TreeNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.text;
      continue;
    }
    out += "<" + node.name;
    for (const attribute of node.attributes) out += " " + attribute.name + '="' + escapeAttrValue(attribute.value) + '"';
    out += ">";
    if (!isVoidTag(node.name)) out += serializeTree(node.children) + "</" + node.name + ">";
  }
  return out;
}

function hasBlockInside(element: ElementNode): boolean {
  for (const child of element.children) {
    if (child.kind === "text" || isNotContent(child)) continue;
    if (isBlockTag(child.name) || hasBlockInside(child)) return true;
  }
  return false;
}

export function leafBlocks(html: string): readonly LeafBlock[] {
  const leaves: LeafBlock[] = [];

  function walk(nodes: readonly TreeNode[]): void {
    for (const node of nodes) {
      if (node.kind === "text" || isSkippedElement(node)) continue;
      const name = node.name;
      if (isBlockTag(name) && (name === "ul" || name === "ol" || !hasBlockInside(node))) {
        const inner = cleanMarkup(serializeTree(node.children));
        const words = blockWords(inner);
        if (words !== "") leaves.push({ tag: name, html: inner, words });
        continue;
      }
      walk(node.children);
    }
  }

  walk(parseTree(html).children);
  return leaves;
}

function wordsFor(entry: MatchEntry): BlockWords {
  return "words" in entry ? entry.words : blockWords(entry.html);
}

function joinWords(parts: readonly string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function wordAt(list: readonly string[], index: number): string {
  return list[index] ?? "";
}

function wordTotal(words: string): number {
  return words === "" ? 0 : words.split(" ").length;
}

function isWholeWordsInside(leafWords: string, words: string): boolean {
  if (words === "" || leafWords === "" || leafWords === words || leafWords.length <= words.length) return false;
  let from = 0;
  for (;;) {
    const at = leafWords.indexOf(words, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : leafWords.charAt(at - 1);
    const after = leafWords.charAt(at + words.length);
    if ((before === "" || !WORD_CHARACTER.test(before)) && (after === "" || !WORD_CHARACTER.test(after))) return true;
    from = at + 1;
  }
}

export function matchRun(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): readonly BlockMatch[] {
  const blockList: readonly string[] = blocks.map(wordsFor);
  const leafList: readonly string[] = leaves.map(wordsFor);
  const limit = Math.min(leafList.length, blockList.length + RUN_WALK_SLACK);
  const result: BlockMatch[] = [];
  for (let index = 0; index < blockList.length; index += 1) {
    result.push({ index, status: MATCH_STATUS.MISSING, leaves: [] });
  }

  function tryAt(blockIndex: number, leafIndex: number): Hit | null {
    const target = wordAt(blockList, blockIndex);
    if (target === "") return null;
    const leaf = wordAt(leafList, leafIndex);
    if (leaf === target) return { status: MATCH_STATUS.WHOLE, blocks: 1, leaves: 1 };

    let joined = target;
    for (let k = blockIndex + 1; k < blockList.length; k += 1) {
      joined = joinWords([joined, wordAt(blockList, k)]);
      if (joined === leaf) return { status: MATCH_STATUS.JOINED, blocks: k - blockIndex + 1, leaves: 1 };
      if (joined.length > leaf.length) break;
    }

    let spread = leaf;
    for (let m = leafIndex + 1; m < limit; m += 1) {
      spread = joinWords([spread, wordAt(leafList, m)]);
      if (spread === target) return { status: MATCH_STATUS.SPLIT, blocks: 1, leaves: m - leafIndex + 1 };
      if (spread.length > target.length) break;
    }
    return null;
  }

  let blockIndex = 0;
  let leafIndex = 0;
  let matched = 0;
  while (leafIndex < limit && blockIndex < blockList.length) {
    let hit: Hit | null = null;
    let hitAt = -1;
    for (let b = blockIndex; b < blockList.length; b += 1) {
      const found = tryAt(b, leafIndex);
      if (found !== null) {
        hit = found;
        hitAt = b;
        break;
      }
    }
    if (hit === null) {
      if (matched > 0) break;
      leafIndex += 1;
      continue;
    }
    const covered: [number, ...number[]] = [leafIndex];
    for (let x = 1; x < hit.leaves; x += 1) covered.push(leafIndex + x);
    for (let y = 0; y < hit.blocks; y += 1) {
      result[hitAt + y] = { index: hitAt + y, status: hit.status, leaves: [...covered] };
    }
    matched += 1;
    blockIndex = hitAt + hit.blocks;
    leafIndex += hit.leaves;
  }
  return result;
}

export function runClash(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): RunClash | null {
  const matches = matchRun(blocks, leaves);
  const blockList: readonly string[] = blocks.map(wordsFor);
  const leafList: readonly string[] = leaves.map(wordsFor);
  const limit = Math.min(leafList.length, blockList.length + RUN_WALK_SLACK);
  const used = new Set<number>();
  for (const match of matches) {
    for (const leaf of match.leaves) used.add(leaf);
  }

  let nextLeaf = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (match === undefined) continue;
    if (match.status !== MATCH_STATUS.MISSING) {
      nextLeaf = match.leaves[0] + match.leaves.length;
      continue;
    }
    if (i > 0 && matches[i - 1]?.status === MATCH_STATUS.MISSING) continue;
    if (nextLeaf >= limit || used.has(nextLeaf)) continue;
    const leafWords = wordAt(leafList, nextLeaf);
    const words = wordAt(blockList, i);
    if (nextLeaf === 0 && wordTotal(words) < SHORT_BLOCK_WORDS) continue;
    if (!isWholeWordsInside(leafWords, words)) continue;
    let count = 1;
    let together = words;
    for (let k = i + 1; k < matches.length && matches[k]?.status === MATCH_STATUS.MISSING; k += 1) {
      together = joinWords([together, wordAt(blockList, k)]);
      if (!isWholeWordsInside(leafWords, together)) break;
      count += 1;
    }
    return { index: i, blocks: count, leaf: nextLeaf };
  }
  return null;
}
