# Upgrading

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
