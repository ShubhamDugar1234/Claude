import type { Allowance } from "@/lib/limits/allowance";

export type { Allowance };

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  usage: { inputTokens: number; outputTokens: number; cost: string } | null;
  /** Client-only state while a reply is arriving or after it ended early. */
  streaming?: boolean;
  status?: string | null;
  notice?: string | null;
  error?: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}
