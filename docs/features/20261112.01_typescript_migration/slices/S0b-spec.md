---
read-when: Building, reviewing or testing slice S0b's pilot, the rebuild of src/shared/script_line.js as src/server/sites/script-line.ts.
---

# S0b spec: the script line, rebuilt as `src/server/sites/script-line.ts`

The script line is the one `<script>` tag `lahe add` writes into a static HTML page, and that the server writes back when a rebuild strips it out. This module finds that tag in a page's text, places a new one, replaces it and takes it out. It reads and returns strings; it touches no file.

Old file: `src/shared/script_line.js` (169 lines: 57 comment lines, 13 blank, 99 code; counted by `count_lines.py` in the slice's progress detail). Only Node runs it: the server and the CLI.

## Who calls it, and what they rely on

| Caller | Uses | Relies on |
| --- | --- | --- |
| `src/cli/commands/add.js` | all five names, and re-exports four of them | `where` goes into the command's own output: "The script line is in page.html, just before &lt;/body&gt;." |
| `src/service/heal.js` | `placeScriptLine`, `reviewAlreadyInFile` | `where` goes into the server log line about the heal |
| `src/service/page_routes.js` | `EXISTING_TAG.exec`, `placeScriptLine`, `removeScriptLine`, `reviewAlreadyInFile` | `EXISTING_TAG.exec` finds the first tag and its position, with the whole tag as match 0 |
| `src/service/catalog_reader.js` | `EXISTING_TAG.source` | builds its own global copy of the pattern to scan every tag in a file |
| unit and browser tests | `placeScriptLine`, `removeScriptLine`, `reviewAlreadyInFile` as a way to set up or read a page | the same results as the callers above |

No caller reads the `indent` field the old results carried, and none calls `indentAt` or `indentBlock`.

## Behavior

Each statement is something a caller, or a person reading a page or the command's output, can observe. The new tests check these.

**Finding the line**

1. A script line is a `<script ...></script>` tag that carries a `data-lahe-review="..."` attribute and has nothing but whitespace between its opening and closing tags. Tag names and the closer match in any letter case. The attribute list may span several lines.
2. `reviewAlreadyInFile(html)` returns the review id of the first script line in the text, or `null` when there is none. A `<script>` without `data-lahe-review`, or one with a body, is not a script line.
3. `EXISTING_TAG` is a regular expression without the global flag. `exec` on it finds the first script line: the whole tag is match 0, the review id is group 1, and the position is the match's index. Its `source` makes a global pattern that finds every script line in a file.

**Placing a new line**

4. `placeScriptLine(html, tag)` puts the tag immediately before the last `</body>` in the text and says `"just before </body>"`. The last one, not the first: a page that quotes `</body>` in its prose still ends at the real one. `</body >` with space before the `>` counts, in any letter case.
5. A `</body>` inside an HTML comment, a `<script>` element or a `<style>` element does not count, including a comment or element that is never closed and so runs to the end of the text.
6. With no `</body>` that counts, the tag goes immediately before the last `</html>` that counts, under the same rules, and the result says `"just before </html>"`.
7. With neither, the tag is added at the end and the result says `"at the end of the file"`. A newline separates it from text that does not already end in one, and a newline follows it. Empty text becomes the tag and a newline.
8. When only spaces and tabs come before the closer on its line, the tag goes on a line of its own just above the closer, at the closer's indentation, with a newline after it. Every line of a tag that spans several lines after the first gets that same indentation added.
9. When other markup comes before the closer on its line (a minified page), the tag goes directly before the closer on that same line, with no newline and no indentation added.

**Replacing and removing**

10. `replaceScriptLine(html, tag)` puts the new tag where the first script line was, says `"in the place it already had"`, and leaves the rest of the text as it was. Lines of the new tag after its first get the indentation of the line the old tag started on. It returns `null` when the text has no script line.
11. `removeScriptLine(html)` takes out the first script line and returns the text without it and the review id it carried. Every other script on the page stays. When only spaces and tabs come before the tag on its line, that indentation and the one newline after the tag go too, so no blank line is left. A tag sharing its line with other markup takes only itself. It returns `null` when the text has no script line.
12. Placing a line and then removing it gives back the original text byte for byte, whenever the line went before a closer or the text ended in a newline. This holds for the pinned multi-line tag, including its fallback form with an `onerror` attribute.

## Module design

One module, `src/server/sites/script-line.ts`, since the job is one job and small. It belongs under `sites` because it serves the pages a site publishes, beside `heal` and `page-routes` when they convert.

```ts
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

export const EXISTING_TAG: RegExp;
export function placeScriptLine(html: string, tag: string): PlacedScriptLine;
export function replaceScriptLine(html: string, tag: string): PlacedScriptLine | null;
export function removeScriptLine(html: string): RemovedScriptLine | null;
export function reviewAlreadyInFile(html: string): string | null;
```

- `ScriptLinePlace` is a union of the four phrases, because they are text a person reads in `lahe add`'s output and the server log. A typo in one is now a compile error.
- The closers are one table of `{ pattern, where }` rows, tried in order, instead of an index into two parallel lists.
- The spans a closer may not fall inside (comments, scripts, styles) come from one pattern and `matchAll`. The old zero-length-match guard goes: no branch of the pattern can match empty text.
- Exported names stay as they are, so the forwarder at `src/shared/script_line.js` serves the four unconverted callers with no edit.

## Old tests, accounted for

There was no test file for `script_line.js` alone. Its cases lived in two other files. The new tests are in `test/unit/server/sites/script-line.test.ts`.

| Old case | Where | Carried to | Behavior |
| --- | --- | --- | --- |
| the script line goes before `</body>`, then before `</html>`, then at the end | `add_command.test.js` | moved | 4, 6, 7, 8 |
| on a minified page the script line goes directly before `</body>`, and comes out byte for byte | `add_command.test.js` | moved | 5, 6, 9, 12 |
| the fallback form still places, replaces and removes as one line | `add_command.test.js` | moved | 2, 10, 11, 12 |
| `--remove` removes the lahe tag and no other script on the page | `add_command.test.js` | moved | 11 |
| scriptTag writes data-lahe-document only when asked, and add's tag finder still matches it | `choice_kernel.test.js` | stays where it is; its script line half is also carried | 1, 2, 12 |

The four moved cases called the functions through `add.js`'s re-exports. They are removed from `add_command.test.js`, and every assertion in them has a counterpart in the new file. The `choice_kernel.test.js` case stays because it is mainly about `protocol.scriptTag`; the new file adds the `data-lahe-document` tag to its round trip.

Nothing is dropped.

New cases with no old counterpart: statement 3 (the pattern's flags, groups and `source`), the case-insensitive and spaced closers in 4, the unclosed comment and style in 5, the multi-line indentation in 8, replace in a tag that shares its line in 10, and `null` from `replaceScriptLine`.

## Deliberate differences

- The results no longer carry `indent`. No caller read it.
- `indentAt` and `indentBlock` are no longer exported. No caller used them.

Neither is something a person or an agent can observe. No behavior statement above differs from the old code.

## Fixed behavior tests that touch this slice

- `test/unit/add_command.test.js`: the real `lahe add` runs, its output and the file it leaves. They must pass unchanged in what they assert, through the forwarder.
- `test/unit/heal_script_line.test.js`, `page_routes_carried.test.js`, `markdown_linked_docs.test.js`, `choice_kernel.test.js`: they use the module to set up pages or read them back.
- `test/unit/protocol_wire.test.js`: pins that the fallback `onerror` attribute holds no `>`, which statement 1 depends on.
- `test/browser/stable_addresses_mappers.spec.js`: places the line on pages a test server returns. It runs at the checkpoint.
