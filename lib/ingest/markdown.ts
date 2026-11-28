// Markdown fallback ingest (ADR-0012). Pure: no I/O, never throws.
//
// Agents that do not yet write a JSON run file still write a Markdown log. This module recognizes
// those logs by file name, derives agent and run time from the name, and extracts a few fields
// where that is cheap and robust. Anything it cannot read makes the run `partial`, never dropped.

/** File names carry Europe/Amsterdam local time (agent contract, section 1). */
export const FILE_NAME_TIMEZONE = "Europe/Amsterdam";

/** What the reader assumes about the agents that write Markdown logs, when they are unknown. */
export const MARKDOWN_AGENTS = {
  "mail-triage": { name: "Mail triage", schedule: "CRON_TZ=Europe/Amsterdam 48 6 * * *" },
  "localchat-wachter": {
    name: "LocalChat-wachter",
    schedule: "CRON_TZ=Europe/Amsterdam 45 7 * * *",
  },
  weekbrief: { name: "Weekbrief", schedule: "CRON_TZ=Europe/Amsterdam 50 12 * * 5" },
} as const;

export type MarkdownAgent = keyof typeof MARKDOWN_AGENTS;

export type RunFileName = {
  agent: MarkdownAgent;
  /** File name without `.md`, used as the run ID. */
  stem: string;
  /** Start of the period the name stands for (the exact run start for mail-triage). */
  periodStart: Date;
  /** End of that period, exclusive. Equal to `periodStart` when the name has a minute. */
  periodEnd: Date;
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const MAIL_TRIAGE = /^mail-triage-run-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.md$/;
const WACHTER = /^localchat-wachter-run-(\d{4})-(\d{2})-(\d{2})\.md$/;
const WEEKBRIEF = /^weekbrief-run-(\d{4})-w(\d{2})\.md$/;

/**
 * Recognize a Markdown run file by its name. Returns null for every other file, including
 * `mail-triage-state.md` and the legacy `*-log.md` files.
 */
export function parseRunFileName(name: string): RunFileName | null {
  let m = MAIL_TRIAGE.exec(name);
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
    if (!isValidDate(y, mo, d) || h > 23 || mi > 59) return null;
    const start = zonedTimeToUtc(y, mo, d, h, mi, FILE_NAME_TIMEZONE);
    return { agent: "mail-triage", stem: stemOf(name), periodStart: start, periodEnd: start };
  }
  m = WACHTER.exec(name);
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
    if (!isValidDate(y, mo, d)) return null;
    const next = new Date(Date.UTC(y, mo - 1, d) + DAY);
    return {
      agent: "localchat-wachter",
      stem: stemOf(name),
      periodStart: zonedTimeToUtc(y, mo, d, 0, 0, FILE_NAME_TIMEZONE),
      periodEnd: zonedTimeToUtc(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        0,
        0,
        FILE_NAME_TIMEZONE,
      ),
    };
  }
  m = WEEKBRIEF.exec(name);
  if (m) {
    const [y, w] = m.slice(1).map(Number) as [number, number];
    const monday = isoWeekMonday(y, w);
    if (!monday) return null;
    const after = new Date(monday.getTime() + 7 * DAY);
    const at = (d: Date) =>
      zonedTimeToUtc(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        0,
        0,
        FILE_NAME_TIMEZONE,
      );
    return {
      agent: "weekbrief",
      stem: stemOf(name),
      periodStart: at(monday),
      periodEnd: at(after),
    };
  }
  return null;
}

/**
 * Start and finish of a Markdown run. The file is written at the end of the run, so its Drive
 * `createdTime` is the finish. A name without a minute (wachter, weekbrief) takes the start from
 * `createdTime` when that falls in the named day or week, so two runs on one day sort correctly;
 * otherwise the start of the period.
 */
export function runTimes(
  file: RunFileName,
  createdTime: Date | null,
): { startedAt: Date; finishedAt: Date } {
  const exact = file.periodStart.getTime() === file.periodEnd.getTime();
  const inPeriod =
    createdTime !== null && createdTime >= file.periodStart && createdTime < file.periodEnd;
  const startedAt = exact ? file.periodStart : inPeriod ? createdTime : file.periodStart;
  const finishedAt = createdTime !== null && createdTime >= startedAt ? createdTime : startedAt;
  return { startedAt, finishedAt };
}

export type MarkdownRun = {
  status: "ok" | "warning";
  parseStatus: "ok" | "partial";
  summary: string;
  metrics: Record<string, number> | null;
  /** Agent-specific text fields, for example the wachter header lines. */
  fields: Record<string, string>;
  /** What could not be read, for the run page. Empty when `parseStatus` is ok. */
  notes: string[];
};

const MAX_SUMMARY = 500;
const truncate = (s: string, n = MAX_SUMMARY) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** Extract what is cheap and robust from a Markdown log. Never throws. */
export function extractMarkdownRun(file: RunFileName, content: string): MarkdownRun {
  const fallbackSummary = truncate(firstHeading(content) ?? `${file.stem}.md`);
  if (content.trim() === "") {
    return partial(fallbackSummary, ["The file is empty."]);
  }
  try {
    switch (file.agent) {
      case "mail-triage":
        return extractMailTriage(content, fallbackSummary);
      case "localchat-wachter":
        return extractWachter(content, fallbackSummary);
      case "weekbrief":
        return extractWeekbrief(content, fallbackSummary);
    }
  } catch (e) {
    return partial(fallbackSummary, [`Extraction failed: ${(e as Error).message}`]);
  }
}

