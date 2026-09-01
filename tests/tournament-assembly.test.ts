import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot";
import { formatSuiteResult, runSpecs, type BotSpec } from "../src/toolkit/harness/run-specs";

describe("tournament assembly", () => {
  it("locks an approved complete team and is idempotent", async () => {
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
        { send: { callback: "admin:tournament:compose" }, expect: [{ method: "sendMessage", payload: { text: "Tournament Preparation\nClean view: ON\n\nTeam: Falcons\nCaptain: Falcon (ID: f1)\nStarters:\n1. Falcon (f1)\n2. Two (f2)\n3. Three (f3)\n4. Four (f4)\n5. Five (f5)\nSubs:\n- Sub1: Empty slot\n- Sub2: Empty slot" } }] },
        { send: { callback: "admin:tournament:confirm" }, expect: [{ method: "sendMessage", payload: { text: "Турнир составлен. В него включено команд: 1. Составы команд зафиксированы." } }] },
        { send: { callback: "admin:tournament:confirm" }, expect: [{ method: "sendMessage", payload: { text: "Турнир уже составлен. Повторное подтверждение ничего не изменило." } }] },
        { send: { callback: "tournament:show" }, expect: [{ method: "editMessageText", payload: { text: "Tournament Preparation\nClean view: ON\n\nTeam: Falcons\nCaptain: Falcon (ID: f1)\nStarters:\n1. Falcon (f1)\n2. Two (f2)\n3. Three (f3)\n4. Four (f4)\n5. Five (f5)\nSubs:\n- Sub1: Empty slot\n- Sub2: Empty slot" } }] },
        { send: { callback: "edit:team" }, expect: [{ method: "sendMessage", payload: { text: "Выберите команду для редактирования." } }] },
        { send: { callback: "edit:select:t1" }, expect: [{ method: "sendMessage", payload: { text: "Состав этой команды уже зафиксирован в турнире и недоступен для изменений." } }] },
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
