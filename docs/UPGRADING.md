---
read-when: Moving an existing Lahe install to a newer version, or when an upgrade breaks addresses.
---

# Upgrading

## Node 24.12 or newer

Lahe now needs Node 24.12 or newer (it was 18.2). If your Lahe was installed
with an older Node, the next `lahe` command after a `git pull` prints this and
stops with a non-zero exit code:

```
lahe: Lahe needs Node 24.12 or newer, and this is Node 20.19.0. Install Node 24, then run `npm run install-cli` and `lahe install` in /path/to/your/clone.
```

The wrapper at `~/.local/bin/lahe`, the login item and the agent's Stop hook all
name the Node that was current when you installed them, so all three keep using
the old one until you reinstall them. A helper that is already running keeps
serving its old code until it restarts.

### Steps

1. **Install Node 24.12 or newer.** For example, with nvm: `nvm install 24`,
   then `nvm use 24`. Check it with `node --version`.

2. **Reinstall the command, the login item and the skills,** from the clone and
   with that Node selected:

   ```sh
   npm run install-cli
   lahe install          # Windows: node bin/lahe.js install
   npm run install-skills
   ```

   `npm run install-cli` rewrites the wrapper so it names the new Node, and
   refuses to run on a Node below 24.12. `lahe install` replaces the login item
   so the helper starts on the new Node at login. `npm run install-skills`
   refreshes the skill and the agent's Stop hook, which also name a Node.

3. **Check it.** `lahe --help` runs, and `lahe status` shows the helper.

## From 0.2 to 0.3: stable addresses

In 0.2, each document was served by a small server that belonged to one agent
session, at an address like `http://127.0.0.1:56055/brief-c1ca63646095f216.html`.
That server stopped a couple of minutes after its last window closed, so old
tabs, history entries and bookmarks went dead.

In 0.3, one helper serves every document at an address that stays the same:
the document's folder and its two parent folders as the name, then the file.

```
http://docs.features.my-plan.lahe.localhost:1483/brief.md
```

### Steps

1. **Update the clone and the agent instructions.**

   ```sh
   git pull
   npm run install-skills
   ```

2. **Keep the helper running.** Type this yourself in a terminal (an agent
   asks you to type `! lahe install`):

   ```sh
   lahe install          # Windows: node bin/lahe.js install
   ```

   The helper now starts at login, and addresses load after a session closes or
   the computer restarts. On macOS, two extras are optional. Each asks for your
   admin password once:

   - `lahe install --port-80` drops the `:1483` from addresses.
   - `lahe install --lahe-names` adds a short `<name>.lahe` alias.

   Details: [INSTALL.md](INSTALL.md#keeping-addresses-working-lahe-install).

3. **Give your older documents their new address.** Nothing needs moving on
   disk. A document gets its new address the first time it is opened again,
   either way:

   - from the Library: run `lahe library`, open the address it prints, and
     click **Open** on the document's row;
   - or by having your agent run `lahe review <file>` on it.

   Your old comments come with it. The first time the page opens at its new
   address, the rail shows the comments you left at the old one. Nothing is
   sent to your agent twice.

4. **Re-save bookmarks.** Old `127.0.0.1:<port>` links do not come back. Open
   the document once at its new address and bookmark that.

### What else changes

- **One review per file.** `lahe review` of a file that already has a review
  opens that review, whichever agent runs it. If another agent's session owns
  it, the command says so. `lahe review retire <review> --session <id>` ends a
  review on purpose.
- **Every page carries its own comments.** A linked document opens at its own
  address with its own comments. Comments that an older version filed in a
  different review show read-only, in a list labelled "Filed in another
  review".
- **Handing a live session to another agent** goes through the Library. While
  a session's agent is still listening, `lahe session takeover` from the
  command line needs the request the Library made when you confirmed it.

### Known issue

With `lahe install --port-80` set up, the address with `:1483` can time out on
macOS. The address without the port works. A fix is in progress.
