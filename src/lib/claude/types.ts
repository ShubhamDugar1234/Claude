// The portal's view of a Claude call, independent of the SDK so the chat service can be
// tested with a mock. Content and message shapes are the SDK's own types.
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Effort } from "@/config/models";
import type { ApiUsageWithIterations } from "@/lib/cost";

export type { BetaContentBlock, BetaMessageParam, BetaTextBlockParam, BetaToolUnion };

export interface ClaudeRequest {
  model: string;
  maxTokens: number;
  effort: Effort;
  system: BetaTextBlockParam[];
  messages: BetaMessageParam[];
  tools: BetaToolUnion[];
  /** Compact (summarise) older turns when the prompt passes this many tokens. */
  compactAtTokens: number;
  /** Opaque user id sent to Anthropic for abuse monitoring. Never an email or name. */
  userId: string;
  signal?: AbortSignal;
}

/** Events forwarded to the browser while a reply streams. */
export type ClaudeEvent = { type: "text"; text: string } | { type: "status"; status: "searching" };

export interface ClaudeResult {
  content: BetaContentBlock[];
  usage: ApiUsageWithIterations;
  /** The model Anthropic says produced the reply (the billed model). */
  model: string;
  stopReason: string | null;
}

export type ClaudeErrorKind =
  "aborted" | "rate_limit" | "overloaded" | "config" | "invalid_request" | "network" | "unknown";

/** Thrown when a call ends early. Carries whatever was generated and billed before it ended. */
export class ClaudeStreamError extends Error {
  constructor(
    public readonly kind: ClaudeErrorKind,
    /** Short code for UsageEvent.errorCode, e.g. "overloaded_error". Never message text. */
    public readonly code: string,
    public readonly partialUsage: ApiUsageWithIterations | null,
    public readonly partialContent: BetaContentBlock[],
    public readonly billedModel: string | null = null,
  ) {
    super(`Claude call ended: ${code}`);
    this.name = "ClaudeStreamError";
  }
}

export interface ClaudeClient {
  /** Prompt size in tokens. Throws if counting isn't possible; the caller falls back to an upper bound. */
  countTokens(req: Omit<ClaudeRequest, "maxTokens" | "signal">): Promise<number>;
  stream(req: ClaudeRequest, onEvent: (e: ClaudeEvent) => void): Promise<ClaudeResult>;
  /** Uploads a PDF or image to Anthropic's Files API (private to the account). Returns its file id. */
  uploadFile(file: { bytes: Buffer; name: string; mediaType: string }): Promise<string>;
  /** Deletes an uploaded file. Never throws for a file that's already gone. */
  deleteFile(fileId: string): Promise<void>;
}
