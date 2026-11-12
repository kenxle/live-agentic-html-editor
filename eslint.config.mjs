/*
 * read-when: Changing a lint rule for .ts files, or when ESLint reports something in npm run lint.
 * not-for: The compiler's own strictness flags; see tsconfig.base.json and docs/ongoing/code/README.md.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import { noComments } from "./scripts/eslint-rules/no-comments.ts";
import { noJsImports } from "./scripts/eslint-rules/no-js-imports.ts";

const lahe = { rules: { "no-comments": noComments, "no-js-imports": noJsImports } };

const NO_PACKAGES = {
  regex: "^(?![./]|node:)",
  message: "Nothing under src/ imports a package: Lahe has no runtime dependencies."
};
const NO_NODE = {
  regex: "^node:",
  message: "This folder runs outside Node (or anywhere), so it cannot import Node's modules."
};

function notFolders(names) {
  return {
    regex: "^(?:\\.\\./)+(?:" + names.join("|") + ")(?:/|$)",
    message: "This folder may not import from " + names.join(", ") + ". See the folder table in docs/features/20261112.01_typescript_migration/parts/target_layout.md."
  };
}

const BOUNDARIES = [
  { files: ["src/contract/**/*.ts"], patterns: [NO_PACKAGES, NO_NODE, notFolders(["domain", "server", "cli", "browser"])] },
  { files: ["src/domain/**/*.ts"], patterns: [NO_PACKAGES, NO_NODE, notFolders(["server", "cli", "browser"])] },
  { files: ["src/server/**/*.ts"], patterns: [NO_PACKAGES, notFolders(["cli", "browser"])] },
  { files: ["src/cli/**/*.ts"], patterns: [NO_PACKAGES, notFolders(["browser"])] },
  {
    files: ["src/browser/review-layer/**/*.ts"],
    patterns: [NO_PACKAGES, NO_NODE, notFolders(["server", "cli", "library-page"])]
  },
  {
    files: ["src/browser/library-page/**/*.ts"],
    patterns: [NO_PACKAGES, NO_NODE, notFolders(["server", "cli", "review-layer"])]
  }
];

export default defineConfig(
  globalIgnores([
    "**/*.js",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.d.ts",
    "node_modules/",
    ".tsbuild/",
    ".claude/",
    "dist/",
    "docs/",
    "vendor/",
    "test/fixtures/"
  ]),
  {
    files: ["**/*.ts", "**/*.mts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error"
    },
    plugins: { lahe },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-check": true, "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }
      ],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          allowDefaultCaseForExhaustiveSwitch: false,
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true
        }
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "forbid", trailingUnderscore: "forbid" },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "variable", modifiers: ["const"], format: ["camelCase", "UPPER_CASE"] },
        { selector: "variable", modifiers: ["destructured"], format: null },
        { selector: "import", format: ["camelCase", "PascalCase"] },
        {
          selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty", "typeMethod"],
          format: ["camelCase", "PascalCase", "snake_case", "UPPER_CASE"]
        },
        {
          selector: ["objectLiteralProperty", "typeProperty", "objectLiteralMethod", "typeMethod"],
          modifiers: ["requiresQuotes"],
          format: null
        }
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "Use a named export; default exports are banned." },
        { selector: "ExportSpecifier[exported.name='default']", message: "Use a named export; default exports are banned." },
        {
          selector: "ExportNamedDeclaration > VariableDeclaration[kind!='const']",
          message: "Export a const or a function, never a let or var: forwarders and the browser bundle copy the exports once, so a reassignment would not reach them."
        },
        {
          selector: "AwaitExpression:not(:function AwaitExpression)",
          message: "No top-level await: CommonJS callers cannot require a module that has one."
        },
        {
          selector: "ForOfStatement[await=true]:not(:function ForOfStatement)",
          message: "No top-level await: CommonJS callers cannot require a module that has one."
        },
        { selector: "TSEnumDeclaration", message: "No enum: use an `as const` object and a derived union type." },
        { selector: "TSModuleDeclaration", message: "No namespace: use a module." },
        { selector: "CallExpression[callee.name='require']", message: "Use import, not require, in a .ts file." }
      ],
      "max-lines": ["off", { max: 400, skipBlankLines: false, skipComments: false }],
      "lahe/no-comments": "error",
      "lahe/no-js-imports": "error"
    }
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite", "before", "after", "beforeEach", "afterEach"] }
          ]
        }
      ]
    }
  },
  ...BOUNDARIES.map((boundary) => ({
    files: boundary.files,
    rules: { "no-restricted-imports": ["error", { patterns: boundary.patterns }] }
  }))
);
