import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractMarkdownRun,
  isoWeekMonday,
  parseRunFileName,
  type RunFileName,
  runTimes,
  zonedTimeToUtc,
} from "@/lib/ingest/markdown";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "markdown", name), "utf8");

const parsed = (name: string): RunFileName => {
  const result = parseRunFileName(name);
  if (!result) throw new Error(`${name} did not parse`);
  return result;
};

describe("parseRunFileName", () => {
  it("reads a mail-triage name as an exact Europe/Amsterdam time (winter, UTC+1)", () => {
    expect(parseRunFileName("mail-triage-run-2026-11-28-0648.md")).toEqual({
      agent: "mail-triage",
      stem: "mail-triage-run-2026-11-28-0648",
      periodStart: new Date("2026-11-28T05:48:00Z"),
      periodEnd: new Date("2026-11-28T05:48:00Z"),
    });
  });

  it("applies summer time (UTC+2)", () => {
    expect(parsed("mail-triage-run-2026-07-01-0648.md").periodStart).toEqual(
      new Date("2026-07-01T04:48:00Z"),
    );
  });

  it("reads a wachter name as the local day", () => {
    expect(parseRunFileName("localchat-wachter-run-2026-11-27.md")).toEqual({
      agent: "localchat-wachter",
      stem: "localchat-wachter-run-2026-11-27",
      periodStart: new Date("2026-11-26T23:00:00Z"),
      periodEnd: new Date("2026-11-27T23:00:00Z"),
    });
  });

  it("reads a weekbrief name as the local ISO week, Monday to Monday", () => {
    expect(parseRunFileName("weekbrief-run-2026-w47.md")).toEqual({
      agent: "weekbrief",
      stem: "weekbrief-run-2026-w47",
      periodStart: new Date("2026-11-15T23:00:00Z"),
      periodEnd: new Date("2026-11-22T23:00:00Z"),
    });
  });

  it.each([
    "mail-triage-state.md",
    "mail-triage-log.md",
    "weekbrief-log.md",
    "localchat-wachter-log.md",
    "feedback.json",
    "mail-triage-run-2026-11-28-0648.json",
    "mail-triage-run-2026-11-28.md",
    "mail-triage-run-2026-02-30-0648.md",
    "mail-triage-run-2026-11-28-2460.md",
    "localchat-wachter-run-2026-13-01.md",
    "weekbrief-run-2026-w00.md",
    "weekbrief-run-2026-w54.md",
    "other-agent-run-2026-11-28-0648.md",
    "copy of mail-triage-run-2026-11-28-0648.md",
  ])("ignores %s", (name) => {
    expect(parseRunFileName(name)).toBeNull();
  });
});

describe("isoWeekMonday", () => {
  it("handles weeks that start in the previous year", () => {
    expect(isoWeekMonday(2026, 1)).toEqual(new Date("2025-12-29T00:00:00Z"));
  });
  it("accepts week 53 only in years that have it", () => {
    expect(isoWeekMonday(2026, 53)).toEqual(new Date("2026-12-28T00:00:00Z"));
    expect(isoWeekMonday(2027, 53)).toBeNull();
  });
});

describe("zonedTimeToUtc", () => {
  it("handles the day of the switch to summer time", () => {
    expect(zonedTimeToUtc(2026, 3, 29, 6, 48, "Europe/Amsterdam")).toEqual(
      new Date("2026-03-29T04:48:00Z"),
    );
  });
});

describe("runTimes", () => {
  it("takes the start from the name and the finish from createdTime for mail-triage", () => {
    const times = runTimes(
      parsed("mail-triage-run-2026-11-28-0648.md"),
      new Date("2026-11-28T05:49:08Z"),
    );
    expect(times).toEqual({
      startedAt: new Date("2026-11-28T05:48:00Z"),
      finishedAt: new Date("2026-11-28T05:49:08Z"),
    });
  });

  it("orders two wachter runs on one day by createdTime", () => {
    const name = parsed("localchat-wachter-run-2026-11-27.md");
    const morning = runTimes(name, new Date("2026-11-27T06:51:41Z"));
    const evening = runTimes(name, new Date("2026-11-27T17:01:16Z"));
    expect(morning.startedAt).toEqual(new Date("2026-11-27T06:51:41Z"));
    expect(evening.startedAt.getTime()).toBeGreaterThan(morning.startedAt.getTime());
  });

  it("falls back to the start of the period when createdTime is outside it or missing", () => {
    const name = parsed("weekbrief-run-2026-w47.md");
    expect(runTimes(name, new Date("2026-12-01T10:00:00Z")).startedAt).toEqual(name.periodStart);
    expect(runTimes(name, null)).toEqual({
      startedAt: name.periodStart,
      finishedAt: name.periodStart,
    });
  });
});

