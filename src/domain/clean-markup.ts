/*
 * read-when: Changing what cleaning markup keeps, drops or rewrites before a record stores it, or when an agent reads unexpected markup in a record.
 */

import {
  ROLE_CHROME,
  ROLE_WRAP,
  TOOL_ATTR,
  TURBO_PERMANENT_ATTR,
  isToolAttrName,
  isToolClassToken
} from "../contract/markers.ts";
import { resetTagsForStyle } from "./formatting.ts";
import {
  escapeAttrValue,
  isDroppedSubtreeTag,
  isVoidTag,
  isWhitespacePreservingTag,
  nbspToSpace,
  readTag,
  skipDeclaration
} from "./html-syntax.ts";
import type { TagAttribute } from "./html-syntax.ts";
import { cleanCharacters, collapseSpaces } from "./text.ts";

export interface CleanMarkupOptions {
  readonly keepWhitespace?: boolean;
}

type ElementAction = "keep" | "drop" | "unwrap";

interface OpenElement {
  readonly name: string;
  readonly emitNames: readonly string[];
  readonly action: ElementAction;
  readonly preservesWhitespace: boolean;
}

const URL_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "xlink:href",
  "data",
  "cite",
  "background"
]);
const SAFE_SCHEMES: ReadonlySet<string> = new Set<string>(["http", "https", "mailto", "tel"]);
const DROPPED_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "style",
  "contenteditable",
  "spellcheck",
  "autocorrect",
  "autocapitalize",
  TURBO_PERMANENT_ATTR,
  "srcdoc"
]);
const RENAMED_TAGS: ReadonlyMap<string, string> = new Map<string, string>([
  ["b", "strong"],
  ["i", "em"]
]);

const MAX_CODE_POINT = 0x10ffff;
const SCHEME_SHAPE = /^[a-zA-Z][a-zA-Z0-9+.-]*$/;
const NOT_A_SCHEME = /[/?#]/;

function codePointText(code: number): string {
  return code >= 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : "";
}

function resolveForSchemeCheck(value: string): string {
  return value
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (...match: string[]) => codePointText(parseInt(match[1] ?? "", 16)))
    .replace(/&#(\d+);?/g, (...match: string[]) => codePointText(parseInt(match[1] ?? "", 10)))
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "")
    .replace(/&newline;?/gi, "")
    .replace(/&amp;?/gi, "&")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, "");
}

function isSafeUrl(value: string): boolean {
  const resolved = resolveForSchemeCheck(value);
  const colon = resolved.indexOf(":");
  if (colon === -1) return true;
  const scheme = resolved.slice(0, colon);
  if (NOT_A_SCHEME.test(scheme) || !SCHEME_SHAPE.test(scheme)) return true;
  return SAFE_SCHEMES.has(scheme.toLowerCase());
}

function lastValue(attributes: readonly TagAttribute[], name: string): string | null {
  let found: string | null = null;
  for (const attribute of attributes) {
    if (attribute.name === name) found = attribute.value;
  }
  return found;
}

function cleanAttributes(attributes: readonly TagAttribute[]): TagAttribute[] {
  const kept: TagAttribute[] = [];
  for (const { name, value } of attributes) {
    if (isToolAttrName(name) || DROPPED_ATTRIBUTES.has(name) || name.startsWith("on")) continue;
    if (name === "class") {
      const tokens = value.split(/\s+/).filter((token) => token !== "" && !isToolClassToken(token));
      if (tokens.length > 0) kept.push({ name, value: tokens.join(" ") });
      continue;
    }
    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) continue;
    kept.push({ name, value });
  }
  return kept.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function startTag(name: string, attributes: readonly TagAttribute[]): string {
  let out = "<" + name;
  for (const attribute of attributes) out += " " + attribute.name + '="' + escapeAttrValue(attribute.value) + '"';
  return out + ">";
}

function endTags(entry: OpenElement): string {
  let out = "";
  for (let i = entry.emitNames.length - 1; i >= 0; i -= 1) out += "</" + (entry.emitNames[i] ?? "") + ">";
  return out;
}

export function cleanMarkup(html: string, options: CleanMarkupOptions = {}): string {
  const keepWhitespace = options.keepWhitespace === true;
  const out: string[] = [];
  const stack: OpenElement[] = [];
  let dropDepth = 0;
  let preDepth = 0;

  function emitText(text: string): void {
    if (dropDepth > 0 || text === "") return;
    const characters = cleanCharacters(text);
    if (keepWhitespace) {
      out.push(characters);
      return;
    }
    const spaced = nbspToSpace(characters);
    out.push(preDepth > 0 ? spaced : collapseSpaces(spaced));
  }

  function closeDownTo(depth: number): void {
    while (stack.length > depth) {
      const entry = stack.pop();
      if (entry === undefined) return;
      if (entry.action === "drop") dropDepth -= 1;
      if (entry.preservesWhitespace) preDepth -= 1;
      if (entry.action === "keep") out.push(endTags(entry));
    }
  }

  function closeElement(name: string): void {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]?.name === name) {
        closeDownTo(i);
        return;
      }
    }
  }

  function openElement(name: string, attributes: readonly TagAttribute[]): void {
    const role = lastValue(attributes, TOOL_ATTR);
    let action: ElementAction = "keep";
    if (dropDepth > 0 || isDroppedSubtreeTag(name) || role === ROLE_CHROME) action = "drop";
    else if (role === ROLE_WRAP) action = "unwrap";

    const emitName = RENAMED_TAGS.get(name) ?? name;
    const kept = cleanAttributes(attributes);
    if (isVoidTag(name)) {
      if (action === "keep") out.push(startTag(emitName, kept));
      return;
    }

    const resets = action === "keep" ? resetTagsForStyle(lastValue(attributes, "style") ?? "") : [];
    const keepsOwnTag = resets.length === 0 || kept.length > 0 || name !== "span";
    const emitNames = keepsOwnTag ? [...resets, emitName] : [...resets];
    if (action === "drop") dropDepth += 1;
    const preservesWhitespace = action === "keep" && isWhitespacePreservingTag(name);
    if (preservesWhitespace) preDepth += 1;
    if (action === "keep") {
      emitNames.forEach((emitted, index) => {
        out.push(index === emitNames.length - 1 ? startTag(emitted, kept) : "<" + emitted + ">");
      });
    }
    stack.push({ name, emitNames, action, preservesWhitespace });
  }

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emitText(html.slice(i));
      break;
    }
    if (lt > i) emitText(html.slice(i, lt));
    const skipped = skipDeclaration(html, lt);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    const tag = readTag(html, lt);
    if (tag === null) {
      emitText("<");
      i = lt + 1;
      continue;
    }
    i = tag.end;
    if (tag.kind === "end") closeElement(tag.name);
    else openElement(tag.name, tag.attributes);
  }
  closeDownTo(0);

  const joined = out.join("");
  return keepWhitespace ? joined : joined.trim();
}
