// Severity and state are never shown by color alone: every badge carries its label
// (docs/standards.md section 10).

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-700 text-white",
  high: "bg-red-100 text-red-900 ring-1 ring-red-300",
  medium: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  low: "bg-sky-100 text-sky-900 ring-1 ring-sky-300",
  info: "bg-neutral-100 text-neutral-800 ring-1 ring-neutral-300",
};

const STATE_CLASS: Record<string, string> = {
  open: "bg-white text-neutral-900 ring-1 ring-neutral-400",
  acknowledged: "bg-sky-50 text-sky-900 ring-1 ring-sky-300",
  done: "bg-green-50 text-green-900 ring-1 ring-green-300",
  dismissed: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  ok: "bg-green-50 text-green-900 ring-1 ring-green-300",
  partial: "bg-amber-50 text-amber-900 ring-1 ring-amber-300",
  warning: "bg-amber-50 text-amber-900 ring-1 ring-amber-300",
  failed: "bg-red-50 text-red-900 ring-1 ring-red-300",
  running: "bg-sky-50 text-sky-900 ring-1 ring-sky-300",
  pending: "bg-amber-50 text-amber-900 ring-1 ring-amber-300",
  published: "bg-sky-50 text-sky-900 ring-1 ring-sky-300",
  consumed: "bg-green-50 text-green-900 ring-1 ring-green-300",
  withdrawn: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  missing: "bg-red-50 text-red-900 ring-1 ring-red-300",
  invalid_schedule: "bg-red-50 text-red-900 ring-1 ring-red-300",
  issues: "bg-amber-50 text-amber-900 ring-1 ring-amber-300",
  no_data: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  inactive: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
};

const base = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`${base} ${SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.info}`}>{severity}</span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${base} ${STATE_CLASS[status] ?? STATE_CLASS.dismissed}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
