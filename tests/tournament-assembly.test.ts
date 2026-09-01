import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot";
import { formatSuiteResult, runSpecs, type BotSpec } from "../src/toolkit/harness/run-specs";

describe("tournament assembly", () => {
  it("requires two eligible teams before a playable tournament is assembled", async () => {
    const priorAdmin = process.env.ADMIN_CHAT_ID;
    process.env.ADMIN_CHAT_ID = "1";
    const spec: BotSpec = {
      name: "admin assembles a tournament",
      steps: [
        { send: { callback: "register:start" }, expect: [{ method: "sendMessage", payload: { text: "Введите название команды." } }] },
        { send: { text: "Falcons" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "f1" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "Falcon" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "@falcons" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "f2" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "Two" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "f3" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "Three" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "f4" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "Four" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "f5" }, expect: [{ method: "sendMessage" }] },
        { send: { text: "Five" }, expect: [{ method: "sendMessage" }] },
        { send: { callback: "register:preview" }, expect: [{ method: "sendMessage" }] },
        { send: { callback: "register:confirm" }, expect: [{ method: "sendMessage" }] },
        { send: { callback: "admin:tournament:compose" }, expect: [{ method: "sendMessage", payload: { text: "Для старта турнира нужны минимум две подтверждённые команды без конфликтов ID." } }] },
        { send: { callback: "tournament:show" }, expect: [{ method: "editMessageText", payload: { text: "Турнир ещё не составлен — таблица появится после решения организатора." } }] },
        { send: { callback: "edit:team" }, expect: [{ method: "sendMessage", payload: { text: "Выберите команду для редактирования." } }] },
      ],
    };
    try {
      const result = await runSpecs(() => buildBot("123456:TEST"), [spec]);
      expect(result.failed, formatSuiteResult(result)).toBe(0);
    } finally {
      if (priorAdmin === undefined) delete process.env.ADMIN_CHAT_ID;
      else process.env.ADMIN_CHAT_ID = priorAdmin;
    }
  });
});
