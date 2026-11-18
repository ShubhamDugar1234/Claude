import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { MODEL_IDS, MODELS } from "@/config/models";
import { requireAdminPage } from "@/lib/admin/guard";
import { listBusinesses } from "@/lib/admin/businesses";
import { isSuper } from "@/lib/admin/scope";
import { BusinessesManager } from "@/components/admin/businesses-manager";

export default async function AdminBusinessesPage() {
  const { scope } = await requireAdminPage();
  if (!isSuper(scope)) redirect("/admin");
  const businesses = await listBusinesses(db, scope);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Businesses</h1>
        <p className="text-sm text-neutral-500">
          Each business can use its own Anthropic key (with a hard spending limit set in the
          Anthropic Console) as a backstop.
        </p>
      </div>
      <BusinessesManager
        businesses={businesses}
        models={MODEL_IDS.map((m) => ({ id: m, label: MODELS[m].label }))}
      />
    </div>
  );
}