describe("extractMarkdownRun", () => {
  it("extracts mail-triage counts as metrics", () => {
    const run = extractMarkdownRun(
      parsed("mail-triage-run-2026-11-28-0648.md"),
      fixture("mail-triage-run-2026-11-28-0648.md"),
    );
    expect(run).toEqual({
      status: "ok",
      parseStatus: "ok",
      summary:
        "13 threads processed. Kennis 0, Archief 0, proposed for deletion 2, doubt 11. Verification: ok.",
      metrics: { kennis: 0, archief: 0, proposed_delete: 2, doubt: 11, processed: 13 },
      fields: { verification: "ok" },
      notes: [],
    });
  });

  it("reads the processed count from the heading of the first runs", () => {
    const run = extractMarkdownRun(
      parsed("mail-triage-run-2026-11-17-0648.md"),
      fixture("mail-triage-run-2026-11-17-0648.md"),
    );
    expect(run.parseStatus).toBe("ok");
    expect(run.metrics).toEqual({
      kennis: 2,
      archief: 2,
      proposed_delete: 2,
      doubt: 1,
      processed: 7,
    });
  });

  it("marks missing counts partial and a failed verification as a warning", () => {
    const run = extractMarkdownRun(
      parsed("mail-triage-run-2026-11-19-0648.md"),
      fixture("mail-triage-run-2026-11-19-0648.md"),
    );
    expect(run.parseStatus).toBe("partial");
    expect(run.status).toBe("warning");
    expect(run.metrics).toEqual({ kennis: 1, proposed_delete: 3 });
    expect(run.notes).toEqual(['Count "archief" not found.', 'Count "doubt" not found.']);
  });

  it("extracts the four wachter header lines", () => {
    const run = extractMarkdownRun(
      parsed("localchat-wachter-run-2026-11-28.md"),
      fixture("localchat-wachter-run-2026-11-28.md"),
    );
    expect(run.parseStatus).toBe("ok");
    expect(run.fields).toEqual({
      main_commit: "5ae1be0a152d15ee17f7a9bcf247937569fc053e",
      open_prs: "niet beschikbaar (pagina verouderd); #101 bevestigd Closed",
      ci_main: "niet beschikbaar (badges: HTTP 403 via proxy)",
      kwetsbaarheden: "geen (pip-audit op requirements.txt; torch niet auditeerbaar)",
    });
    expect(run.summary).toMatch(/^main_commit: 5ae1be0a152d · open_prs: /);
  });

  it("keeps a wachter run with missing header lines as partial", () => {
    const run = extractMarkdownRun(
      parsed("localchat-wachter-run-2026-11-20.md"),
      fixture("localchat-wachter-run-2026-11-20.md"),
    );
    expect(run.parseStatus).toBe("partial");
    expect(run.fields).toEqual({ main_commit: "7ebcf50", ci_main: "rood (Mutation)" });
    expect(run.notes).toHaveLength(2);
  });

  it("uses the weekbrief title as summary", () => {
    const run = extractMarkdownRun(
      parsed("weekbrief-run-2026-w48.md"),
      fixture("weekbrief-run-2026-w48.md"),
    );
    expect(run).toMatchObject({
      parseStatus: "ok",
      summary: "Weekbrief 2026-w48 (geplande run vr 2026-11-27 12:50, Europe/Amsterdam)",
    });
  });

  it.each(["", "   \n", "no headings and no fields at all"])(
    "never throws and returns partial for %j",
    (content) => {
      const run = extractMarkdownRun(parsed("localchat-wachter-run-2026-11-28.md"), content);
      expect(run.parseStatus).toBe("partial");
      expect(run.summary.length).toBeGreaterThan(0);
    },
  );

  it("reads CRLF files", () => {
    const run = extractMarkdownRun(
      parsed("localchat-wachter-run-2026-11-28.md"),
      fixture("localchat-wachter-run-2026-11-28.md").replaceAll("\n", "\r\n"),
    );
    expect(run.parseStatus).toBe("ok");
    expect(run.fields.main_commit).toBe("5ae1be0a152d15ee17f7a9bcf247937569fc053e");
  });
});
