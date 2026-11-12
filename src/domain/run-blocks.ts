/*
 * read-when: Changing the allowlist a free-written block passes, or how a run's words are counted and compared.
 */

import type { FailureCode } from "../contract/failures.ts";
import { textOf } from "./block-text.ts";
import { NOT_BOLD_TAG, NOT_ITALIC_TAG } from "./formatting.ts";
import type { ResetTag } from "./formatting.ts";
import { decodeEntities, readTag, skipDeclaration } from "./html-syntax.ts";
import { cleanCharacters, collapseSpaces, foldTypography, normalizeText } from "./text.ts";

export const WRITABLE_BLOCK_TAGS = ["p", "h2", "h3", "h4", "ul", "ol"] as const;
export type WritableBlockTag = (typeof WRITABLE_BLOCK_TAGS)[number];

export type InlineTag = "strong" | "em" | ResetTag;

export const MAX_BLOCK_NESTING = 32;

export interface CleanedBlock {
  readonly html: string;
}

export interface BlockRefusal {
  readonly code: Extract<FailureCode, "RUN_BLOCK_REFUSED">;
  readonly reason: string;
}

declare const blockWordsBrand: unique symbol;
export type BlockWords = string & { readonly [blockWordsBrand]: true };

export interface RunWordsBlock {
  readonly html: string;
  readonly from_anchor?: boolean;
}

interface TextNode {
  readonly kind: "text";
  text: string;
}

interface BreakNode {
  readonly kind: "break";
}

interface ElementNode {
  readonly kind: "element";
  readonly name: InlineTag | "li";
  readonly children: BlockNode[];
}

interface RootNode {
  readonly kind: "root";
  readonly name: WritableBlockTag;
  readonly children: BlockNode[];
}

type BlockNode = TextNode | BreakNode | ElementNode;

const RUN_BLOCK_REFUSED: Extract<FailureCode, "RUN_BLOCK_REFUSED"> = "RUN_BLOCK_REFUSED";

const WRITABLE_BLOCK_TAG_SET: ReadonlySet<string> = new Set<string>(WRITABLE_BLOCK_TAGS);
const INLINE_TAGS: ReadonlyMap<string, InlineTag> = new Map<string, InlineTag>([
  ["strong", "strong"],
  ["b", "strong"],
  ["em", "em"],
  ["i", "em"],
  [NOT_BOLD_TAG, NOT_BOLD_TAG],
  [NOT_ITALIC_TAG, NOT_ITALIC_TAG]
]);

export function isWritableBlockTag(name: string): name is WritableBlockTag {
  return WRITABLE_BLOCK_TAG_SET.has(name);
}

export function inlineTagFor(name: string): InlineTag | null {
  return INLINE_TAGS.get(name) ?? null;
}

