// Adding and changing businesses (super admin only). Changes are audited.
import type { PrismaClient } from "@/generated/prisma/client";
import { MODEL_IDS } from "@/config/models";
import { API_KEY_ENV_PATTERN } from "@/lib/claude/key-pattern";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, requireSuper, type AdminScope } from "@/lib/admin/scope";
import { parseUsd } from "@/lib/admin/users";
import { money } from "@/lib/money";

const select = {
  id: true,
  name: true,
  monthlyBudgetUsd: true,
  allowedModels: true,
  webSearchEnabled: true,
  apiKeyEnvVar: true,
  extraSystemPrompt: true,
  active: true,
} as const;

type Row = {
  id: string;
  name: string;
  monthlyBudgetUsd: { toString(): string };
  allowedModels: string[];
  webSearchEnabled: boolean;
  apiKeyEnvVar: string;
  extraSystemPrompt: string | null;
  active: boolean;
};

function view(b: Row) {
  return {
    id: b.id,
    name: b.name,
    budgetUsd: money(b.monthlyBudgetUsd).toFixed(2),
    allowedModels: b.allowedModels,
    webSearchEnabled: b.webSearchEnabled,
    apiKeyEnvVar: b.apiKeyEnvVar,
    /** Whether the named env var is actually set on the server (the key itself never leaves it). */
    apiKeyConfigured: !!process.env[b.apiKeyEnvVar],
    extraSystemPrompt: b.extraSystemPrompt ?? "",
    active: b.active,
  };
}

export type BusinessView = ReturnType<typeof view>;

export async function listBusinesses(db: PrismaClient, scope: AdminScope): Promise<BusinessView[]> {
  const rows = await db.business.findMany({
    where: scope.businessId ? { id: scope.businessId } : {},
    orderBy: { name: "asc" },
    select,
  });
  return rows.map(view);
}

export interface BusinessInput {
  name?: unknown;
  monthlyBudgetUsd?: unknown;
  allowedModels?: unknown;
  webSearchEnabled?: unknown;
  apiKeyEnvVar?: unknown;
  extraSystemPrompt?: unknown;
  active?: unknown;
}

function clean(input: BusinessInput, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined || !partial) {
    const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > 80) throw new AdminError(400, "Please enter the business name.");
    out.name = name;
  }
  if (input.monthlyBudgetUsd !== undefined || !partial) {
    out.monthlyBudgetUsd = parseUsd(input.monthlyBudgetUsd, "Monthly budget");
  }
  if (input.allowedModels !== undefined || !partial) {
    const models = Array.isArray(input.allowedModels) ? input.allowedModels : [];
    if (
      models.length === 0 ||
      !models.every((m) => (MODEL_IDS as readonly unknown[]).includes(m))
    ) {
      throw new AdminError(400, "Choose at least one model.");
    }
    // Keep the picker order stable.
    out.allowedModels = MODEL_IDS.filter((m) => models.includes(m));
  }
  if (input.webSearchEnabled !== undefined) out.webSearchEnabled = input.webSearchEnabled === true;
  if (input.active !== undefined) out.active = input.active === true;
  if (input.apiKeyEnvVar !== undefined || !partial) {
    const v =
      typeof input.apiKeyEnvVar === "string" && input.apiKeyEnvVar.trim()
        ? input.apiKeyEnvVar.trim()
        : "ANTHROPIC_API_KEY";
    if (!API_KEY_ENV_PATTERN.test(v)) {
      throw new AdminError(
        400,
        "The API key setting must be ANTHROPIC_API_KEY or start with ANTHROPIC_API_KEY_ (e.g. ANTHROPIC_API_KEY_MAHINDRA).",
      );
    }
    out.apiKeyEnvVar = v;
  }
  if (input.extraSystemPrompt !== undefined) {
    const p = typeof input.extraSystemPrompt === "string" ? input.extraSystemPrompt.trim() : "";
    if (p.length > 4000)
      throw new AdminError(400, "Extra instructions can be at most 4,000 characters.");
    out.extraSystemPrompt = p || null;
  }
  return out;
}

export async function createBusiness(db: PrismaClient, scope: AdminScope, input: BusinessInput) {
  requireSuper(scope);
  const data = clean(input, false);
  return db.$transaction(async (tx) => {
    if (await tx.business.findUnique({ where: { name: data.name as string } })) {
      throw new AdminError(409, "A business with this name already exists.");
    }
    const b = await tx.business.create({ data: data as never, select });
    await writeAudit(tx, {
      actorId: scope.actorId,
      action: "business.created",
      targetType: "Business",
      targetId: b.id,
      businessId: b.id,
      after: view(b),
    });
    return view(b);
  });
}

export async function updateBusiness(
  db: PrismaClient,
  scope: AdminScope,
  id: string,
  input: BusinessInput,
) {
  requireSuper(scope);
  const data = clean(input, true);
  return db.$transaction(async (tx) => {
    const before = await tx.business.findUnique({ where: { id }, select });
    if (!before) throw new AdminError(404, "Business not found.");
    if (
      data.name &&
      data.name !== before.name &&
      (await tx.business.findUnique({ where: { name: data.name as string } }))
    ) {
      throw new AdminError(409, "A business with this name already exists.");
    }
    const after = await tx.business.update({ where: { id }, data: data as never, select });
    const b = view(before);
    const a = view(after);
    if (b.budgetUsd !== a.budgetUsd) {
      await writeAudit(tx, {
        actorId: scope.actorId,
        action: "business.budget_changed",
        targetType: "Business",
        targetId: id,
        businessId: id,
        before: { budgetUsd: b.budgetUsd },
        after: { budgetUsd: a.budgetUsd },
      });
    }
    // Everything else that changed, in one entry.
    const keys = (
      [
        "name",
        "allowedModels",
        "webSearchEnabled",
        "apiKeyEnvVar",
        "extraSystemPrompt",
        "active",
      ] as const
    ).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (keys.length > 0) {
      await writeAudit(tx, {
        actorId: scope.actorId,
        action: "business.updated",
        targetType: "Business",
        targetId: id,
        businessId: id,
        before: Object.fromEntries(keys.map((k) => [k, b[k]])),
        after: Object.fromEntries(keys.map((k) => [k, a[k]])),
      });
    }
    return a;
  });
}
