import type { Allowance } from "./types";

export function AllowanceMeter({ allowance }: { allowance: Allowance | null }) {
  if (!allowance) return null;
  const pct = Math.min(allowance.percent, 100);
  const color =
    allowance.percent >= 100
      ? "bg-red-600"
      : allowance.percent >= 80
        ? "bg-amber-500"
        : "bg-emerald-600";
  const businessTight =
    allowance.businessPercent >= 80 && allowance.businessPercent > allowance.percent;
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs leading-snug text-neutral-600 sm:text-sm">
        USD {allowance.spentUsd} of USD {allowance.capUsd} used this month
      </p>
      <div
        className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-label="Monthly allowance used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {businessTight && (
        <p className="mt-1 truncate text-xs text-amber-700">
          Your business has used {Math.min(allowance.businessPercent, 100)}% of its monthly budget.
        </p>
      )}
    </div>
  );
}
