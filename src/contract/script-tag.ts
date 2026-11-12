/*
 * read-when: Changing the script tag lahe add writes, an attribute the layer reads off it, or the checks on its address lists.
 */

import { DEFAULT_HELPER_ORIGIN } from "./helper-address.ts";
import { isSafeId } from "./safe-id.ts";
import type { SafeId } from "./safe-id.ts";

export const SCRIPT_ATTR = {
  REVIEW: "data-lahe-review",
  TOKEN: "data-lahe-token",
  HELPER: "data-lahe-helper",
  FALLBACK: "data-lahe-fallback",
  FRAMES: "data-lahe-frames",
  START: "data-lahe-start",
  NOTES: "data-lahe-notes",
  DOCUMENT: "data-lahe-document",
  ALIASES: "data-lahe-aliases",
  PATH_ALIASES: "data-lahe-path-aliases",
  SPELLINGS: "data-lahe-spellings"
} as const;

export const ALIAS_MAX = 16;
export const FRAMES_ALLOW = "allow";
export const START_HIDDEN = "hidden";
export const NOTES_ON = "true";
export const DOCUMENT_ON = "true";

export const SCRIPT_SELECTOR: string = "script[" + SCRIPT_ATTR.REVIEW + "]";

export const SCRIPT_FALLBACK_ONERROR: string =
  "var s=document.createElement('script');s.src=this.getAttribute('" + SCRIPT_ATTR.FALLBACK + "');document.head.appendChild(s)";

export type LoopbackPortOrigin = `http://127.0.0.1:${number}` | `http://localhost:${number}`;
export type PathAlias = `/${string}`;
export type Spelling = `http://${string} /${string}`;

const LOOPBACK_PORT_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;
const PATH_ALIAS = /^\/[^"'<>\s\\]{0,511}$/;
const SPELLING_ORIGIN = /^http:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/;

export function isLoopbackPortOrigin(value: unknown): value is LoopbackPortOrigin {
  return typeof value === "string" && LOOPBACK_PORT_ORIGIN.test(value);
}

export function isPathAlias(value: unknown): value is PathAlias {
  return typeof value === "string" && PATH_ALIAS.test(value);
}

export function isSpellingOrigin(value: unknown): boolean {
  return typeof value === "string" && SPELLING_ORIGIN.test(value);
}

export function isSpelling(value: unknown): value is Spelling {
  if (typeof value !== "string") return false;
  const space = value.indexOf(" ");
  return space > 0 && isSpellingOrigin(value.slice(0, space)) && isPathAlias(value.slice(space + 1));
}

export interface ScriptTagOptions {
  readonly src: string;
  readonly review: SafeId;
  readonly token: string;
  readonly helper?: string;
  readonly fallback?: string;
  readonly notes?: boolean;
  readonly document?: boolean;
  readonly aliases?: readonly LoopbackPortOrigin[];
  readonly pathAliases?: readonly PathAlias[];
  readonly spellings?: readonly Spelling[];
}

interface ListRule {
  readonly option: string;
  readonly plural: string;
  readonly accepts: (member: unknown) => boolean;
  readonly refusal: string;
}

const ALIASES_RULE: ListRule = {
  option: "aliases",
  plural: "aliases",
  accepts: isLoopbackPortOrigin,
  refusal: "an alias must be a loopback http origin, not "
};
const PATH_ALIASES_RULE: ListRule = {
  option: "pathAliases",
  plural: "path aliases",
  accepts: isPathAlias,
  refusal: "a path alias must be an absolute path, not "
};
const SPELLINGS_RULE: ListRule = {
  option: "spellings",
  plural: "spellings",
  accepts: isSpelling,
  refusal: 'a spelling is "origin path", not '
};

function listValue(list: unknown, rule: ListRule): string {
  if (!Array.isArray(list)) throw new Error("scriptTag: " + rule.option + " must be a list");
  if (list.length > ALIAS_MAX) throw new Error("scriptTag: at most " + String(ALIAS_MAX) + " " + rule.plural);
  for (const entry of list) {
    const member: unknown = entry;
    if (!rule.accepts(member)) throw new Error("scriptTag: " + rule.refusal + JSON.stringify(member));
  }
  return JSON.stringify(list).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attributeLine(name: string, value: string): string {
  return "        " + name + '="' + value + '"\n';
}

export function scriptTag(options: ScriptTagOptions): string {
  const src: unknown = options.src;
  if (typeof src !== "string" || src === "") throw new Error("scriptTag: src is required (the path to the built library)");
  const review: unknown = options.review;
  if (!isSafeId(review)) throw new Error("scriptTag: review must be a safe id");
  const token: unknown = options.token;
  if (typeof token !== "string" || token === "") throw new Error("scriptTag: token is required; absent configuration fails closed");

  const fallback = options.fallback === undefined || options.fallback === "" ? "" : attributeLine(SCRIPT_ATTR.FALLBACK, options.fallback) + attributeLine("onerror", SCRIPT_FALLBACK_ONERROR);
  const optIns =
    (options.notes === true ? attributeLine(SCRIPT_ATTR.NOTES, NOTES_ON) : "") +
    (options.document === true ? attributeLine(SCRIPT_ATTR.DOCUMENT, DOCUMENT_ON) : "");
  const lists =
    (options.aliases === undefined ? "" : attributeLine(SCRIPT_ATTR.ALIASES, listValue(options.aliases, ALIASES_RULE))) +
    (options.pathAliases === undefined ? "" : attributeLine(SCRIPT_ATTR.PATH_ALIASES, listValue(options.pathAliases, PATH_ALIASES_RULE))) +
    (options.spellings === undefined ? "" : attributeLine(SCRIPT_ATTR.SPELLINGS, listValue(options.spellings, SPELLINGS_RULE)));

  return (
    '<script src="' + src + '"\n' +
    attributeLine(SCRIPT_ATTR.REVIEW, review) +
    attributeLine(SCRIPT_ATTR.TOKEN, token) +
    attributeLine(SCRIPT_ATTR.HELPER, options.helper === undefined || options.helper === "" ? DEFAULT_HELPER_ORIGIN : options.helper) +
    fallback +
    optIns +
    lists +
    "        defer></script>"
  );
}
