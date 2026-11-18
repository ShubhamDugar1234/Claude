"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessRow, OverviewCards, PersonRow, RequestRow } from "@/lib/admin/overview";
import { formatDateTime } from "@/lib/period";
import { adminSend, input, secondaryButton } from "./api";

interface Props {
  cards: OverviewCards;
  businesses: BusinessRow[];
  people: PersonRow[];
  recent: RequestRow[];
  isSuper: boolean;
  actorId: string;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");
const barColor = (p: number) =>
  p >= 100 ? "bg-red-600" : p >= 80 ? "bg-amber-500" : "bg-emerald-600";

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/** A small inline USD editor: click the amount, type, press Enter. */
function MoneyEdit({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="rounded px-1 tabular-nums underline decoration-dotted underline-offset-4 hover:bg-neutral-100"
        aria-label={`Change ${label}`}
      >
        {value}
      </button>
    );
  }
  const save = async () => {
    if (draft === value) return setEditing(false);
    setSaving(true);
    if (await onSave(draft)) setEditing(false);
    setSaving(false);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="inline-flex items-center gap-1"
    >
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        aria-label={label}
        className={`${input} w-24`}
      />
      <button type="submit" disabled={saving} className="text-xs text-brand">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-neutral-500">
        Cancel
      </button>
    </form>
  );
}

type SortKey = "name" | "businessName" | "spent" | "cap" | "percent" | "lastActiveAt" | "status";

export function UsageDashboard(p: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "spent", desc: true });
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(url: string, body: unknown): Promise<boolean> {
    setError(null);
    const r = await adminSend(url, "PATCH", body);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    router.refresh();
    return true;
  }

  const people = useMemo(() => {
    const rows = p.people.filter((r) => !filter || r.businessId === filter);
    const val = (r: PersonRow): string | number => {
      switch (sort.key) {
        case "spent":
          return Number(r.spentUsd);
        case "cap":
          return Number(r.capUsd);
        case "percent":
          return r.percent;
        case "lastActiveAt":
          return r.lastActiveAt ?? "";
        case "businessName":
          return r.businessName ?? "";
        default:
          return String(r[sort.key]).toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [p.people, filter, sort]);

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key,
            desc: s.key === key ? !s.desc : key !== "name" && key !== "businessName",
          }))
        }
        className="inline-flex items-center gap-1 hover:text-neutral-900"
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? "▾" : "▴"}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-8">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <section aria-label="This month" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Spent this month" value={`USD ${p.cards.spentUsd}`} />
        <Card
          label="Projected month-end"
          value={`USD ${p.cards.projectedUsd}`}
          hint="At the current rate"
        />
        <Card label="Active users this month" value={fmtInt(p.cards.activeUsers)} />
        <Card
          label="Requests this month"
          value={fmtInt(p.cards.requests)}
          hint={
            p.cards.blockedRequests > 0 ? `${fmtInt(p.cards.blockedRequests)} blocked` : undefined
          }
        />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">By business</h2>
          <a href="/api/admin/export?kind=businesses" className={secondaryButton}>
            Export CSV
          </a>
        </div>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {p.businesses.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {b.name}
                  {!b.active && (
                    <span className="ml-2 text-xs text-neutral-500">(switched off)</span>
                  )}
                </span>
                <span className="tabular-nums text-neutral-700">
                  USD {b.spentUsd} of USD{" "}
                  {p.isSuper ? (
                    <MoneyEdit
                      value={b.budgetUsd}
                      label={`monthly budget for ${b.name}`}
                      onSave={(v) =>
                        patch(`/api/admin/businesses/${b.id}`, { monthlyBudgetUsd: v })
                      }
                    />
                  ) : (
                    b.budgetUsd
                  )}{" "}
                  · {b.percent}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
                <div
                  className={`h-full ${barColor(b.percent)}`}
                  style={{ width: `${Math.min(b.percent, 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">By person</h2>
          <div className="flex items-center gap-2">
            {p.isSuper && (
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter by business"
                className={input}
              >
                <option value="">All businesses</option>
                {p.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <a href="/api/admin/export?kind=people" className={secondaryButton}>
              Export CSV
            </a>
          </div>
        </div>
        <div className="relative overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
              <tr>
                {th("name", "Name")}
                {th("businessName", "Business")}
                {th("spent", "Spent", true)}
                {th("cap", "Cap (USD)", true)}
                {th("percent", "% used", true)}
                {th("lastActiveAt", "Last active")}
                {th("status", "Status")}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {people.map((r) => {
                const canManage = p.isSuper || r.role === "STAFF";
                const self = r.id === p.actorId;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-neutral-500">{r.email}</div>
                    </td>
                    <td className="px-3 py-2">{r.businessName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.spentUsd}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? (
                        <MoneyEdit
                          value={r.capUsd}
                          label={`monthly cap for ${r.name}`}
                          onSave={(v) => patch(`/api/admin/users/${r.id}`, { monthlyCapUsd: v })}
                        />
                      ) : (
                        <span className="tabular-nums">{r.capUsd}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`tabular-nums ${r.percent >= 100 ? "font-medium text-red-700" : r.percent >= 80 ? "text-amber-700" : ""}`}
                      >
                        {r.percent}%
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                      {r.lastActiveAt ? formatDateTime(new Date(r.lastActiveAt)) : "Never"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-800"
                            : r.status === "PAUSED"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-neutral-100 text-neutral-700"
                        }`}
                      >
                        {r.status === "ACTIVE"
                          ? "Active"
                          : r.status === "PAUSED"
                            ? "Paused"
                            : "Pending"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && !self && (r.status === "ACTIVE" || r.status === "PAUSED") && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={async () => {
                            setBusy(r.id);
                            await patch(`/api/admin/users/${r.id}`, {
                              status: r.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                            });
                            setBusy(null);
                          }}
                          className={secondaryButton}
                        >
                          {r.status === "ACTIVE" ? `Pause` : `Unpause`}
                          <span className="sr-only"> {r.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {people.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-neutral-500">
                    No one here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Recent requests</h2>
        <p className="mb-3 text-xs text-neutral-500">
          The last 100 requests. Message content is never shown to admins.
        </p>
        <div className="relative overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-600">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">In</th>
                <th className="px-3 py-2 text-right font-medium">Out</th>
                <th className="px-3 py-2 text-right font-medium">Cached</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Time taken</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {p.recent.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                    {formatDateTime(new Date(r.createdAt))}
                  </td>
                  <td className="px-3 py-2">{r.userName}</td>
                  <td className="px-3 py-2">{r.businessName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                    {r.model.replace("claude-", "")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.inputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.cachedTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">${r.costUsd}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(r.durationMs / 1000).toFixed(1)}s
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.status === "OK"
                          ? "text-emerald-700"
                          : r.status === "BLOCKED"
                            ? "text-amber-700"
                            : "text-red-700"
                      }
                      title={r.errorCode ?? undefined}
                    >
                      {r.status === "OK"
                        ? "ok"
                        : r.status === "BLOCKED"
                          ? "blocked"
                          : r.status === "ABORTED"
                            ? "stopped"
                            : "error"}
                    </span>
                    {r.errorCode && r.status !== "OK" && (
                      <span className="block text-xs text-neutral-500">
                        {r.errorCode.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {p.recent.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-neutral-500">
                    No requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