function refuse(reason: string): BlockRefusal {
  return { code: RUN_BLOCK_REFUSED, reason };
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanText(raw: string): string {
  return collapseSpaces(cleanCharacters(decodeEntities(raw)));
}

function hasWords(node: BlockNode): boolean {
  if (node.kind === "text") return node.text.trim() !== "";
  if (node.kind === "break") return false;
  return node.children.some(hasWords);
}

function pruneEmpty(nodes: readonly BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  let pending: string[] = [];

  function flush(): void {
    if (pending.length === 0) return;
    out.push({ kind: "text", text: pending.join("").replace(/ +/g, " ") });
    pending = [];
  }

  for (const node of nodes) {
    if (node.kind === "element") {
      if (!hasWords(node)) continue;
      flush();
      out.push({ kind: "element", name: node.name, children: pruneEmpty(node.children) });
    } else if (node.kind === "text") {
      if (node.text !== "") pending.push(node.text);
    } else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

function trimStart(nodes: BlockNode[]): void {
  let removable = 0;
  for (const node of nodes) {
    if (node.kind === "break") {
      removable += 1;
      continue;
    }
    if (node.kind === "text") {
      node.text = node.text.replace(/^ +/, "");
      if (node.text === "") {
        removable += 1;
        continue;
      }
      break;
    }
    trimStart(node.children);
    if (node.children.length === 0) {
      removable += 1;
      continue;
    }
    break;
  }
  nodes.splice(0, removable);
}

function trimEnd(nodes: BlockNode[]): void {
  while (nodes.length > 0) {
    const last = nodes[nodes.length - 1];
    if (last === undefined) return;
    if (last.kind === "break") {
      nodes.pop();
      continue;
    }
    if (last.kind === "text") {
      last.text = last.text.replace(/ +$/, "");
      if (last.text === "") {
        nodes.pop();
        continue;
      }
      return;
    }
    trimEnd(last.children);
    if (last.children.length === 0) {
      nodes.pop();
      continue;
    }
    return;
  }
}

function serialize(nodes: readonly BlockNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += escapeText(node.text);
    else if (node.kind === "break") out += "<br>";
    else out += "<" + node.name + ">" + serialize(node.children) + "</" + node.name + ">";
  }
  return out;
}

function finishInline(children: readonly BlockNode[]): string {
  const nodes = pruneEmpty(children);
  trimStart(nodes);
  trimEnd(nodes);
  return serialize(pruneEmpty(nodes));
}

export function cleanBlock(tag: unknown, html: unknown): CleanedBlock | BlockRefusal {
  const blockTag = typeof tag === "string" ? tag.toLowerCase() : "";
  if (!isWritableBlockTag(blockTag)) return refuse("tag " + String(tag) + " is not writable");
  if (typeof html !== "string") return refuse("html must be a string");
  const isList = blockTag === "ul" || blockTag === "ol";

  const root: RootNode = { kind: "root", name: blockTag, children: [] };
  const stack: (RootNode | ElementNode)[] = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const textEnd = lt === -1 ? html.length : lt;
    const top = stack[stack.length - 1] ?? root;
    if (textEnd > i) {
      const chunk = cleanText(html.slice(i, textEnd));
      if (isList && top === root) {
        if (chunk.trim() !== "") return refuse("words outside an item in a list block");
      } else if (chunk !== "") {
        top.children.push({ kind: "text", text: chunk });
      }
    }
    if (lt === -1) break;
    if (skipDeclaration(html, lt) !== null) return refuse("a comment or declaration in a block");
    const parsed = readTag(html, lt);
    if (parsed === null) {
      if (isList && top === root) return refuse("words outside an item in a list block");
      top.children.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }
    i = parsed.end;

    if (parsed.kind === "end") {
      const written = inlineTagFor(parsed.name) ?? parsed.name;
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s]?.name === written) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    if (parsed.name === "br") {
      if (isList && top === root) return refuse("a break outside an item in a list block");
      top.children.push({ kind: "break" });
      continue;
    }

    if (parsed.name === "li") {
      if (!isList) return refuse("li inside a " + blockTag + " block");
      if (top !== root) return refuse("a nested item");
      const item: ElementNode = { kind: "element", name: "li", children: [] };
      root.children.push(item);
      stack.push(item);
      if (parsed.selfClosing) stack.pop();
      continue;
    }

    const inline = inlineTagFor(parsed.name);
    if (inline === null) return refuse("element " + parsed.name + " is not allowed in a block");
    if (isList && top === root) return refuse("formatting outside an item in a list block");
    const element: ElementNode = { kind: "element", name: inline, children: [] };
    top.children.push(element);
    if (parsed.selfClosing) continue;
    if (stack.length > MAX_BLOCK_NESTING) return refuse("nesting deeper than " + String(MAX_BLOCK_NESTING));
    stack.push(element);
  }

  if (!isList) {
    const out = finishInline(root.children);
    return out === "" ? refuse("a block with no words") : { html: out };
  }
  let items = "";
  for (const item of root.children) {
    if (item.kind !== "element") continue;
    const inner = finishInline(item.children);
    if (inner !== "") items += "<li>" + inner + "</li>";
  }
  return items === "" ? refuse("a list block with no words") : { html: items };
}

function asBlockWords(value: unknown): asserts value is BlockWords {
  if (typeof value !== "string") throw new TypeError("block words are a string");
}

export function blockWords(html: string | null | undefined): BlockWords {
  const words = html === null || html === undefined ? "" : foldTypography(decodeEntities(textOf(html)));
  asBlockWords(words);
  return words;
}

export function runWords(blocks: readonly RunWordsBlock[] | undefined): number {
  let total = 0;
  for (const block of blocks ?? []) {
    if (block.from_anchor === true) continue;
    const words = normalizeText(decodeEntities(textOf(block.html)));
    if (words !== "") total += words.split(" ").length;
  }
  return total;
}
