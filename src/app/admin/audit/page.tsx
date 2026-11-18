import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/admin/guard";
import { listAudit } from "@/lib/admin/audit";
import { formatDateTime } from "@/lib/period";

const ACTION_LABEL: Record<string, string> = {
  "user.created": "Added user",
  "user.updated": "Changed user",
  "user.cap_changed": "Changed cap",
  "user.paused": "Paused user",
  "user.unpaused": "Unpaused user",
  "user.deactivated": "Deactivated user",
  "user.reactivated": "Reactivated user",
  "user.approved": "Approved user",
  "business.created": "Added business",
  "business.updated": "Changed business",
  "business.budget_changed": "Changed budget",
};

function describe(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join("; ");
}

export default async function AdminAuditPage() {
  const { scope } = await requireAdminPage();
  const entries = await listAudit(db, scope);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-sm text-neutral-500">
          Every change made by an admin, newest first (last 200).
        </p>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Who</th>
              <th className="px-3 py-2 font-medium">What</th>
              <th className="px-3 py-2 font-medium">For</th>
              <th className="px-3 py-2 font-medium">Before</th>
              <th className="px-3 py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                  {formatDateTime(new Date(e.createdAt))}
                </td>
                <td className="px-3 py-2">{e.actorName}</td>
                <td className="px-3 py-2">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="px-3 py-2">{e.targetName}</td>
                <td className="px-3 py-2 text-neutral-600">{describe(e.before)}</td>
                <td className="px-3 py-2">{describe(e.after)}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
