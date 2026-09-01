import { describe, expect, it, vi } from "vitest";
import { buildBot } from "../src/bot.js";

const botInfo = {
  id: 1, is_bot: true, first_name: "TestBot", username: "test_bot",
  can_join_groups: true, can_read_all_group_messages: false,
  supports_inline_queries: false, can_connect_to_business: false,
  has_main_web_app: false,
} as const;

async function trackedBot(failDelete = false) {
  const bot = await buildBot("123456:TEST");
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.botInfo = { ...botInfo };
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (failDelete && method === "deleteMessage") throw new Error("message cannot be deleted");
    return { ok: true, result: true } as never;
  });
  return { bot, calls };
}

function callbackUpdate(chatId: number, userId: number) {
  return {
    update_id: 1,
    callback_query: {
      id: "start", from: { id: userId, is_bot: false, first_name: "Captain" }, data: "register:start",
      message: { message_id: 100, date: 0, chat: { id: chatId, type: chatId < 0 ? "group" : "private" } },
    },
  };
}

function textUpdate(chatId: number, userId: number, messageId: number, text: string) {
  return {
    update_id: messageId,
    message: { message_id: messageId, date: 0, chat: { id: chatId, type: chatId < 0 ? "group" : "private" }, from: { id: userId, is_bot: false, first_name: "Captain" }, text },
  };
}

describe("ephemeral form-message cleanup", () => {
  it("deletes a private roster input immediately after replying", async () => {
    const { bot, calls } = await trackedBot();
    await bot.handleUpdate(callbackUpdate(1, 1));
    await bot.handleUpdate(textUpdate(1, 1, 2, "Northwind"));
    expect(calls.some((call) => call.method === "sendMessage" && call.payload.text === "Капитан — игровой ID.")).toBe(true);
    expect(calls.some((call) => call.method === "deleteMessage" && call.payload.chat_id === 1 && call.payload.message_id === 2)).toBe(true);
  });

  it("deletes group/admin flow input and continues when Telegram rejects deletion", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bot, calls } = await trackedBot(true);
    await bot.handleUpdate(callbackUpdate(-100, 7));
    await bot.handleUpdate(textUpdate(-100, 7, 2, "Northwind"));
    expect(calls.some((call) => call.method === "deleteMessage" && call.payload.chat_id === -100 && call.payload.message_id === 2)).toBe(true);
    expect(calls.some((call) => call.method === "sendMessage" && call.payload.text === "Капитан — игровой ID.")).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
