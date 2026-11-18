import { describe, expect, it } from "vitest";
import {
  messageText,
  textBlocksOnly,
  titleFromText,
  toApiMessages,
} from "@/lib/chat/conversations";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { friendlyError } from "@/lib/chat/service";
import { combineUsage } from "@/lib/claude/usage";
import { calculateRequestCost } from "@/lib/cost";

describe("conversation titles", () => {
  it("use the first non-empty line, tidied and capped at 60 characters", () => {
    expect(titleFromText("\n\n  Draft a   letter to NIC Asia  \nmore")).toBe(
      "Draft a letter to NIC Asia",
    );
    expect(titleFromText("x".repeat(100))).toHaveLength(60);
    expect(titleFromText("x".repeat(100)).endsWith("…")).toBe(true);
    expect(titleFromText("   ")).toBe("New chat");
  });
});

describe("stored message helpers", () => {
  it("extract visible text and drop thinking blocks", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "abc" },
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];
    expect(messageText(content)).toBe("Hello world");
  });

  it("keep only finished text from a reply that was cut short", () => {
    expect(
      textBlocksOnly([
        { type: "thinking", thinking: "", signature: "" },
        { type: "text", text: "", citations: null },
        { type: "text", text: "partial", citations: null },
      ]),
    ).toEqual([{ type: "text", text: "partial", citations: null }]);
  });

  it("map stored rows to API messages, skipping empty ones", () => {
    expect(
      toApiMessages([
        { role: "USER", content: [{ type: "text", text: "hi" }] },
        { role: "ASSISTANT", content: [] },
        { role: "ASSISTANT", content: [{ type: "text", text: "hello" }] },
      ]),
    ).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
  });
});

describe("system prompt", () => {
  const base = {
    basePrompt: "BASE",
    businessName: "Mahindra",
    businessExtra: null,
    userFirstName: "Sita",
    now: new Date("2026-11-30T20:00:00Z"),
  };

  it("names the user and business, uses Nepal's date, and marks the cache breakpoint", () => {
    const [block] = buildSystemPrompt(base);
    expect(block.text).toContain("Sita");
    expect(block.text).toContain("Mahindra");
    expect(block.text).toContain("1 December 2026"); // already 1 Dec in Kathmandu
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds a business's extra instructions", () => {
    expect(buildSystemPrompt({ ...base, businessExtra: "Be formal." })[0].text).toContain(
      "Be formal.",
    );
  });
});

describe("usage across a paused web-search turn and its continuation", () => {
  it("is combined so every step is charged", () => {
    const first = {
      usage: {
        input_tokens: 10_000,
        output_tokens: 200,
        server_tool_use: { web_search_requests: 2 },
      },
      model: "claude-sonnet-5-5",
    };
    const second = {
      usage: {
        input_tokens: 20_000,
        output_tokens: 500,
        server_tool_use: { web_search_requests: 1 },
      },
      model: "claude-sonnet-5-5",
    };
    const combined = combineUsage(first, second);
    expect(combined.iterations).toHaveLength(2);
    const cost = calculateRequestCost("claude-sonnet-5-5", "claude-sonnet-5-5", combined);
    // 30,000 x $2 + 700 x $10 + 3 searches x $0.01
    expect(cost.total.toString()).toBe("0.097");
    expect(cost.webSearches).toBe(3);
  });
});

describe("error messages", () => {
  it("are different and plain for each kind of failure", () => {
    const kinds = [
      "rate_limit",
      "overloaded",
      "network",
      "invalid_request",
      "config",
      "unknown",
    ] as const;
    expect(new Set(kinds.map(friendlyError)).size).toBe(kinds.length);
  });
});

describe("token estimate when counting fails", () => {
  it("adds a generous allowance for each uploaded PDF and image", async () => {
    const { fallbackTokenEstimate } = await import("@/lib/chat/service");
    const text = fallbackTokenEstimate(
      [],
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    );
    const withFiles = fallbackTokenEstimate(
      [],
      [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: "f1" } },
            { type: "image", source: { type: "file", file_id: "f2" } },
            { type: "text", text: "hi" },
          ],
        },
      ],
    );
    expect(withFiles - text).toBeGreaterThanOrEqual(205_000);
  });
});
