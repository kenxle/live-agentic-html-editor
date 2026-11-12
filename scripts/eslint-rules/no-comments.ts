/*
 * read-when: Changing which comments the lint gate allows in a .ts file, or when lahe/no-comments reports one.
 */

import type { Rule } from "eslint";

const HEADER_BODY = /^\n \* read-when: \S[^\n]*(?:\n \* not-for: \S[^\n]*)?\n $/;

const SHAPE =
  "the header block first in the file, holding one ' * read-when: ...' line and, optionally, one ' * not-for: ...' line";

interface CommentLike {
  readonly type: string;
  readonly value: string;
  readonly range?: [number, number] | undefined;
}

function isHeader(comment: CommentLike): boolean {
  return comment.type === "Block" && comment.range?.[0] === 0 && HEADER_BODY.test(comment.value);
}

export const noComments: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Allow exactly one comment in a .ts file: its read-when header, first in the file."
    },
    messages: {
      comment:
        "Only one comment is allowed in a .ts file: " +
        SHAPE +
        ". Move the why, the traps and the history to the folder doc under docs/ongoing/code/.",
      missingHeader: "This file has no read-when header. Start it with " + SHAPE + "."
    },
    schema: []
  },
  create(context) {
    return {
      Program(node) {
        const comments = context.sourceCode.getAllComments();
        const first = comments[0];
        const headed = first !== undefined && isHeader(first);
        if (!headed) context.report({ node, messageId: "missingHeader" });
        for (const comment of headed ? comments.slice(1) : comments) {
          context.report({ loc: comment.loc ?? node.loc, messageId: "comment" });
        }
      }
    };
  }
};
