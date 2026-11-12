/*
 * read-when: Changing what cleaning markup keeps, drops or rewrites for a record.
 */

export interface CleanMarkupOptions {
  readonly keepWhitespace?: boolean;
}

export function cleanMarkup(html: string, options?: CleanMarkupOptions): string {
  throw new Error("C2: not built yet" + html + String(options?.keepWhitespace));
}
