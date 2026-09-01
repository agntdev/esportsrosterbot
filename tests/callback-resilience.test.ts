import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";

const botInfo = {
  id: 1, is_bot: true, first_name: "TestBot", username: "test_bot",
  can_join_groups: true, can_read_all_group_messages: false,
  supports_inline_queries: false, can_connect_to_business: false,
  has_main_web_app: false,
} as const;

function callback(data: string) {
  return {
    update_id: 1,
    callback_query: {
      id: "repeated-tap", data,
      from: { id: 1, is_bot: false, first_name: "Captain" },
      message: { message_id: 100, date: 0, text: "old table", chat: { id: 1, type: "private" } },
    },
  };
}

describe("callback resilience", () => {
  it("acknowledges a tap before rendering and tolerates Telegram's unchanged-message response", async () => {
    const bot = buildBot("123456:TEST");
    bot.botInfo = { ...botInfo };
    const calls: string[] = [];
    bot.api.config.use(async (_previous, method) => {
      calls.push(method);
      if (method === "editMessageText") {
        return { ok: false, error_code: 400, description: "Bad Request: message is not modified" } as never;
      }
      return { ok: true, result: true } as never;
    });

    await expect(bot.handleUpdate(callback("matches:show"))).resolves.toBeUndefined();
    expect(calls[0]).toBe("answerCallbackQuery");
    expect(calls).toContain("editMessageText");
  });

  it("continues when Telegram says a duplicate callback acknowledgement is too old", async () => {
    const bot = buildBot("123456:TEST");
    bot.botInfo = { ...botInfo };
    const calls: string[] = [];
    bot.api.config.use(async (_previous, method) => {
      calls.push(method);
      if (method === "answerCallbackQuery") {
        return { ok: false, error_code: 400, description: "Bad Request: query is too old and response timeout expired" } as never;
      }
      return { ok: true, result: true } as never;
    });

    await expect(bot.handleUpdate(callback("register:start"))).resolves.toBeUndefined();
    expect(calls).toContain("sendMessage");
  });
});
