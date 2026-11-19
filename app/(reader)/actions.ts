"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { setItemState } from "@/lib/items/state";
import { syncNow } from "@/lib/sync/server";

// Server Actions check the owner themselves, like route handlers (docs/standards.md section 4).

export type SyncActionState = { ok: boolean; message: string } | null;

export async function syncAction(_prev: SyncActionState): Promise<SyncActionState> {
  await requireOwner();
  const result = await syncNow("manual");
  revalidatePath("/", "layout");
  switch (result.status) {
    case "disabled":
      return { ok: false, message: "Drive is not configured for this environment." };
    case "busy":
      return { ok: false, message: "A sync is already running." };
    case "failed":
      return { ok: false, message: "Sync failed. Details are in the sync log." };
    default: {
      const runs = `${result.runsIngested} new run${result.runsIngested === 1 ? "" : "s"}`;
      const errors = result.errors ? `, ${result.errors} file(s) could not be read` : "";
      return { ok: result.status === "ok", message: `Synced: ${runs}${errors}.` };
    }
  }
}

export async function setItemStateAction(formData: FormData): Promise<void> {
  await requireOwner();
  await setItemState(getDb(), {
    itemId: formData.get("itemId"),
    state: formData.get("state"),
  });
  revalidatePath("/", "layout");
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}
