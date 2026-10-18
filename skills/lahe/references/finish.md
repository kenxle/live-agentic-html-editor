# Finish a review

## Save as PDF

The rail's PDF button opens a tray. Choosing "Save as PDF" sends a ready note:
"Make a PDF of this page." Treat it as a request for a PDF of the current
document, not as a request to end the review. Use the document's source and its
existing export process when it has one. Otherwise export a clean rendered page
to PDF. Inspect the PDF pages for missing content, broken layout, and review
controls. Put the PDF beside the document or in its normal output folder, then
reply with a link to it. Keep the review open if the reviewer is still working.

An `ended` wake is a request to finish, not permission to abandon work.
The drain lists `ended_reviews` until its unanswered items are resolved,
then once more. Complete this routine before closing the session.

### The end of a review

The reviewer presses the exit button in the rail footer and you are woken. Run this
routine in order:
**Read the user settings file** now, before step 3:
`$XDG_CONFIG_HOME/lahe/user.env`, or `~/.config/lahe/user.env` when
`XDG_CONFIG_HOME` is not set. It holds plain `KEY=value` lines, and lines
starting with `#` are comments. Today it has two keys:

- `LAHE_VOICE_PROPOSALS_DIR`: the folder where voice proposals go.
- `LAHE_VOICE_DOCS`: the voice documents to check a proposal against, as paths
  separated by `:`.

A missing file or a missing key means that step is off for this user. Skip the
step and say so once.

1. **Drain to empty.** Ending discards nothing. Work each unanswered item, or reply
   saying why not.
2. **Write the hand-edit list beside the document they reviewed**, before and after
   for every hand edit.
3. **Read those edits for voice.** Skip this and step 4 if `LAHE_VOICE_PROPOSALS_DIR`
   is not set. `change` says what moved. `after_history` holds every wording they
   committed and then replaced.
4. **Propose rarely, and only a pattern.** One substitution is a typo; the same one
   five times is a rule. Check the documents in `LAHE_VOICE_DOCS` first, because
   the rule is often already there. An edit they took back supports nothing. Write
   each proposal as a new file in `LAHE_VOICE_PROPOSALS_DIR`. If that folder has a
   README or charter, read it first.
5. **Take the tool back out**, per the next section.
6. **Say what you did** in a few lines: what you wrote, where, and any voice
   proposal. "Nothing worth a rule this time" is a real answer.

### Taking the tool back out

Do this when the review is over, or when the reviewed source is about to become
something else: a deploy, an email, or an attachment. A PDF export during an
active review uses a clean render; it does not close the review.

```sh
lahe add path/to/page.html --remove   # takes the script line back out
lahe session close <agent-session-id> # ends the session; its pages keep their addresses
```

`--remove` takes out the script line and a `lahe-layer.js` beside the page that this
tool put there. A served review put neither there. Closing the last open session
also stops the shared helper, and any running monitor exits with code 5. The
helper stays up if it is always on (`lahe install`, or `lahe serve --always-on`),
if the Library page polled it in the last two minutes, or if a review page is
still open. For your
own dev app, delete the script line you pasted into its layout.

Delete the state directory only when your human asks. `Removing it` in
`docs/INSTALL.md` has the detail.
