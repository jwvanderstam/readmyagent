"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AgentError, type AgentFieldErrors, createAgent, updateAgent } from "@/lib/agents/manage";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";

export type AgentFormState = {
  message: string | null;
  errors: AgentFieldErrors;
  values: Record<string, string>;
} | null;

function read(formData: FormData) {
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  return {
    values: {
      slug: text("slug"),
      name: text("name"),
      schedule: text("schedule"),
      graceMinutes: text("graceMinutes"),
      active: formData.get("active") === "on" ? "on" : "",
    },
    input: {
      slug: text("slug").trim(),
      name: text("name"),
      schedule: text("schedule"),
      graceMinutes: text("graceMinutes"),
      active: formData.get("active") === "on",
    },
  };
}

function failure(e: unknown, values: Record<string, string>): AgentFormState {
  if (e instanceof AgentError) return { message: e.message, errors: e.fields, values };
  throw e;
}

export async function createAgentAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  await requireOwner();
  const { values, input } = read(formData);
  let slug: string;
  try {
    slug = (await createAgent(getDb(), input, { defaultTimezone: getConfig().timezone })).slug;
  } catch (e) {
    return failure(e, values);
  }
  revalidatePath("/", "layout");
  redirect(`/agents/${slug}`);
}

export async function updateAgentAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  await requireOwner();
  const { values, input } = read(formData);
  try {
    await updateAgent(getDb(), input.slug, input, { defaultTimezone: getConfig().timezone });
  } catch (e) {
    return failure(e, values);
  }
  revalidatePath("/", "layout");
  return { message: "Saved.", errors: {}, values };
}
