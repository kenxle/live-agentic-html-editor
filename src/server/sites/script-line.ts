/*
 * read-when: Changing how the lahe script line is found, placed, replaced or removed in an HTML file.
 */

export type ScriptLinePlace =
  | "just before </body>"
  | "just before </html>"
  | "at the end of the file"
  | "in the place it already had";

export interface PlacedScriptLine {
  readonly html: string;
  readonly where: ScriptLinePlace;
}

export interface RemovedScriptLine {
  readonly html: string;
  readonly review: string;
}

export const EXISTING_TAG: RegExp = /<script\b[^>]*data-lahe-review="([^"]*)"[^>]*>\s*<\/script>/i;

const OPAQUE_BLOCK =
  /<!--[\s\S]*?(?:-->|$)|<script(?=[\s>/])[\s\S]*?(?:<\/script\s*>|$)|<style(?=[\s>/])[\s\S]*?(?:<\/style\s*>|$)/gi;

const CLOSERS: readonly { readonly pattern: RegExp; readonly where: ScriptLinePlace }[] = [
  { pattern: /<\/body\s*>/gi, where: "just before </body>" },
  { pattern: /<\/html\s*>/gi, where: "just before </html>" }
];

interface Span {
  readonly start: number;
  readonly end: number;
}

function opaqueSpans(html: string): readonly Span[] {
  return Array.from(html.matchAll(OPAQUE_BLOCK), (block) => ({ start: block.index, end: block.index + block[0].length }));
}

function lastCountedCloser(html: string, pattern: RegExp, spans: readonly Span[]): number | null {
  let last: number | null = null;
  for (const closer of html.matchAll(pattern)) {
    if (!spans.some((span) => closer.index > span.start && closer.index < span.end)) last = closer.index;
  }
  return last;
}

function lineStartOf(html: string, index: number): number {
  return html.lastIndexOf("\n", index - 1) + 1;
}

function indentAt(html: string, index: number): string {
  return /^[ \t]*/.exec(html.slice(lineStartOf(html, index), index))?.[0] ?? "";
}

function indentBlock(text: string, indent: string): string {
  return text.split("\n").join("\n" + indent);
}

function reviewOf(found: RegExpExecArray): string {
  return found[1] ?? "";
}

export function placeScriptLine(html: string, tag: string): PlacedScriptLine {
  const spans = opaqueSpans(html);
  for (const { pattern, where } of CLOSERS) {
    const at = lastCountedCloser(html, pattern, spans);
    if (at === null) continue;
    const lineStart = lineStartOf(html, at);
    const indent = indentAt(html, at);
    if (lineStart + indent.length < at) {
      return { html: html.slice(0, at) + tag + html.slice(at), where };
    }
    return { html: html.slice(0, lineStart) + indent + indentBlock(tag, indent) + "\n" + html.slice(lineStart), where };
  }
  const separator = html === "" || html.endsWith("\n") ? "" : "\n";
  return { html: html + separator + tag + "\n", where: "at the end of the file" };
}

export function replaceScriptLine(html: string, tag: string): PlacedScriptLine | null {
  const found = EXISTING_TAG.exec(html);
  if (found === null) return null;
  const indent = indentAt(html, found.index);
  return {
    html: html.slice(0, found.index) + indentBlock(tag, indent) + html.slice(found.index + found[0].length),
    where: "in the place it already had"
  };
}

export function removeScriptLine(html: string): RemovedScriptLine | null {
  const found = EXISTING_TAG.exec(html);
  if (found === null) return null;
  const tagEnd = found.index + found[0].length;
  const lineStart = lineStartOf(html, found.index);
  const ownLine = /^[ \t]*$/.test(html.slice(lineStart, found.index));
  const start = ownLine ? lineStart : found.index;
  const end = ownLine && html.charAt(tagEnd) === "\n" ? tagEnd + 1 : tagEnd;
  return { html: html.slice(0, start) + html.slice(end), review: reviewOf(found) };
}

export function reviewAlreadyInFile(html: string): string | null {
  const found = EXISTING_TAG.exec(html);
  return found === null ? null : reviewOf(found);
}
