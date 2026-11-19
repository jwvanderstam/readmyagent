import "server-only";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { createDriveClient } from "@/lib/drive";
import { createAuthClient } from "@/lib/drive/credentials";
import { publishFeedback } from "@/lib/feedback";
import { log } from "@/lib/log";
import { runSync, type SyncDeps, syncIfStale, type SyncTrigger } from "./run-sync";

/** Drive-backed sync dependencies, or null when Drive is not configured (previews, dev). */
export function getSyncDeps(): SyncDeps | null {
  const { drive } = getConfig();
  if (!drive) return null;
  const authClient = createAuthClient(drive.credentials);
  const client = createDriveClient({
    folderId: drive.folderId,
    feedbackFileId: drive.feedbackFileId,
    getHeaders: () => authClient.getRequestHeaders(),
  });
  return { source: client, feedbackWriter: client };
}

export async function syncNow(trigger: Exclude<SyncTrigger, "on_open">) {
  const deps = getSyncDeps();
  if (!deps) return { status: "disabled" as const };
  return runSync(getDb(), deps, { trigger });
}

export async function syncOnOpen() {
  const deps = getSyncDeps();
  if (!deps) return { status: "disabled" as const };
  return syncIfStale(getDb(), deps);
}

/**
 * Publish feedback.json right after the owner changes feedback, so agents see it on their next run
 * without waiting for a sync. A failure leaves rows pending; the next sync publishes them.
 */
export async function publishFeedbackNow(): Promise<void> {
  const deps = getSyncDeps();
  if (!deps) return;
  try {
    await publishFeedback(getDb(), deps.feedbackWriter);
  } catch (e) {
    log("error", "feedback.publish_failed", (e as Error).message, { trigger: "feedback_change" });
  }
}
