"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessView } from "@/lib/admin/businesses";
import { adminSend, input, primaryButton, secondaryButton } from "./api";

interface Props {
  businesses: BusinessView[];
  models: { id: string; label: string }[];
}

type Form = {
  name: string;
  monthlyBudgetUsd: string;
  allowedModels: string[];
  webSearchEnabled: boolean;
  apiKeyEnvVar: string;
  extraSystemPrompt: string;
  active: boolean;
};

const blank: Form = {
  name: "",
  monthlyBudgetUsd: "20",
  allowedModels: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  webSearchEnabled: false,
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  extraSystemPrompt: "",
  active: true,
};

function BusinessForm({
  initial,
  models,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Form;
  models: Props["models"];
  submitLabel: string;
  onSubmit: (f: Form) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const ok = await onSubmit(f);
        setSaving(false);
        if (ok && !onCancel) setF(blank);
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-neutral-600">Name</span>
        <input
          className={input}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-neutral-600">Monthly budget (USD)</span>
        <input
          className={input}
          inputMode="decimal"
          value={f.monthlyBudgetUsd}
          onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })}
          required
        />
      </label>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-neutral-600">Models staff can use</legend>
        <div className="flex flex-wrap gap-3">
          {models.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={f.allowedModels.includes(m.id)}
                onChange={(e) =>
                  setF({
                    ...f,
                    allowedModels: e.target.checked
                      ? [...f.allowedModels, m.id]
                      : f.allowedModels.filter((x) => x !== m.id),
                  })
                }
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={f.webSearchEnabled}
            onChange={(e) => setF({ ...f, webSearchEnabled: e.target.checked })}
          />
          Web search (USD 10 per 1,000 searches)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />
          Switched on
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-neutral-600">
          API key setting (name of the variable in .env)
        </span>
        <input
          className={`${input} font-mono`}
          value={f.apiKeyEnvVar}
          onChange={(e) => setF({ ...f, apiKeyEnvVar: e.target.value.toUpperCase() })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="text-xs font-medium text-neutral-600">
          Extra instructions for Claude (optional)
        </span>
        <textarea
          rows={3}
          className={input}
          value={f.extraSystemPrompt}
          placeholder="e.g. Our customers are tractor dealers in Terai. Prices include 13% VAT."
          onChange={(e) => setF({ ...f, extraSystemPrompt: e.target.value })}
        />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={saving} className={primaryButton}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function BusinessesManager(p: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const label = (id: string) => p.models.find((m) => m.id === id)?.label ?? id;

  const save = async (url: string, method: "POST" | "PATCH", f: Form, okText: string) => {
    const r = await adminSend(url, method, f);
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error });
    if (r.ok) {
      setEditing(null);
      router.refresh();
    }
    return r.ok;
  };

  return (
    <div className="space-y-8">
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={`rounded-lg border px-4 py-2 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {notice.text}
        </p>
      )}
      <ul className="space-y-3">
        {p.businesses.map((b) => (
          <li key={b.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            {editing === b.id ? (
              <BusinessForm
                initial={{ ...b, monthlyBudgetUsd: b.budgetUsd }}
                models={p.models}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(f) =>
                  save(`/api/admin/businesses/${b.id}`, "PATCH", f, `Saved ${f.name}.`)
                }
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {b.name}
                    {!b.active && (
                      <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        Switched off
                      </span>
                    )}
                  </p>
                  <p className="text-neutral-600">
                    Budget USD {b.budgetUsd} a month · {b.allowedModels.map(label).join(", ")} · Web
                    search {b.webSearchEnabled ? "on" : "off"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Key: <code>{b.apiKeyEnvVar}</code>{" "}
                    {b.apiKeyConfigured ? (
                      <span className="text-emerald-700">(set on the server)</span>
                    ) : (
                      <span className="text-red-700">
                        (not set on the server: staff in this business can&apos;t chat)
                      </span>
                    )}
                  </p>
                </div>
                <button type="button" onClick={() => setEditing(b.id)} className={secondaryButton}>
                  Edit<span className="sr-only"> {b.name}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Add a business</h2>
        <BusinessForm
          initial={blank}
          models={p.models}
          submitLabel="Add business"
          onSubmit={(f) => save("/api/admin/businesses", "POST", f, `Added ${f.name}.`)}
        />
      </section>
    </div>
  );
}
