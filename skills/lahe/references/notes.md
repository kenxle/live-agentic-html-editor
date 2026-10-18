# Notes the reviewer writes

### Notes on a blank page

When your human wants to write, not review, run `lahe write <file.md>`. It
creates the file when it does not exist, or opens it as it is, and prints what
`lahe review` prints. Hand over the `open` URL the same way. The page opens ready
to type.

- The folder must already exist. It refuses a name that is not `.md` or
  `.markdown`, a directory, any symlink, and a file with more than one hard
  link, and it never overwrites a file.
- The page gets its own address that serves that one page and nothing else in
  its folder, so notes in a home or Documents folder are safe to open.
  `--session <id>` adds it to your session and still gives it its own address.
- To hand a notes page over again, run either
  `lahe write <file.md> --session <id>` or `lahe review <file.md> --session <id>`.
  Both print the same notes address, because the review is a notes review.
- The review carries `notes: true` in `review.json`. Each sitting arrives as one
  item with its words in `new_blocks`: place them in the file as written, at the
  top of the file for `start_of_container`. Organize the notes only when your
  human asks.

Keep the reviewer's format and words. Do not add your own prose to a region
they wrote; suggestions belong in replies. If placement is unclear, reply
`question`. Read [free writing](free-writing.md) before placing drain items,
then use [review](review.md) for setup, the URL, contract and monitor.
