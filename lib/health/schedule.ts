import { CronExpressionParser } from "cron-parser";

const TZ_PREFIX = /^CRON_TZ=(\S+)\s+/;

export type ParsedSchedule = { expression: string; timezone: string };

/**
 * Split an agent schedule such as `CRON_TZ=Europe/Amsterdam 48 6 * * *` into the cron expression
 * and its timezone. Without a prefix the instance default timezone applies.
 */
export function parseSchedule(schedule: string, defaultTimezone: string): ParsedSchedule {
  const trimmed = schedule.trim();
  const match = TZ_PREFIX.exec(trimmed);
  if (!match) return { expression: trimmed, timezone: defaultTimezone };
  return { expression: trimmed.slice(match[0].length), timezone: match[1]! };
}

/** Throws with a readable message when the schedule cannot be parsed. */
export function validateSchedule(schedule: string, defaultTimezone: string): void {
  const { expression, timezone } = parseSchedule(schedule, defaultTimezone);
  CronExpressionParser.parse(expression, { tz: timezone, strict: false });
}

/**
 * All slots of the schedule in the closed interval [from, to], in UTC. DST is handled by the
 * timezone: `0 7 * * *` in Europe/Amsterdam is 05:00Z in summer and 06:00Z in winter.
 */
export function expandSchedule(
  schedule: string,
  defaultTimezone: string,
  from: Date,
  to: Date,
): Date[] {
  if (to < from) return [];
  const { expression, timezone } = parseSchedule(schedule, defaultTimezone);
  const interval = CronExpressionParser.parse(expression, {
    tz: timezone,
    // currentDate is exclusive; start just before `from` so a slot exactly at `from` counts.
    currentDate: new Date(from.getTime() - 1),
    endDate: to,
  });
  const slots: Date[] = [];
  while (interval.hasNext()) slots.push(interval.next().toDate());
  return slots;
}
