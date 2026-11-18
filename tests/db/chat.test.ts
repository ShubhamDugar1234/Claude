import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runChatTurn, type ChatStreamEvent } from "@/lib/chat/service";
import {
  deleteConversation,
  getConversationForDisplay,
  listConversations,
  renameConversation,
} from "@/lib/chat/conversations";
import { createMockClaude } from "@/lib/claude/mock";
import { prepareAttachments, type PreparedAttachment } from "@/lib/attachments";
import { makeXlsx, TINY_PDF, TINY_PNG } from "../fixtures/make-xlsx";
import type { ClaudeClient, ClaudeRequest, ClaudeResult } from "@/lib/claude/types";
import { createBusiness, createUser, makeDb, resetDb, TEST_LIMITS, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(() => {
  db = makeDb();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
});

const SONNET = "claude-sonnet-5-5";

async function setup(opts: { cap?: string; webSearch?: boolean } = {}) {
  const b = await createBusiness(db);
  if (opts.webSearch)
    await db.business.update({ where: { id: b.id }, data: { webSearchEnabled: true } });
  const u = await createUser(db, b.id, { cap: opts.cap ?? "10" });
  return { b, u };
}

async function turn(
  userId: string,
  text: string,
  opts: {
    conversationId?: string | null;
    model?: string;
    claude?: ClaudeClient;
    signal?: AbortSignal;
    attachments?: PreparedAttachment[];
  } = {},
) {
  const events: ChatStreamEvent[] = [];
  await runChatTurn(
    { db, claudeFor: () => opts.claude ?? createMockClaude(), limits: TEST_LIMITS },
    {
      userId,
      conversationId: opts.conversationId ?? null,
      model: opts.model ?? SONNET,
      text,
      attachments: opts.attachments,
      signal: opts.signal,
    },
    (e) => events.push(e),
  );
  return events;
}

/** A client that records requests and returns a fixed result. */
function spyClient(
  result: Partial<ClaudeResult> = {},
  opts: { countFails?: boolean; uploadFails?: boolean } = {},
) {
  const requests: ClaudeRequest[] = [];
  const uploads: string[] = [];
  const deleted: string[] = [];
  const client: ClaudeClient = {
    async countTokens() {
      if (opts.countFails) throw new Error("count failed");
      return 1_000;
    },
    async uploadFile({ name }) {
      uploads.push(name);
      if (opts.uploadFails) throw new Error("upload failed");
      return `file_${uploads.length}`;
    },
    async deleteFile(id) {
      deleted.push(id);
    },
    async stream(req, onEvent) {
      requests.push(req);
      onEvent({ type: "text", text: "ok" });
      return {
        content: [{ type: "text", text: "ok", citations: null }],
        usage: { input_tokens: 1_000, output_tokens: 100 },
        model: req.model,
        stopReason: "end_turn",
        ...result,
      };
    },
  };
  return { client, requests, uploads, deleted };
}

describe("a chat turn", () => {
  it("creates the conversation, streams the reply, saves it and records the cost", async () => {
    const { u } = await setup();
    const events = await turn(u.id, "Write a short note to the Pokhara branch");

    const conv = events.find((e) => e.type === "conversation");
    expect(conv).toMatchObject({ title: "Write a short note to the Pokhara branch" });
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(1);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type !== "done" || conv?.type !== "conversation") return;
    expect(done.usage.cost).toMatch(/^\$|^<\$/);
    expect(done.allowance?.capUsd).toBe("10.00");

    const messages = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });
    expect(messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    const event = await db.usageEvent.findUniqueOrThrow({
      where: { id: messages[1].usageEventId! },
    });
    expect(event).toMatchObject({
      status: "OK",
      conversationId: conv.id,
      model: SONNET,
      userId: u.id,
    });
    expect(event.costUsd.greaterThan(0)).toBe(true);
    expect(await db.reservation.count({ where: { status: "OPEN" } })).toBe(0);
  });

  it("sends the earlier turns when continuing a conversation", async () => {
    const { u } = await setup();
    const first = await turn(u.id, "First question");
    const conv = first.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    const spy = spyClient();
    await turn(u.id, "Second question", { conversationId: conv.id, claude: spy.client });
    const sent = spy.requests[0].messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(sent[0])).toContain("First question");
    expect(JSON.stringify(sent[2])).toContain("Second question");
  });

  it("builds a cached system prompt with the business and user", async () => {
    const { u, b } = await setup();
    await db.business.update({
      where: { id: b.id },
      data: { extraSystemPrompt: "Mention our Teku showroom." },
    });
    const spy = spyClient();
    await turn(u.id, "hello", { claude: spy.client });
    const system = spy.requests[0].system;
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toContain("NPR");
    expect(system[0].text).toContain(b.name);
    expect(system[0].text).toContain("Mention our Teku showroom.");
    expect(spy.requests[0].userId).toBe(u.id);
  });

  it("adds web search only for businesses that have it on", async () => {
    const off = await setup();
    const spyOff = spyClient();
    await turn(off.u.id, "news?", { claude: spyOff.client });
    expect(spyOff.requests[0].tools).toEqual([]);

    const on = await setup({ webSearch: true });
    const spyOn = spyClient();
    await turn(on.u.id, "news?", { claude: spyOn.client });
    expect(spyOn.requests[0].tools[0]).toMatchObject({ type: "web_search_20260209", max_uses: 3 });
  });

  it("still works when token counting fails (uses a safe upper bound)", async () => {
    const { u } = await setup();
    const spy = spyClient({}, { countFails: true });
    const events = await turn(u.id, "hello", { claude: spy.client });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("explains a refusal", async () => {
    const { u } = await setup();
    const spy = spyClient({ stopReason: "refusal" });
    const events = await turn(u.id, "hello", { claude: spy.client });
    expect(events.find((e) => e.type === "done")).toMatchObject({
      notice: "Claude declined to answer this request.",
    });
  });
});

