import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/badges";
import { agentSlugSchema } from "@/lib/contract";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { canWithdraw } from "@/lib/feedback";
import { formatDateTime } from "@/lib/format";
import { HEALTH_WINDOW_DAYS } from "@/lib/health";
import { getAgentDetail, listRules } from "@/lib/reader/agents";
import { RuleForm, WithdrawButton } from "../../feedback-form";
import { AgentForm } from "../agent-form";

export const metadata: Metadata = { title: "Agent · readmyagent" };

type Props = { params: Promise<{ slug: string }> };

const STATUS_TEXT: Record<string, string> = {
  ok: "The latest expected run arrived and succeeded.",
  warning: "The latest expected run arrived with a warning.",
  failed: "The latest expected run failed or did not pass its own verification.",
  missing: "The latest expected run did not arrive within the grace window.",
  no_data: "No run is due yet since the agent was added.",
  invalid_schedule: "The schedule cannot be read, so missing runs are not detected.",
};

export default async function AgentPage({ params }: Props) {
  await requireOwner();
  const { slug } = await params;
  if (!agentSlugSchema.safeParse(slug).success) notFound();
  const { timezone } = getConfig();
  const db = getDb();
  const [detail, rules] = await Promise.all([
    getAgentDetail(db, slug, { now: new Date(), defaultTimezone: timezone }),
    listRules(db, slug),
  ]);
  if (!detail) notFound();
  const { agent, health, runs } = detail;

  const problems = (health?.slots ?? [])
    .filter((s) => s.status === "missing" || s.status === "failed")
    .reverse();

  return (
    <div className="py-4">
      <Link href="/agents" className="text-sm text-neutral-600 underline-offset-4 hover:underline">
        ← Agents
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          {agent.active ? (
            health && <StatusBadge status={health.status} />
          ) : (
            <StatusBadge status="inactive" />
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          <span className="font-mono">{agent.slug}</span> ·{" "}
          <span className="font-mono">{agent.schedule}</span>
        </p>
      </header>

      {health && (
        <section className="mt-4 rounded border border-neutral-200 p-3">
          <h2 className="text-sm font-semibold">Health, last {HEALTH_WINDOW_DAYS} days</h2>
          <p className="mt-1 text-sm">{health.error ?? STATUS_TEXT[health.status]}</p>
          {health.status !== "invalid_schedule" && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-700">
              <span>{health.counts.ok} ok</span>
              <span>{health.counts.warning} warning</span>
              <span>{health.counts.failed} failed</span>
              <span>{health.counts.missing} missing</span>
              {health.counts.pending > 0 && <span>{health.counts.pending} pending</span>}
              {health.unscheduledRunIds.length > 0 && (
                <span>{health.unscheduledRunIds.length} unscheduled</span>
              )}
            </p>
          )}
          {problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {problems.map((slot) => (
                <li key={slot.expectedAt.toISOString()} className="flex items-center gap-2">
                  <StatusBadge status={slot.status} />
                  <span>expected {formatDateTime(slot.expectedAt, timezone)}</span>
                </li>
              ))}
            </ul>
          )}
          {health.staleFeedbackIds.length > 0 && (
            <p className="mt-2 text-sm font-medium text-red-800">
              {health.staleFeedbackIds.length} feedback entr
              {health.staleFeedbackIds.length === 1 ? "y has" : "ies have"} not been consumed across
              two expected runs. Check that the agent prompt still reads feedback.json.
            </p>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Rules</h2>
        {rules.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">No rules yet.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="text-sm">
                <p className="break-words whitespace-pre-line">{rule.note}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={rule.status} />
                  <span className="text-neutral-600">
                    {formatDateTime(rule.createdAt, timezone)}
                  </span>
                  {canWithdraw(rule) && <WithdrawButton feedbackId={rule.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 rounded border border-neutral-200 p-3">
          <RuleForm agentSlug={agent.slug} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">No runs ingested yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-neutral-200">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="block py-2 focus-visible:outline-2 focus-visible:outline-neutral-900"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{formatDateTime(run.startedAt, timezone)}</span>
                    <StatusBadge status={run.status} />
                    <span className="text-neutral-600">
                      {run.itemCount} item{run.itemCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm break-words text-neutral-700">
                    {run.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="mt-6 rounded border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Edit agent</summary>
        <div className="mt-3">
          <AgentForm
            mode="edit"
            defaultTimezone={timezone}
            initial={{
              slug: agent.slug,
              name: agent.name,
              schedule: agent.schedule,
              graceMinutes: agent.graceMinutes,
              active: agent.active,
            }}
          />
        </div>
      </details>
    </div>
  );
}