const partial = (summary: string, notes: string[]): MarkdownRun => ({
  status: "ok",
  parseStatus: "partial",
  summary,
  metrics: null,
  fields: {},
  notes,
});

const MAIL_COUNTS = [
  ["kennis", /^\s*-\s*Kennis:\s*(\d+)/im],
  ["archief", /^\s*-\s*Archief:\s*(\d+)/im],
  ["proposed_delete", /^\s*-\s*Voorstel-verwijderen:\s*(\d+)/im],
  ["doubt", /^\s*-\s*Niets gedaan\s*\/\s*twijfel:\s*(\d+)/im],
] as const;

function extractMailTriage(content: string, fallbackSummary: string): MarkdownRun {
  const metrics: Record<string, number> = {};
  const notes: string[] = [];
  for (const [name, pattern] of MAIL_COUNTS) {
    const value = pattern.exec(content)?.[1];
    if (value === undefined) notes.push(`Count "${name}" not found.`);
    else metrics[name] = Number(value);
  }
  // "- Verwerkt: 13 threads" in later runs, "## Aantallen (7 threads ..." in the first ones.
  const processed =
    /^\s*-\s*Verwerkt:\s*(\d+)/im.exec(content)?.[1] ??
    /^#+\s*Aantallen\s*\((\d+)\s+threads/im.exec(content)?.[1];
  if (processed !== undefined) metrics.processed = Number(processed);

  // The last "Resultaat:" is the outcome of the final verification iteration.
  const results = [...content.matchAll(/Resultaat:\s*([A-Za-z]+)/g)].map((r) =>
    r[1]!.toLowerCase(),
  );
  const verification = results.at(-1);

  const parts = [
    metrics.processed !== undefined ? `${metrics.processed} threads processed.` : null,
    notes.length < MAIL_COUNTS.length
      ? MAIL_COUNTS.filter(([n]) => metrics[n] !== undefined)
          .map(([n]) => `${MAIL_LABEL[n]} ${metrics[n]}`)
          .join(", ") + "."
      : null,
    verification ? `Verification: ${verification}.` : null,
  ].filter((p): p is string => p !== null);

  return {
    status: verification === undefined || verification === "ok" ? "ok" : "warning",
    parseStatus: notes.length === 0 ? "ok" : "partial",
    summary: parts.length ? truncate(parts.join(" ")) : fallbackSummary,
    metrics: Object.keys(metrics).length ? metrics : null,
    fields: verification ? { verification } : {},
    notes,
  };
}

const MAIL_LABEL: Record<(typeof MAIL_COUNTS)[number][0], string> = {
  kennis: "Kennis",
  archief: "Archief",
  proposed_delete: "proposed for deletion",
  doubt: "doubt",
};

export const WACHTER_FIELDS = ["main_commit", "open_prs", "ci_main", "kwetsbaarheden"] as const;

function extractWachter(content: string, fallbackSummary: string): MarkdownRun {
  const fields: Record<string, string> = {};
  const notes: string[] = [];
  for (const name of WACHTER_FIELDS) {
    const value = new RegExp(`^${name}:[ \\t]*(.+?)[ \\t]*$`, "m").exec(content)?.[1];
    if (value === undefined || value === "") notes.push(`Header line "${name}" not found.`);
    else fields[name] = truncate(value, 1000);
  }
  const summary = WACHTER_FIELDS.filter((n) => fields[n] !== undefined)
    .map((n) => `${n}: ${n === "main_commit" ? fields[n]!.slice(0, 12) : fields[n]}`)
    .join(" · ");
  return {
    status: "ok",
    parseStatus: notes.length === 0 ? "ok" : "partial",
    summary: summary ? truncate(summary) : fallbackSummary,
    metrics: null,
    fields,
    notes,
  };
}

function extractWeekbrief(content: string, fallbackSummary: string): MarkdownRun {
  const heading = firstHeading(content);
  return {
    status: "ok",
    parseStatus: heading ? "ok" : "partial",
    summary: fallbackSummary,
    metrics: null,
    fields: {},
    notes: heading ? [] : ["No title heading found."],
  };
}

function firstHeading(content: string): string | null {
  return /^#\s+(.+?)\s*$/m.exec(content)?.[1] ?? null;
}

const stemOf = (name: string) => name.slice(0, -".md".length);

function isValidDate(y: number, mo: number, d: number): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Monday (as a UTC calendar date) of ISO week `week` of `year`, or null if there is no such week. */
export function isoWeekMonday(year: number, week: number): Date | null {
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  const monday = new Date(week1Monday + (week - 1) * 7 * DAY);
  // Week 53 exists only in years whose ISO year has it; its Thursday must still be in `year`.
  const thursday = new Date(monday.getTime() + 3 * DAY);
  return thursday.getUTCFullYear() === year ? monday : null;
}

/** The UTC instant of a wall-clock time in `timeZone`, DST aware. */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offsetMs(new Date(wall), timeZone);
  const corrected = wall - offsetMs(new Date(t), timeZone);
  if (corrected !== t) t = corrected;
  return new Date(t);
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