describe("blocked and failed turns", () => {
  it("blocks at the cap without creating anything, and logs the block", async () => {
    const { u, b } = await setup({ cap: "1" });
    await db.usageEvent.create({
      data: {
        userId: u.id,
        businessId: b.id,
        requestedModel: SONNET,
        model: SONNET,
        costUsd: "1",
        status: "OK",
      },
    });
    const events = await turn(u.id, "hello");
    const blocked = events.find((e) => e.type === "blocked");
    expect(blocked).toMatchObject({ reason: "user_cap_reached", lasting: true });
    if (blocked?.type === "blocked")
      expect(blocked.message).toContain("You've used your monthly Claude allowance (USD 1.00)");
    expect(await db.conversation.count()).toBe(0);
    expect(
      await db.usageEvent.count({ where: { status: "BLOCKED", errorCode: "user_cap_reached" } }),
    ).toBe(1);
  });

  it("refuses another user's conversation", async () => {
    const a = await setup();
    const other = await createUser(db, a.b.id);
    const first = await turn(a.u.id, "mine");
    const conv = first.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    const events = await turn(other.id, "let me in", { conversationId: conv.id });
    expect(events).toEqual([
      expect.objectContaining({ type: "error", message: "This conversation no longer exists." }),
    ]);
    expect(await db.reservation.count({ where: { userId: other.id } })).toBe(0);
  });

  it("refuses unknown models and models the business can't use", async () => {
    const { u } = await setup();
    expect((await turn(u.id, "hi", { model: "gpt-4" }))[0]).toMatchObject({ type: "error" });
    expect(
      (await turn(u.id, "hi", { model: "claude-opus-5-5" })).find((e) => e.type === "blocked"),
    ).toMatchObject({
      reason: "model_not_allowed",
      lasting: false,
    });
  });

  it("keeps partial text and charges partial usage when Claude fails mid-reply", async () => {
    const { u } = await setup();
    const events = await turn(u.id, "please MOCK_ERROR now");
    expect(events.at(-1)).toMatchObject({ type: "error" });
    const assistant = await db.message.findFirstOrThrow({ where: { role: "ASSISTANT" } });
    const event = await db.usageEvent.findUniqueOrThrow({ where: { id: assistant.usageEventId! } });
    expect(event).toMatchObject({ status: "ERROR", errorCode: "overloaded_error" });
    expect(event.outputTokens).toBeGreaterThan(0);
    expect(await db.reservation.count({ where: { status: "OPEN" } })).toBe(0);
  });

  it("records a stopped reply as ABORTED with what was generated", async () => {
    const { u } = await setup();
    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];
    await runChatTurn(
      { db, claudeFor: () => createMockClaude(), limits: TEST_LIMITS },
      {
        userId: u.id,
        conversationId: null,
        model: SONNET,
        text: "MOCK_SLOW",
        signal: controller.signal,
      },
      (e) => {
        events.push(e);
        if (events.filter((x) => x.type === "text").length === 3) controller.abort();
      },
    );
    const event = await db.usageEvent.findFirstOrThrow({ where: { status: "ABORTED" } });
    expect(event.outputTokens).toBeGreaterThan(0);
    expect(await db.message.count({ where: { role: "ASSISTANT" } })).toBe(1);
    expect(await db.reservation.count({ where: { status: "OPEN" } })).toBe(0);
  });

  it("settles the reservation and explains when the business has no API key", async () => {
    const { u } = await setup();
    const events: ChatStreamEvent[] = [];
    await runChatTurn(
      {
        db,
        claudeFor: () => {
          throw new Error("missing key");
        },
        limits: TEST_LIMITS,
      },
      {
        userId: u.id,
        conversationId: null,
        model: SONNET,
        text: "hi",
      },
      (e) => events.push(e),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringContaining("isn't set up correctly"),
    });
    expect(
      await db.usageEvent.count({ where: { status: "ERROR", errorCode: "api_key_missing" } }),
    ).toBe(1);
    expect(await db.reservation.count({ where: { status: "OPEN" } })).toBe(0);
  });
});

