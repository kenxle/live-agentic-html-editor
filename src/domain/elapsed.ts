/*
 * read-when: Changing how elapsed time is worded for a reader.
 */

export type ElapsedStart = string | number | Date;

export interface ElapsedOptions {
  readonly now?: number;
}

const SECONDS_PER_MINUTE = 60;
const RECENT_MINUTES_MAX = 90;

export function elapsedPhrase(since: ElapsedStart, options: ElapsedOptions = {}): string {
  const startedAt = since instanceof Date ? since : new Date(since);
  const startedMs = startedAt.getTime();
  if (Number.isNaN(startedMs)) return "since " + String(since);
  const now = options.now ?? Date.now();
  const seconds = Math.max(0, Math.round((now - startedMs) / 1000));
  if (seconds < SECONDS_PER_MINUTE) return "for less than a minute";
  if (seconds < RECENT_MINUTES_MAX * SECONDS_PER_MINUTE) {
    const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
    return "for the last " + String(minutes) + (minutes === 1 ? " minute" : " minutes");
  }
  return "since " + startedAt.toLocaleString();
}
