import { db } from "@/lib/db";
import { getLimits } from "@/config/limits";
import { requireAdminPage } from "@/lib/admin/guard";
import { listBusinesses } from "@/lib/admin/businesses";
import { isSuper } from "@/lib/admin/scope";
import { listUsers } from "@/lib/admin/users";
import { UsersManager } from "@/components/admin/users-manager";

export default async function AdminUsersPage() {
  const { scope } = await requireAdminPage();
  const [users, businesses] = await Promise.all([listUsers(db, scope), listBusinesses(db, scope)]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Users</h1>
      <UsersManager
        users={users}
        businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        isSuper={isSuper(scope)}
        actorId={scope.actorId}
        defaultCapUsd={getLimits().defaultUserCapUsd}
      />
    </div>
  );
}
