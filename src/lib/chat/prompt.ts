import type { BetaTextBlockParam } from "@/lib/claude/types";
import { DISPLAY_TIME_ZONE } from "@/lib/period";

export interface PromptContext {
  basePrompt: string;
  businessName: string;
  businessExtra: string | null;
  userFirstName: string;
  now: Date;
}

/**
 * The system prompt for one request. It changes at most once a day (the date), so it stays in
 * the prompt cache across a conversation. The cache breakpoint sits at its end.
 */
export function buildSystemPrompt(ctx: PromptContext): BetaTextBlockParam[] {
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(ctx.now);
  const parts = [
    ctx.basePrompt.trim(),
    `You are helping ${ctx.userFirstName}, who works in ${ctx.businessName}. Today is ${today} (Nepal time).`,
  ];
  if (ctx.businessExtra?.trim()) {
    parts.push(`Additional instructions for ${ctx.businessName}:\n${ctx.businessExtra.trim()}`);
  }
  return [{ type: "text", text: parts.join("\n\n"), cache_control: { type: "ephemeral" } }];
}
