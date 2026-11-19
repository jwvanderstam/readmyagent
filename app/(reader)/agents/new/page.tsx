import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { AgentForm } from "../agent-form";

export const metadata: Metadata = { title: "Add agent · readmyagent" };

export default async function NewAgentPage() {
  await requireOwner();
  return (
    <div className="py-4">
      <Link href="/agents" className="text-sm text-neutral-600 underline-offset-4 hover:underline">
        ← Agents
      </Link>
      <h1 className="mt-3 mb-4 text-xl font-semibold">Add agent</h1>
      <AgentForm
        mode="create"
        defaultTimezone={getConfig().timezone}
        initial={{ slug: "", name: "", schedule: "", graceMinutes: 180, active: true }}
      />
    </div>
  );
}
