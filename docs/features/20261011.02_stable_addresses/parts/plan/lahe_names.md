### Workstream: lahe-names (Step 6)

**Outcome:** on macOS, `lahe install --lahe-names` makes every site also answer at `<name>.lahe`, but only after the helper has proved its own name server answers `.lahe` lookups.

**Reads first:** the architecture's "`.lahe` on macOS (opt-in)" section and Security notes on DNS rebinding; Ken's answer to the brief's question on the printed ending.

**Starts** after PR 3. Lands as PR 4.

**Task 6.1: The name server, `src/service/name_server.js`.** Acceptance: V54, V55.

**Task 6.2: Resolver setup and verification.** Acceptance: V56 to V59, plus V73 on Ken's Mac.

**Task 6.3: Only if Ken chose `.lahe` as the printed ending.** Fallbacks for a non-secure page:

- copy, reusing Task 4.2's function in `export.js` and `overlay.js`;
- a local-storage lease in `store.js` when Web Locks is missing;
- page-type detection from `Accept`.

Tests reach a non-secure origin through a Chromium host-resolver rule, Chromium only. If Ken chose `.lahe` printed, Task 3.3 already wrote that ending into the skill and contract, so this task touches no docs. If Ken keeps `.lahe.localhost`, this task is dropped, and V60 to V62 are marked not applicable. Acceptance: V60 to V62.
