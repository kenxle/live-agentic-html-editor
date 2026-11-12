/*
 * read-when: Choosing which src/ file a TypeScript slice may convert next, or checking src/ for import cycles.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

interface Graph {
  readonly converted: readonly string[];
  readonly forwarders: ReadonlyMap<string, string>;
  readonly unconverted: ReadonlyMap<string, ReadonlySet<string>>;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:js|ts)$/.test(entry.name) ? [full] : [];
  });
}

function asRepoPath(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  const found = [base, base + ".js", join(base, "index.js")].find((file) => existsSync(file) && statSync(file).isFile());
  return found !== undefined && found.startsWith(SRC + sep) && /\.(?:js|ts)$/.test(found) ? found : null;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const targets = ts.preProcessFile(text, true, true).importedFiles.map((ref) => resolveImport(file, ref.fileName));
  return targets.filter((target): target is string => target !== null && target !== file);
}

function buildGraph(): Graph {
  const files = sourceFiles(SRC);
  const imports = new Map(files.map((file) => [file, importsOf(file)]));
  const forwarders = new Map<string, string>();
  for (const [file, targets] of imports) {
    const only = targets[0];
    if (file.endsWith(".js") && targets.length === 1 && only !== undefined && only.endsWith(".ts")) forwarders.set(file, only);
  }
  const unconverted = new Map<string, Set<string>>();
  for (const [file, targets] of imports) {
    if (!file.endsWith(".js") || forwarders.has(file)) continue;
    const pending = targets.map((target) => forwarders.get(target) ?? target).filter((target) => target.endsWith(".js"));
    unconverted.set(file, new Set(pending));
  }
  return { converted: files.filter((file) => file.endsWith(".ts")), forwarders, unconverted };
}

function stronglyConnected(edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  function visit(node: string): void {
    index.set(node, index.size);
    low.set(node, index.size - 1);
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const group: string[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      group.push(member);
      if (member === node) break;
    }
    groups.push(group.sort());
  }
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  return groups;
}

function layersOf(edges: ReadonlyMap<string, ReadonlySet<string>>, groups: readonly string[][]): string[][][] {
  const groupOf = new Map(groups.flatMap((group, at) => group.map((member) => [member, at] as const)));
  const depth = new Map<number, number>();
  function depthOf(at: number): number {
    const known = depth.get(at);
    if (known !== undefined) return known;
    const members = groups[at] ?? [];
    const below = members.flatMap((member) => [...(edges.get(member) ?? [])]).map((next) => groupOf.get(next) ?? at);
    const deepest = Math.max(-1, ...below.filter((other) => other !== at).map(depthOf));
    depth.set(at, deepest + 1);
    return deepest + 1;
  }
  const layers: string[][][] = [];
  groups.forEach((group, at) => {
    const layer = depthOf(at);
    (layers[layer] ??= []).push(group);
  });
  return layers.map((layer) => layer.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")));
}

function report(graph: Graph): string {
  const groups = stronglyConnected(graph.unconverted);
  const cycles = groups.filter((group) => group.length > 1);
  const lines = [`Converted: ${String(graph.converted.length)} .ts file(s)`];
  for (const file of graph.converted) lines.push(`  ${asRepoPath(file)}`);
  lines.push(`Forwarders: ${String(graph.forwarders.size)}`);
  for (const [from, to] of graph.forwarders) lines.push(`  ${asRepoPath(from)} -> ${asRepoPath(to)}`);
  lines.push(`Unconverted: ${String(graph.unconverted.size)} .js file(s), in layers. Layer 0 imports nothing unconverted.`);
  layersOf(graph.unconverted, groups).forEach((layer, at) => {
    lines.push(`Layer ${String(at)}:`);
    for (const group of layer) {
      const names = group.map(asRepoPath);
      lines.push(group.length > 1 ? `  together (a cycle): ${names.join(", ")}` : `  ${names.join("")}`);
    }
  });
  lines.push(`Cycles: ${String(cycles.length)}`);
  for (const cycle of cycles) lines.push(`  ${cycle.map(asRepoPath).join(", ")}`);
  return lines.join("\n") + "\n";
}

process.stdout.write(report(buildGraph()));
