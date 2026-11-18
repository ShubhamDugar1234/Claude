// The models staff can pick, and how the portal calls each one.
// Which of these a business may use is set per business (Business.allowedModels).

export const MODEL_IDS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelConfig {
  id: ModelId;
  /** Short name shown in the model picker. */
  label: string;
  /** One line shown under the name in the picker. */
  description: string;
  /** Upper limit on reply length, including the model's thinking. Also drives the worst-case cost estimate. */
  maxTokens: number;
  /** How hard the model thinks. Lower is cheaper and faster; chat rarely needs more than "low". */
  effort: Effort;
  /** When a conversation's prompt passes this many tokens, older turns are compacted (summarised). */
  compactAtTokens: number;
}

export const MODELS: Record<ModelId, ModelConfig> = {
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5",
    label: "Sonnet",
    description: "Best for most work",
    maxTokens: 16_000,
    effort: "low",
    compactAtTokens: 150_000,
  },
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5",
    label: "Haiku",
    description: "Fastest and cheapest, for quick tasks",
    maxTokens: 16_000,
    effort: "low",
    // Kept under 100K so Haiku stays in its cheaper price tier (see pricing.ts).
    compactAtTokens: 90_000,
  },
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    label: "Opus",
    description: "Most capable, for hard problems (costs about 2x Sonnet)",
    maxTokens: 16_000,
    effort: "medium",
    compactAtTokens: 150_000,
  },
};

export const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";

export function isModelId(value: string): value is ModelId {
  return (MODEL_IDS as readonly string[]).includes(value);
}
