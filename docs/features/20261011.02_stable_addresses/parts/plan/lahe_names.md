### Workstream: lahe-names (Step 6)

**Outcome:** on macOS, `lahe install --port-80` makes addresses print without a port, and `lahe install --lahe-names` makes every site also answer at `<name>.lahe`. Each takes effect only after the helper proves it works. Linux and Windows get written steps for both in `docs/INSTALL.md`.

**Reads first:** the architecture's "Port-free addresses and `.lahe` on macOS (opt-in)" and "written steps" sections and Security notes on DNS rebinding; the brief's resolved decision: `.lahe.localhost` is printed, and `.lahe` is an alias.

**Starts** after PR 3. Lands as PR 4.

**Task 6.1: The name server, `src/service/name_server.js`.** Acceptance: V54, V55.

**Task 6.2: Resolver setup and verification.** Acceptance: V56 to V59, plus V73 on Ken's Mac.

**Task 6.0: Port-free addresses on macOS, first.** It matters whatever the ending, so it lands before the name server. `lahe install --port-80` loads a loopback forward from port 80 to 1483, for `127.0.0.1` and `::1`, and reloads it at boot. It is skipped, with a status line naming the holder, when something already listens on port 80. The helper verifies the forward before `lahe review` prints an address without a port. `lahe uninstall` removes only the forward it added. Acceptance: V74, V75, V76.
