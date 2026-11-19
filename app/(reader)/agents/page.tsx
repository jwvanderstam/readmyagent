import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatRelative } from "@/lib/format";
import { listAgents } from "@/lib/reader/agents";

export const metadata: Metadata = { title: "Agents · readmyagent" };

export default async function AgentsPage() {
  await requireOwner();
  const { timezone } = getConfig();
  const now = new Date();
  const rows = await listAgents(getDb(), { now, defaultTimezone: timezone });

  return (
    <>
      <div className="flex items-center justify-between py-2">
        <h1 className="text-xl font-semibold">Agents</h1>
        <Link
          href="/agents/new"
          className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Add agent
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-neutral-600">
          No agents yet. Add one for every scheduled task that writes run files to Drive.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {rows.map((agent) => (
            <li key={agent.slug}>
              <Link
                href={`/agents/${agent.slug}`}
                className="block py-3 focus-visible:outline-2 focus-visible:outline-neutral-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  {agent.active ? (
                    agent.health && <StatusBadge status={agent.health.status} />
                  ) : (
                    <StatusBadge status="inactive" />
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-neutral-600">
                  <span className="font-mono">{agent.slug}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {agent.lastRunAt
                      ? `last run ${formatRelative(agent.lastRunAt, now, timezone)}`
                      : "no runs yet"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
