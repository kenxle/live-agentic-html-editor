export const PUNCTUATION = "!";

export function shout(name: string): string {
  return name.toUpperCase() + PUNCTUATION;
}
