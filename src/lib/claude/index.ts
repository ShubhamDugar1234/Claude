import "server-only";
import { createMockClaude } from "@/lib/claude/mock";
import { createRealClaude } from "@/lib/claude/real";
import type { ClaudeClient } from "@/lib/claude/types";

/** Only names like ANTHROPIC_API_KEY or ANTHROPIC_API_KEY_MAHINDRA may hold Anthropic keys. */
export const API_KEY_ENV_PATTERN = /^ANTHROPIC_API_KEY(_[A-Z0-9_]+)?$/;

export class MissingApiKeyError extends Error {
  constructor(public readonly envVar: string) {
    super(`No Anthropic API key in ${envVar}`);
    this.name = "MissingApiKeyError";
  }
}

function mockEnabled(): boolean {
  if (process.env.MOCK_ANTHROPIC !== "true") return false;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_ANTHROPIC !== "true") {
    throw new Error("MOCK_ANTHROPIC is for development and tests only");
  }
  return true;
}

const clients = new Map<string, ClaudeClient>();

/** The Claude client for a business, using the API key named by Business.apiKeyEnvVar. */
export function getClaudeClient(apiKeyEnvVar: string): ClaudeClient {
  if (mockEnabled()) return createMockClaude();
  if (!API_KEY_ENV_PATTERN.test(apiKeyEnvVar)) throw new MissingApiKeyError(apiKeyEnvVar);
  const key = process.env[apiKeyEnvVar];
  if (!key) throw new MissingApiKeyError(apiKeyEnvVar);
  let client = clients.get(apiKeyEnvVar);
  if (!client) {
    client = createRealClaude(key);
    clients.set(apiKeyEnvVar, client);
  }
  return client;
}
