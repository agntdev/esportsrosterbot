import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";
import { mainMenuItems } from "../src/toolkit/index.js";

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
      id: `tap-${data}`, data,
      from: { id: 1, is_bot: false, first_name: "Captain" },
      message: { message_id: 100, date: 0, text: "menu", chat: { id: 1, type: "private" } },
    },
  };
}

async function promptly<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error("Button response exceeded 3 seconds.")), 3_000); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("main menu responsiveness", () => {
  it("acknowledges and responds to every registered main-menu button within three seconds", async () => {
    for (const item of mainMenuItems()) {
      const bot = buildBot("123456:TEST");
      bot.botInfo = { ...botInfo };
      const calls: string[] = [];
      bot.api.config.use(async (_previous, method) => {
        calls.push(method);
        return { ok: true, result: true } as never;
      });

      await expect(promptly(bot.handleUpdate(callback(item.data)))).resolves.toBeUndefined();
      expect(calls, item.data).toContain("answerCallbackQuery");
      expect(calls.some((method) => method === "sendMessage" || method === "editMessageText"), item.data).toBe(true);
    }
  });
});
