"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/period";
import { adminSend, input, primaryButton, secondaryButton } from "./api";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  businessId: string | null;
  businessName: string | null;
  capUsd: string;
  lastActiveAt: string | null;
}

interface Props {
  users: UserRow[];
  businesses: { id: string; name: string }[];
  isSuper: boolean;
  actorId: string;
  defaultCapUsd: string;
}

const ROLE_LABEL: Record<string, string> = {
  STAFF: "Staff",
  BUSINESS_ADMIN: "Business admin",
  SUPER_ADMIN: "Super admin",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  PENDING: "Pending approval",
  DEACTIVATED: "Deactivated",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function EditUser({
  user,
  p,
  onDone,
}: {
  user: UserRow;
  p: Props;
  onDone: (message: string | null, error?: string) => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    businessId: user.businessId ?? "",
    role: user.role,
    monthlyCapUsd: user.capUsd,
    status: user.status === "PENDING" ? "ACTIVE" : user.status,
  });
  const [saving, setSaving] = useState(false);
  const self = user.id === p.actorId;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const body: Record<string, unknown> = {
          name: form.name,
          monthlyCapUsd: form.monthlyCapUsd,
        };
        if (p.isSuper) {
          if (form.businessId) body.businessId = form.businessId;
          if (!self) body.role = form.role;
        }
        if (!self) body.status = form.status;
        const r = await adminSend(`/api/admin/users/${user.id}`, "PATCH", body);
        setSaving(false);
        onDone(r.ok ? `Saved changes for ${form.name}.` : null, r.ok ? undefined : r.error);
      }}
      className="grid gap-3 bg-neutral-50 px-3 py-3 sm:grid-cols-6"
    >
      <Field label="Name">
        <input
          className={input}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      {p.isSuper && (
        <Field label="Business">
          <select
            className={input}
            value={form.businessId}
            onChange={(e) => setForm({ ...form, businessId: e.target.value })}
          >
            <option value="">Choose…</option>
            {p.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {p.isSuper && !self && (
        <Field label="Role">
          <select
            className={input}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Monthly cap (USD)">
        <input
          className={input}
          inputMode="decimal"
          value={form.monthlyCapUsd}
          onChange={(e) => setForm({ ...form, monthlyCapUsd: e.target.value })}
        />
      </Field>
      {!self && (
        <Field label="Status">
          <select
            className={input}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="DEACTIVATED">Deactivated (can&apos;t sign in)</option>
          </select>
        </Field>
      )}
      <div className="flex items-end gap-2">
        <button type="submit" disabled={saving} className={primaryButton}>
          {user.status === "PENDING" ? "Approve" : "Save"}
        </button>
        <button type="button" onClick={() => onDone(null)} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function UsersManager(p: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    businessId: p.isSuper ? "" : (p.businesses[0]?.id ?? ""),
    role: "STAFF",
    monthlyCapUsd: p.defaultCapUsd,
  });
  const [csv, setCsv] = useState("");
  const [bulkErrors, setBulkErrors] = useState<{ line: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const done = (msg: string | null, err?: string) => {
    setError(err ?? null);
    setMessage(msg);
    if (!err) {
      setEditing(null);
      router.refresh();
    }
  };

  const pending = p.users.filter((u) => u.status === "PENDING");
  const others = p.users.filter(
    (u) => u.status !== "PENDING" && (showAll || u.status !== "DEACTIVATED"),
  );
  const deactivatedCount = p.users.filter((u) => u.status === "DEACTIVATED").length;

  const table = (rows: UserRow[], caption: string) => (
    <div className="relative overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full min-w-[840px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Business</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 text-right font-medium">Cap (USD)</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Last active</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((u) => {
            const canManage = p.isSuper || u.role === "STAFF" || u.id === p.actorId;
            return editing === u.id ? (
              <tr key={u.id}>
                <td colSpan={7} className="p-0">
                  <EditUser user={u} p={p} onDone={done} />
                </td>
              </tr>
            ) : (
              <tr key={u.id} className={u.status === "DEACTIVATED" ? "text-neutral-400" : ""}>
                <td className="px-3 py-2">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-neutral-500">{u.email}</div>
                </td>
                <td className="px-3 py-2">{u.businessName ?? "—"}</td>
                <td className="px-3 py-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                <td className="px-3 py-2 text-right tabular-nums">{u.capUsd}</td>
                <td className="px-3 py-2">{STATUS_LABEL[u.status] ?? u.status}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                  {u.lastActiveAt ? formatDateTime(new Date(u.lastActiveAt)) : "Never"}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setEditing(u.id)}
                      className={secondaryButton}
                    >
                      {u.status === "PENDING" ? "Review" : "Edit"}
                      <span className="sr-only"> {u.name}</span>
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-8">
      {(message || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {error ?? message}
        </p>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-semibold">Waiting for approval</h2>
          <p className="mb-3 text-xs text-neutral-500">
            These people signed in with a company address. Choose their business to let them start.
          </p>
          {table(pending, "Waiting for approval")}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">People</h2>
          {deactivatedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show deactivated ({deactivatedCount})
            </label>
          )}
        </div>
        {table(others, "People")}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Add a person</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await adminSend("/api/admin/users", "POST", form);
            setBusy(false);
            if (r.ok) {
              done(`Added ${form.name}. They can sign in now with ${form.email}.`);
              setForm({ ...form, name: "", email: "" });
            } else done(null, r.error);
          }}
          className="grid gap-3 sm:grid-cols-6"
        >
          <Field label="Name">
            <input
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Email">
              <input
                className={`${input} w-full`}
                type="email"
                placeholder="name@mvdugar.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
          </div>
          {p.isSuper && (
            <Field label="Business">
              <select
                className={input}
                value={form.businessId}
                onChange={(e) => setForm({ ...form, businessId: e.target.value })}
                required
              >
                <option value="">Choose…</option>
                {p.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {p.isSuper && (
            <Field label="Role">
              <select
                className={input}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Monthly cap (USD)">
            <input
              className={input}
              inputMode="decimal"
              value={form.monthlyCapUsd}
              onChange={(e) => setForm({ ...form, monthlyCapUsd: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className={primaryButton}>
              Add person
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-1 text-base font-semibold">Add many people</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Paste one person per line: <code>name, email, business, cap</code>. The cap is optional
          (default USD {p.defaultCapUsd})
          {p.isSuper ? "." : "; leave the business empty to use yours."} You can paste straight from
          Excel. If any line has a problem, nobody is added and the problems are listed.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setBulkErrors([]);
            const r = await adminSend<{
              created: number;
              errors: { line: number; message: string }[];
            }>("/api/admin/users/bulk", "POST", { csv });
            setBusy(false);
            if (r.ok) {
              done(`Added ${r.data.created} ${r.data.created === 1 ? "person" : "people"}.`);
              setCsv("");
            } else {
              setBulkErrors(r.data?.errors ?? []);
              done(
                null,
                r.data?.errors?.length ? "Nobody was added. Please fix the lines below." : r.error,
              );
            }
          }}
          className="space-y-3"
        >
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            aria-label="People to add, one per line"
            placeholder={`Ram Thapa, ram.thapa@mvdugar.com, ${p.businesses[0]?.name ?? "Mahindra"}, 10`}
            className={`${input} w-full font-mono`}
          />
          {bulkErrors.length > 0 && (
            <ul className="space-y-1 text-sm text-red-800">
              {bulkErrors.map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  {e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message}
                </li>
              ))}
            </ul>
          )}
          <button type="submit" disabled={busy || !csv.trim()} className={primaryButton}>
            Add everyone
          </button>
        </form>
      </section>
    </div>
  );
}
