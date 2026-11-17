import { describe, expect, it } from "vitest";
import { validateConfig } from "@/lib/config/validate";

const SECRET_MARKER = "do-not-leak";

const base = {
  DATABASE_URL: `postgresql://user:${SECRET_MARKER}@db.example.com/app`,
  AUTH_SECRET: `${SECRET_MARKER}-0123456789abcdef0123456789`,
  AUTH_GOOGLE_ID: "client-id.apps.example.com",
  AUTH_GOOGLE_SECRET: `${SECRET_MARKER}-google`,
  OWNER_EMAIL: "Owner@Example.com",
  APP_TIMEZONE: "Europe/Amsterdam",
};

const wif = {
  DRIVE_FOLDER_ID: "folder-id",
  DRIVE_FEEDBACK_FILE_ID: "feedback-file-id",
  GCP_PROJECT_NUMBER: "123456789012",
  GCP_SERVICE_ACCOUNT_EMAIL: "readmyagent-drive@project.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
};

const production = { VERCEL_ENV: "production", CRON_SECRET: `${SECRET_MARKER}-cron-secret` };

const statusOf = (result: ReturnType<typeof validateConfig>, name: string) =>
  result.report.find((r) => r.name === name)?.status;

describe("validateConfig", () => {
  it("accepts a complete production configuration with Workload Identity Federation", () => {
    const result = validateConfig({ ...base, ...wif, ...production });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      environment: "production",
      ownerEmail: "owner@example.com",
      timezone: "Europe/Amsterdam",
      drive: {
        folderId: "folder-id",
        credentials: { kind: "workload_identity", poolId: "vercel" },
      },
    });
  });

  it("never puts a value into the report", () => {
    const valid = validateConfig({ ...base, ...wif, ...production });
    const invalid = validateConfig({
      ...base,
      AUTH_SECRET: SECRET_MARKER,
      GOOGLE_SA_KEY: Buffer.from(`{"secret":"${SECRET_MARKER}"}`).toString("base64"),
      DRIVE_FOLDER_ID: "x",
      DRIVE_FEEDBACK_FILE_ID: "y",
    });
    expect(JSON.stringify(valid.report)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(invalid.report)).not.toContain(SECRET_MARKER);
  });

  it("fails closed when a required setting is missing", () => {
    const { OWNER_EMAIL: _omit, ...rest } = base;
    const result = validateConfig({ ...rest, ...wif, ...production });
    expect(result.ok).toBe(false);
    expect(statusOf(result, "OWNER_EMAIL")).toBe("missing");
  });

  it("treats blank values as missing", () => {
    const result = validateConfig({ ...base, ...wif, ...production, OWNER_EMAIL: "   " });
    expect(statusOf(result, "OWNER_EMAIL")).toBe("missing");
  });

  it.each([
    ["DATABASE_URL", "mysql://localhost/db"],
    ["AUTH_SECRET", "too-short"],
    ["OWNER_EMAIL", "a@b.com, c@d.com"],
    ["APP_TIMEZONE", "Mars/Olympus"],
    ["CRON_SECRET", "short"],
  ])("rejects an invalid %s", (name, value) => {
    const result = validateConfig({ ...base, ...wif, ...production, [name]: value });
    expect(result.ok).toBe(false);
    expect(statusOf(result, name)).toBe("invalid");
  });

  it("requires Drive and the cron secret in production", () => {
    const result = validateConfig({ ...base, VERCEL_ENV: "production" });
    expect(result.ok).toBe(false);
    expect(statusOf(result, "CRON_SECRET")).toBe("missing");
    expect(statusOf(result, "DRIVE_FOLDER_ID")).toBe("missing");
    expect(statusOf(result, "GCP_PROJECT_NUMBER")).toBe("missing");
  });

  it("runs a preview without Drive and without cron", () => {
    const result = validateConfig({ ...base, VERCEL_ENV: "preview" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({ environment: "preview", drive: null, cronSecret: null });
    expect(statusOf(result, "DRIVE_FOLDER_ID")).toBe("not_used");
  });

  it("rejects a partial Drive configuration outside production too", () => {
    const result = validateConfig({ ...base, DRIVE_FOLDER_ID: "folder-id" });
    expect(result.ok).toBe(false);
    expect(statusOf(result, "DRIVE_FEEDBACK_FILE_ID")).toBe("missing");
  });

  it("needs all four Workload Identity values", () => {
    const { GCP_WORKLOAD_IDENTITY_POOL_ID: _omit, ...partial } = wif;
    const result = validateConfig({ ...base, ...partial, ...production });
    expect(result.ok).toBe(false);
    expect(statusOf(result, "GCP_WORKLOAD_IDENTITY_POOL_ID")).toBe("missing");
  });

  it("accepts the service account key fallback and prefers federation when both are set", () => {
    const key = Buffer.from(
      JSON.stringify({
        client_email: "sa@example.com",
        private_key: "-----BEGIN PRIVATE KEY-----",
      }),
    ).toString("base64");
    const drive = { DRIVE_FOLDER_ID: "f", DRIVE_FEEDBACK_FILE_ID: "g" };

    const fallback = validateConfig({ ...base, ...drive, ...production, GOOGLE_SA_KEY: key });
    expect(fallback.ok && fallback.config.drive?.credentials.kind).toBe("service_account_key");

    const both = validateConfig({ ...base, ...wif, ...production, GOOGLE_SA_KEY: key });
    expect(both.ok && both.config.drive?.credentials.kind).toBe("workload_identity");
    expect(statusOf(both, "GOOGLE_SA_KEY")).toBe("not_used");
  });

  it("rejects a malformed service account key", () => {
    const result = validateConfig({
      ...base,
      DRIVE_FOLDER_ID: "f",
      DRIVE_FEEDBACK_FILE_ID: "g",
      GOOGLE_SA_KEY: "not-base64-json",
    });
    expect(result.ok).toBe(false);
    expect(statusOf(result, "GOOGLE_SA_KEY")).toBe("invalid");
  });
});
