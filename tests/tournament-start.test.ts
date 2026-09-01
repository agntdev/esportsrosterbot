import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";
import { startTournament, type TournamentData } from "../src/tournament-store.js";
import { formatSuiteResult, runSpecs, type BotSpec } from "../src/toolkit/harness/run-specs.js";

describe("tournament start", () => {
  it("moves the first scheduled fixture into progress and assigns every start time", () => {
    const data: TournamentData = {
      nextTeamNumber: 3, registrationPrice: 0, teamIds: ["t1", "t2"], auditEvents: [], nextNameReviewNumber: 1,
      nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 2,
      tournaments: { tr1: { id: "tr1", teamIds: ["t1", "t2"], createdAt: 0, createdBy: "1", status: "ready" } }, tournamentIds: ["tr1"], nextMatchNumber: 2,
      teams: {
        t1: { id: "t1", uniqueId: 1, name: "Alpha", captainTelegramId: "1", captainContact: "@alpha", paid: true, status: "entered", players: [] },
        t2: { id: "t2", uniqueId: 2, name: "Bravo", captainTelegramId: "2", captainContact: "@bravo", paid: true, status: "entered", players: [] },
      },
      matches: { m1: { id: "m1", number: 1, tournamentId: "tr1", stage: "Основной этап", team1Id: "t1", team2Id: "t2", timezone: "Europe/Moscow", status: "scheduled" } }, matchIds: ["m1"],
    };
    const matches = startTournament(data, data.tournaments.tr1);
    expect(data.tournaments.tr1.status).toBe("in_progress");
    expect(matches[0]).toMatchObject({ status: "in_progress" });
    expect(matches[0].startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("starts a composed tournament from the owner button and keeps the public table responsive", async () => {
    const previous = process.env.ADMIN_CHAT_ID;
    process.env.ADMIN_CHAT_ID = "1";
    const register = (name: string, prefix: string): BotSpec["steps"] => [
      { send: { callback: "register:start" }, expect: [] }, { send: { text: name }, expect: [] },
      { send: { text: `${prefix}1` }, expect: [] }, { send: { text: `${name} Captain` }, expect: [] }, { send: { text: `@${prefix}` }, expect: [] },
      ...[2, 3, 4, 5].flatMap((number) => [{ send: { text: `${prefix}${number}` }, expect: [] }, { send: { text: `${name} ${number}` }, expect: [] }]),
      { send: { callback: "register:preview" }, expect: [] }, { send: { callback: "register:confirm" }, expect: [] },
    ];
    const spec: BotSpec = { name: "owner starts tournament", steps: [
      ...register("Alpha", "a"), ...register("Bravo", "b"),
      { send: { callback: "admin:tournament:compose" }, expect: [] },
      { send: { callback: "admin:tournament:confirm" }, expect: [] },
      { send: { callback: "admin:tournament:start" }, expect: [{ method: "answerCallbackQuery" }, { method: "sendMessage", payload: { text: "Турнир начат. Матч №1 идёт сейчас; время следующих матчей назначено автоматически." } }] },
      { send: { callback: "matches:show" }, expect: [{ method: "answerCallbackQuery" }, { method: "editMessageText" }] },
    ] };
    try {
      const result = await runSpecs(() => buildBot("123456:TEST"), [spec]);
      expect(result.failed, formatSuiteResult(result)).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_CHAT_ID;
      else process.env.ADMIN_CHAT_ID = previous;
    }
  });
});
