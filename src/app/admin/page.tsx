import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/admin/guard";
import { getOverview } from "@/lib/admin/overview";
import { isSuper } from "@/lib/admin/scope";
import { formatResetDate } from "@/lib/period";
import { UsageDashboard } from "@/components/admin/usage-dashboard";

export default async function AdminUsagePage() {
  const { scope } = await requireAdminPage();
  const data = await getOverview(db, scope);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Usage &amp; limits</h1>
        <p className="text-sm text-neutral-500">
          This month so far. Allowances and budgets reset on{" "}
          {formatResetDate(new Date(data.cards.periodEnd))}. Changes apply to the very next message.
        </p>
      </div>
      <UsageDashboard {...data} isSuper={isSuper(scope)} actorId={scope.actorId} />
    </div>
  );
}