describe("conversations are private to their owner", () => {
  it("lists, searches, renames and deletes only your own chats", async () => {
    const { u, b } = await setup();
    const other = await createUser(db, b.id);
    await turn(u.id, "Budget for Dashain campaign");
    await turn(u.id, "Translate this letter");
    const theirs = await turn(other.id, "Secret plans");
    const theirConv = theirs.find((e) => e.type === "conversation");
    if (theirConv?.type !== "conversation") throw new Error("no conversation");

    expect((await listConversations(db, u.id)).map((c) => c.title).sort()).toEqual([
      "Budget for Dashain campaign",
      "Translate this letter",
    ]);
    expect((await listConversations(db, u.id, "dashain")).map((c) => c.title)).toEqual([
      "Budget for Dashain campaign",
    ]);

    expect(await getConversationForDisplay(db, u.id, theirConv.id)).toBeNull();
    expect(await renameConversation(db, u.id, theirConv.id, "hijacked")).toBe(false);
    expect(await deleteConversation(db, u.id, theirConv.id)).toBeNull();
    expect(await db.message.count({ where: { conversationId: theirConv.id } })).toBe(2);
  });

  it("deleting removes the messages and title but keeps usage for billing", async () => {
    const { u } = await setup();
    const events = await turn(u.id, "Delete me later");
    const conv = events.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    const before = await db.usageEvent.count({ where: { conversationId: conv.id } });
    expect(await deleteConversation(db, u.id, conv.id)).toEqual([]);
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(0);
    const row = await db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.title).toBe("");
    expect(row.deletedAt).not.toBeNull();
    expect(await db.usageEvent.count({ where: { conversationId: conv.id } })).toBe(before);
    expect(await listConversations(db, u.id)).toEqual([]);
  });

  it("shows the usage line for each reply", async () => {
    const { u } = await setup();
    const events = await turn(u.id, "hello");
    const conv = events.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    const view = await getConversationForDisplay(db, u.id, conv.id);
    expect(view?.messages[0]).toMatchObject({ role: "user", text: "hello", usage: null });
    expect(view?.messages[1].usage?.outputTokens).toBeGreaterThan(0);
  });
});

