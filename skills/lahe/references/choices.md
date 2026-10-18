# Ask and answer with choice groups

A choice group is a question with real buttons. The reader clicks one, and the
click reaches you as the answer, with nothing to type. Use it when you can name
every answer in advance and will act on the one they pick: promote or discard,
ship or hold, A or B. When the answer is free text, ask in prose and expect a
comment.

- **Option cards describe the alternatives; a choice group collects the
  answer.** When the alternatives need explaining, put option cards above the
  group. A page that only records a decision already made uses neither.
- **Read [the catalog's choice group](components.md#choice-group) before
  writing markup.** It defines group and answer names, recommendation and
  selection attributes, and Markdown block structure. Pick names you will
  recognize when an answer arrives.
- **A press arrives on the drain as an item with `kind` `choice`.** `choice.group`
  and `choice.answer` sit at the top level: they are the reader's decision.
  `page.quote` is the group's question and `page.context.heading` the nearest
  heading above it, of any level, so a `###` per lesson is what you get back.
- **Answer it like any item.** Do what the answer says. Then write `data-chosen`
  (no value) onto the chosen button in the source, rebuild, and reply `handled`
  in one sentence about the document. The attribute is how the file keeps the
  decision: the page shows it with no Lahe running, and in print. A handled
  reply without it is incomplete. When you need more from the reader, reply
  `question` on the thread; when you will not do it, reply `not_handled` with
  the reason.
- **A changed mind is a new item.** A press on a group you already handled
  arrives as a new item. Undo what the earlier answer asked for where you can,
  do the new one, move `data-chosen` to the new button, and say both.
- **Words on a group are an ordinary comment**, answered as one. Words the
  reader types on a choice thread arrive in `note`.
- Never press a button yourself, and never write `data-lahe-pressed`,
  `data-lahe-choice-state` or `data-lahe-inert`; Lahe paints those while a
  review runs. (`data-lahe-id` is different: carry it into the source when the
  page check asks, as before.)

Follow [feedback](feedback.md) for verification and replies.
