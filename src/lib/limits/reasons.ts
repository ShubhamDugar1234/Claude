// Why a request was refused, and the plain-words message staff see for each reason.
import { formatUsd, type MoneyInput } from "@/lib/money";
import { formatResetDate } from "@/lib/period";

export const BLOCK_REASONS = [
  "user_cap_reached",
  "business_budget_reached",
  "account_paused",
  "account_deactivated",
  "account_pending",
  "business_inactive",
  "model_not_allowed",
  "rate_limited",
  "too_many_streams",
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

/** Blocks that last until something changes (an admin, or the next month). The chat input is disabled. */
export const LASTING_BLOCKS: ReadonlySet<BlockReason> = new Set([
  "user_cap_reached",
  "business_budget_reached",
  "account_paused",
  "account_deactivated",
  "account_pending",
  "business_inactive",
]);

export interface BlockMessageContext {
  userCapUsd?: MoneyInput;
  resetAt?: Date;
  maxConcurrentStreams?: number;
}

const ASK = "Ask your manager or the ED's office";

export function blockMessage(reason: BlockReason, ctx: BlockMessageContext = {}): string {
  const resets = ctx.resetAt ? ` It resets on ${formatResetDate(ctx.resetAt)}.` : "";
  switch (reason) {
    case "user_cap_reached":
      return `You've used your monthly Claude allowance${
        ctx.userCapUsd !== undefined ? ` (${formatUsd(ctx.userCapUsd)})` : ""
      }.${resets} ${ASK} if you need more.`;
    case "business_budget_reached":
      return `Your business has used its Claude budget for this month.${resets} ${ASK} if your team needs more.`;
    case "account_paused":
      return `An administrator has paused your access to Claude. ${ASK} if you think this is a mistake.`;
    case "account_deactivated":
      return `Your account is no longer active. ${ASK} if you need access again.`;
    case "account_pending":
      return "Your account is waiting for approval. An administrator needs to assign you to your business before you can start.";
    case "business_inactive":
      return `Claude is switched off for your business at the moment. ${ASK} for details.`;
    case "model_not_allowed":
      return "That model isn't available for your business. Please pick another one from the list.";
    case "rate_limited":
      return "You're sending messages too quickly. Please wait a minute and try again.";
    case "too_many_streams": {
      const n = ctx.maxConcurrentStreams ?? 2;
      return `You already have ${n} replies in progress. Wait for one to finish (or stop it) and try again.`;
    }
  }
}
