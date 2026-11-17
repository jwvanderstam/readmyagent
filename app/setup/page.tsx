import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { configReport, type SettingStatus } from "@/lib/config";

export const metadata: Metadata = { title: "Setup · readmyagent" };

const LABEL: Record<SettingStatus, string> = {
  ok: "Configured",
  missing: "Missing",
  invalid: "Invalid",
  not_used: "Not used",
};

// Status is never shown by color alone (docs/standards.md, section 10).
const STYLE: Record<SettingStatus, string> = {
  ok: "bg-green-100 text-green-900",
  missing: "bg-red-100 text-red-900",
  invalid: "bg-red-100 text-red-900",
  not_used: "bg-neutral-100 text-neutral-700",
};

/**
 * Shown instead of every page while the instance is not fully configured (ADR-0007). Lists
 * setting names and statuses only, never values.
 */
export default function SetupPage() {
  const result = configReport();
  if (result.ok) redirect("/");

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Finish setting up readmyagent</h1>
      <p className="mt-2 text-neutral-700">
        This instance is missing settings or has invalid ones. Until they are fixed, the app shows
        only this page. Set the values as environment variables in your Vercel project, for the
        right environment, and redeploy. The setup guide is in <code>docs/operations.md</code>.
      </p>

      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-300">
            <th scope="col" className="py-2 pr-2 font-medium">
              Setting
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {result.report.map((setting) => (
            <tr key={setting.name} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2">
                <code className="break-all">{setting.name}</code>
                {setting.hint && <p className="mt-1 text-neutral-600">{setting.hint}</p>}
              </td>
              <td className="py-2 pr-2">
                <span className={`inline-block rounded px-2 py-0.5 ${STYLE[setting.status]}`}>
                  {LABEL[setting.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
