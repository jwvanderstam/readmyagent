"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { resolveIngestError } from "@/lib/ingest";

// Server Actions check the owner themselves (docs/standards.md section 4).

export async function resolveIngestErrorAction(formData: FormData): Promise<void> {
  await requireOwner();
  // An unknown ID means it is gone already; the page then shows the current list.
  await resolveIngestError(getDb(), formData.get("errorId"));
  revalidatePath("/", "layout");
}
