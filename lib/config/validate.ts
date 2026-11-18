// Validates the instance configuration from environment variables (ADR-0007, SECURITY.md
// "Secret handling"). Pure: takes the environment as an argument and never returns or logs a value
// in a report, only names, statuses and hints.

export type SettingStatus = "ok" | "missing" | "invalid" | "not_used";

export type SettingReport = {
  name: string;
  status: SettingStatus;
  /** Why a setting is missing or invalid. Never contains the value. */
  hint?: string;
};

export type DriveCredentials =
  | {
      kind: "workload_identity";
      projectNumber: string;
      serviceAccountEmail: string;
      poolId: string;
      providerId: string;
    }
  | { kind: "service_account_key"; clientEmail: string; privateKey: string };

export type AppConfig = {
  environment: "production" | "preview" | "development";
  databaseUrl: string;
  auth: { secret: string; googleClientId: string; googleClientSecret: string };
  ownerEmail: string;
  timezone: string;
  /** Required in production. Elsewhere the cron endpoint is disabled when it is not set. */
  cronSecret: string | null;
  /** Required in production. Elsewhere sync is disabled when Drive is not configured. */
  drive: { folderId: string; feedbackFileId: string; credentials: DriveCredentials } | null;
};

export type ConfigResult =
  { ok: true; config: AppConfig; report: SettingReport[] } | { ok: false; report: SettingReport[] };

type Env = Record<string, string | undefined>;

const GCP_VARS = [
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function decodeServiceAccountKey(
  value: string,
): { clientEmail: string; privateKey: string } | null {
  try {
    const json = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof json.client_email === "string" && typeof json.private_key === "string") {
      return { clientEmail: json.client_email, privateKey: json.private_key };
    }
  } catch {
    // Reported as invalid below; the content is never echoed.
  }
  return null;
}

export function validateConfig(env: Env): ConfigResult {
  const report: SettingReport[] = [];
  const read = (name: string) => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  const add = (name: string, status: SettingStatus, hint?: string) =>
    report.push(hint ? { name, status, hint } : { name, status });

  const environment =
    env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview"
      ? env.VERCEL_ENV
      : "development";
  const production = environment === "production";

  /** Check a required setting; returns the value when valid. */
  const required = (name: string, check?: (v: string) => string | null): string | undefined => {
    const value = read(name);
    if (!value) {
      add(name, "missing");
      return undefined;
    }
    const problem = check?.(value) ?? null;
    if (problem) {
      add(name, "invalid", problem);
      return undefined;
    }
    add(name, "ok");
    return value;
  };

  const databaseUrl = required("DATABASE_URL", (v) =>
    /^postgres(ql)?:\/\//.test(v) ? null : "Expected a postgres:// or postgresql:// URL.",
  );
  const authSecret = required("AUTH_SECRET", (v) =>
    v.length >= 32 ? null : "Use at least 32 characters, for example `openssl rand -base64 32`.",
  );
  const googleClientId = required("AUTH_GOOGLE_ID");
  const googleClientSecret = required("AUTH_GOOGLE_SECRET");
  const ownerEmail = required("OWNER_EMAIL", (v) =>
    EMAIL.test(v) ? null : "Expected one email address.",
  );
  const timezone = required("APP_TIMEZONE", (v) =>
    isValidTimezone(v) ? null : "Expected an IANA timezone such as Europe/Amsterdam.",
  );

  // Cron secret: required in production, optional elsewhere.
  let cronSecret: string | null = null;
  const cronValue = read("CRON_SECRET");
  if (!cronValue) {
    add(
      "CRON_SECRET",
      production ? "missing" : "not_used",
      production ? undefined : "Cron disabled.",
    );
  } else if (cronValue.length < 16) {
    add("CRON_SECRET", "invalid", "Use at least 16 random characters.");
  } else {
    add("CRON_SECRET", "ok");
    cronSecret = cronValue;
  }

  // Drive: all or nothing. Required in production; previews and development may run without it
  // (operations 1.3: only production is granted access to the real folder).
  const driveNames = ["DRIVE_FOLDER_ID", "DRIVE_FEEDBACK_FILE_ID", ...GCP_VARS, "GOOGLE_SA_KEY"];
  const driveConfigured = driveNames.some((n) => read(n));
  let drive: AppConfig["drive"] = null;
  let driveOk = true;

  if (!driveConfigured && !production) {
    for (const name of driveNames) add(name, "not_used", "Drive not configured; sync disabled.");
  } else {
    const folderId = required("DRIVE_FOLDER_ID");
    const feedbackFileId = required("DRIVE_FEEDBACK_FILE_ID");

    const gcpSet = GCP_VARS.filter((n) => read(n));
    const keyValue = read("GOOGLE_SA_KEY");
    let credentials: DriveCredentials | null = null;

    if (gcpSet.length > 0) {
      // Workload Identity Federation is preferred (ADR-0008); all four values are needed.
      // The values end up in Google URLs (lib/drive/credentials.ts), so their shape is checked.
      const checks: Record<(typeof GCP_VARS)[number], RegExp> = {
        GCP_PROJECT_NUMBER: /^\d+$/,
        GCP_SERVICE_ACCOUNT_EMAIL: /^[a-z][a-z0-9-]*@[a-z][a-z0-9-]*\.iam\.gserviceaccount\.com$/,
        GCP_WORKLOAD_IDENTITY_POOL_ID: /^[a-z0-9-]+$/,
        GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: /^[a-z0-9-]+$/,
      };
      const values = GCP_VARS.map((n) =>
        required(n, (v) => (checks[n].test(v) ? null : "Unexpected format.")),
      );
      if (values.every(Boolean)) {
        const [projectNumber, serviceAccountEmail, poolId, providerId] = values as string[];
        credentials = {
          kind: "workload_identity",
          projectNumber: projectNumber!,
          serviceAccountEmail: serviceAccountEmail!,
          poolId: poolId!,
          providerId: providerId!,
        };
      }
      add(
        "GOOGLE_SA_KEY",
        "not_used",
        keyValue ? "Ignored: Workload Identity Federation is set." : undefined,
      );
    } else if (keyValue) {
      for (const name of GCP_VARS) add(name, "not_used", "Using the service account key fallback.");
      const key = decodeServiceAccountKey(keyValue);
      if (key) {
        add("GOOGLE_SA_KEY", "ok");
        credentials = { kind: "service_account_key", ...key };
      } else {
        add("GOOGLE_SA_KEY", "invalid", "Expected a base64-encoded service account JSON key.");
      }
    } else {
      for (const name of GCP_VARS) add(name, "missing", "Needed for Drive access (ADR-0008).");
      add("GOOGLE_SA_KEY", "not_used");
    }

    if (folderId && feedbackFileId && credentials) {
      drive = { folderId, feedbackFileId, credentials };
    } else {
      driveOk = false;
    }
  }

  const failed = report.some((r) => r.status === "missing" || r.status === "invalid");
  if (
    failed ||
    !driveOk ||
    !databaseUrl ||
    !authSecret ||
    !googleClientId ||
    !googleClientSecret ||
    !ownerEmail ||
    !timezone
  ) {
    return { ok: false, report };
  }

  return {
    ok: true,
    report,
    config: {
      environment,
      databaseUrl,
      auth: { secret: authSecret, googleClientId, googleClientSecret },
      ownerEmail: ownerEmail.toLowerCase(),
      timezone,
      cronSecret,
      drive,
    },
  };
}
