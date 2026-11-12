/*
 * read-when: A .ts file is refused for importing a .js file, or you are changing what counts as one.
 */

import type { JSSyntaxElement, Rule } from "eslint";

const JS_FILE = /\.[cm]?jsx?$/;

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function importsJs(value: unknown): value is string {
  return typeof value === "string" && isRelative(value) && JS_FILE.test(value);
}

type ImportSource = JSSyntaxElement & { readonly value?: unknown };

export const noJsImports: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "A .ts file imports only .ts files, so the type checker never reads unconverted JavaScript."
    },
    messages: {
      jsImport:
        "A .ts file may not import a .js file ({{specifier}}). Convert that file first, or import its .ts successor; scripts/import-layers.mts prints the order."
    },
    schema: []
  },
  create(context) {
    function check(source: ImportSource): void {
      if (source.type !== "Literal" || !importsJs(source.value)) return;
      context.report({ node: source, messageId: "jsImport", data: { specifier: source.value } });
    }
    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      }
    };
  }
};
