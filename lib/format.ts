// Display helpers. Timestamps are stored in UTC and shown in the instance timezone
// (docs/standards.md section 5).

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** A calendar date (`YYYY-MM-DD`, no time or zone) as "30 Nov". */
export function formatDueDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; older dates as a date. */
export function formatRelative(date: Date, now: Date, timeZone: string): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDateTime(date, timeZone);
}

/**
 * Only http(s) links from agent data become clickable. Agent output is untrusted (SECURITY.md T2),
 * and a `javascript:` or `data:` URL must never reach an href.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