describe("attachments", () => {
  it("uploads PDFs and images, sends converted spreadsheets as text, and says so", async () => {
    const { u } = await setup();
    const attachments = await prepareAttachments([
      { name: "report.pdf", bytes: TINY_PDF },
      { name: "photo.png", bytes: TINY_PNG },
      {
        name: "sales.xlsx",
        bytes: makeXlsx([
          {
            name: "S",
            rows: [
              ["Branch", "Units"],
              ["Butwal", 42],
            ],
          },
        ]),
      },
    ]);
    const spy = spyClient();
    const events = await turn(u.id, "Compare these", { claude: spy.client, attachments });

    expect(spy.uploads).toEqual(["report.pdf", "photo.png"]);
    const sent = spy.requests[0].messages.at(-1)!.content as {
      type: string;
      source?: { type: string; file_id?: string; data?: string };
      title?: string;
      text?: string;
    }[];
    expect(sent.map((b) => b.type)).toEqual(["document", "image", "document", "text"]);
    expect(sent[0]).toMatchObject({
      source: { type: "file", file_id: "file_1" },
      title: "report.pdf",
    });
    expect(sent[1]).toMatchObject({ source: { type: "file", file_id: "file_2" } });
    expect(sent[2]).toMatchObject({
      source: { type: "text", data: "Branch,Units\nButwal,42" },
      title: "sales.xlsx (converted to CSV)",
    });
    expect(sent[3]).toMatchObject({ text: "Compare these" });
    expect(events.find((e) => e.type === "converted")).toEqual({
      type: "converted",
      names: ["sales.xlsx"],
    });

    const userMsg = await db.message.findFirstOrThrow({ where: { role: "USER" } });
    expect(userMsg.attachments).toEqual([
      { name: "report.pdf", kind: "pdf", converted: false, sizeBytes: TINY_PDF.length },
      { name: "photo.png", kind: "image", converted: false, sizeBytes: TINY_PNG.length },
      { name: "sales.xlsx", kind: "spreadsheet", converted: true, sizeBytes: expect.any(Number) },
    ]);
  });

  it("names a new chat after the first file when there's no text", async () => {
    const { u } = await setup();
    const attachments = await prepareAttachments([{ name: "budget.pdf", bytes: TINY_PDF }]);
    const events = await turn(u.id, "", { claude: spyClient().client, attachments });
    expect(events.find((e) => e.type === "conversation")).toMatchObject({ title: "budget.pdf" });
  });

  it("deletes uploaded files when the request is blocked", async () => {
    const { u, b } = await setup({ cap: "1" });
    await db.usageEvent.create({
      data: {
        userId: u.id,
        businessId: b.id,
        requestedModel: SONNET,
        model: SONNET,
        costUsd: "1",
        status: "OK",
      },
    });
    const spy = spyClient();
    const attachments = await prepareAttachments([{ name: "report.pdf", bytes: TINY_PDF }]);
    const events = await turn(u.id, "read this", { claude: spy.client, attachments });
    expect(events.find((e) => e.type === "blocked")).toBeDefined();
    expect(spy.deleted).toEqual(["file_1"]);
  });

  it("explains a failed upload without reserving or charging", async () => {
    const { u } = await setup();
    const spy = spyClient({}, { uploadFails: true });
    const attachments = await prepareAttachments([{ name: "report.pdf", bytes: TINY_PDF }]);
    const events = await turn(u.id, "read this", { claude: spy.client, attachments });
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringContaining("couldn't be sent"),
    });
    expect(await db.reservation.count()).toBe(0);
  });

  it("deleting a chat returns its uploaded file ids so they can be removed", async () => {
    const { u } = await setup();
    const attachments = await prepareAttachments([
      { name: "a.pdf", bytes: TINY_PDF },
      { name: "b.png", bytes: TINY_PNG },
    ]);
    const events = await turn(u.id, "files", { claude: spyClient().client, attachments });
    const conv = events.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    expect((await deleteConversation(db, u.id, conv.id))?.sort()).toEqual(["file_1", "file_2"]);
  });

  it("shows attachment names in the user's own history", async () => {
    const { u } = await setup();
    const attachments = await prepareAttachments([
      { name: "list.csv", bytes: Buffer.from("a,b\n1,2") },
    ]);
    const events = await turn(u.id, "check", { attachments });
    const conv = events.find((e) => e.type === "conversation");
    if (conv?.type !== "conversation") throw new Error("no conversation");
    const view = await getConversationForDisplay(db, u.id, conv.id);
    expect(view?.messages[0].attachments).toEqual([
      { name: "list.csv", kind: "csv", converted: true },
    ]);
    expect(view?.messages[0].text).toBe("check");
  });
});
