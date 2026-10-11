### Chosen: the helper serves pages, one name per file, one port

The rest of this leaf records what was weighed against it.

### A port per document, held open forever

Keeps today's origin model exactly. Rejected: 682 reviews already exceed the 256 open files macOS gives a login program by default, every port can clash with another tool, and the address still says nothing about the document. Settled by Ken on the decisions page.

### One host, paths per document (`127.0.0.1:7817/r/<review>/`)

Shortest change. Rejected: every document would share one origin with every other and with the Library, so one page's JavaScript could read every token and drive the Library. Settled by Ken.

### One name per folder instead of per file

Matches today's isolation unit (a page server serves a folder), so relative links between pages stay same-origin with no redirect. Rejected: the brief defines the unit as one file, the name would be a folder name (`docs`, `ongoing`) that says little in a tab, and two documents in one folder would keep sharing tokens and drafts. The per-file choice costs a redirect between pages, which only top-level navigations take.

### Name from the review id (`ra192291dfb29.lahe`)

Unique with no clash rule. Rejected: Ken's complaint is reading dead tabs by their address, and an id says nothing. It would also give the same file a new address for every new review.

### Keep per-session page servers, add a front proxy that routes names to them

Reuses `static_servers.js` as is. Rejected: a page server still stops with its session and on idle, so the proxy needs to restart processes on demand, keeping the lifecycle code this feature can retire. Two hops per request and a process per folder for no gain once the helper is always on.

### A separate always-on page process beside the helper

Keeps page serving out of the API process. Rejected for now: two always-on processes, two login items or one supervising the other, and the page process needs the review data the helper already holds in memory. The helper's request handling is small and asynchronous; Markdown rendering is the one CPU step and is cached by file time.

### Pages call the API same-origin (`name.lahe:7817/lahe/v1/...`)

Removes CORS preflights. Rejected for this feature: it changes every layer call and the D11 check order, for no user-visible gain. Pages keep calling `127.0.0.1:<port>` as today. Worth revisiting if Chrome's local-network rules ever treat a `.lahe` page as less local than loopback.

### Local HTTPS for `.lahe`

Makes `.lahe` a secure context: no "Not secure" label, the clipboard API works. Rejected for this feature: it needs a local certificate authority trusted by every browser on every system (the `mkcert` approach), which is an admin step per browser on some systems, a new private key to protect, and a renewal story. `.lahe.localhost` already gets a secure context for free. Kept as a follow-up if the label bothers Ken.

### Socket activation (launchd or systemd starts the helper on first connection)

The system holds the port and starts Lahe only when a page is opened, so nothing runs while idle. Rejected: macOS, Linux, and Windows each do it differently and Windows has no equivalent, which breaks the cross-platform core rule. The helper's idle cost is small enough to stay running.

### Editing `/etc/hosts` instead of a resolver

Ken's first suggestion. Rejected: the hosts file has no wildcard, so every new file would need a line and an admin password. A resolver entry plus a tiny name server needs one password, once.

### Rewriting old items' page fields to the new address

Would make old comments match with no alias list. Rejected: the event log is history and is not rewritten, and the browser's own stored drafts under the old origin cannot be moved anyway. Aliases cost one small list in the script tag.
