import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";
import { formatSuiteResult, runSpecs, type BotSpec } from "../src/toolkit/harness/run-specs.js";

describe("shared tournament storage", () => {
  it("shows a captain registration to a public viewer in another chat", async () => {
    const roster: BotSpec["steps"] = [
      { send: { callback: "register:start", chatId: 10, userId: 10 }, expect: [] },
      { send: { text: "Alpha", chatId: 10, userId: 10 }, expect: [] },
      { send: { text: "a1", chatId: 10, userId: 10 }, expect: [] },
      { send: { text: "Captain", chatId: 10, userId: 10 }, expect: [] },
      { send: { text: "@alpha", chatId: 10, userId: 10 }, expect: [] },
      ...[2, 3, 4, 5].flatMap((number) => [
        { send: { text: `a${number}`, chatId: 10, userId: 10 }, expect: [] },
        { send: { text: `Player ${number}`, chatId: 10, userId: 10 }, expect: [] },
      ]),
      { send: { callback: "register:preview", chatId: 10, userId: 10 }, expect: [] },
      { send: { callback: "register:confirm", chatId: 10, userId: 10 }, expect: [] },
    ];
    const spec: BotSpec = {
      name: "shared tournament record",
      steps: [
        ...roster,
        { send: { callback: "teams:show", chatId: 20, userId: 20 }, expect: [{ method: "editMessageText", payload: { text: "Команды\n\n🏆 Команда #1 — Alpha\nСтатус: Подтверждена" } }] },
      ],
    };
    const result = await runSpecs(() => buildBot("123456:TEST"), [spec]);
    expect(result.failed, formatSuiteResult(result)).toBe(0);
  });
});
