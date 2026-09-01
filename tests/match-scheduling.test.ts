import { describe, expect, it } from "vitest";
import { MATCH_DURATION_MS, matchExportRows, parseMatchStart, scheduleMatch, type MatchTable } from "../src/tournament-store";
import { formatTime, matchLine } from "../src/handlers/tournament-table";
import { buildBot } from "../src/bot";
import { formatSuiteResult, runSpecs, type BotSpec } from "../src/toolkit/harness/run-specs";

describe("match scheduling", () => {
  it("parses an ISO date and 24-hour time into UTC and persists a one-hour interval", () => {
    expect(parseMatchStart("2026-09-10", "20:00")).toBe("2026-09-10T17:00:00.000Z");
    expect(parseMatchStart("2026-02-30", "20:00")).toBeUndefined();
    expect(parseMatchStart("2026-09-10", "24:00")).toBeUndefined();
    expect(parseMatchStart("2026-09-10", "8:00")).toBeUndefined();

    const match: MatchTable = { id: "m1", number: 1, tournamentId: "tr1", stage: "Основной этап", team1Id: "t1", team2Id: "t2", timezone: "Europe/Moscow", status: "scheduled" };
    scheduleMatch(match, "2026-09-10T17:00:00.000Z");
    expect(match.startTime).toBe("2026-09-10T17:00:00.000Z");
    expect(match.endTime).toBe("2026-09-10T18:00:00.000Z");
    expect(Date.parse(match.endTime!) - Date.parse(match.startTime!)).toBe(MATCH_DURATION_MS);
    expect(formatTime(match.startTime, match.timezone)).toBe("10.09.2026 20:00");
    expect(formatTime(match.endTime, match.timezone)).toBe("10.09.2026 21:00");
  });

  it("shows both schedule endpoints with team names and captain identifiers", () => {
    const match: MatchTable = { id: "m1", number: 1, tournamentId: "tr1", stage: "Основной этап", team1Id: "t1", team2Id: "t2", startTime: "2026-09-10T17:00:00.000Z", endTime: "2026-09-10T18:00:00.000Z", timezone: "Europe/Moscow", status: "scheduled" };
    const text = matchLine({ nextTeamNumber: 3, registrationPrice: 0, teamIds: ["t1", "t2"], teams: { t1: { id: "t1", uniqueId: 1, name: "Alpha", captainTelegramId: "11", captainContact: "", paid: true, status: "entered", players: [] }, t2: { id: "t2", uniqueId: 2, name: "Bravo", captainTelegramId: "22", captainContact: "", paid: true, status: "entered", players: [] } }, auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 2, tournaments: {}, tournamentIds: [], nextMatchNumber: 2, matches: { m1: match }, matchIds: ["m1"] }, match);
    expect(text).toContain("Команда 1 (капитан): Alpha (капитан: id11)");
    expect(text).toContain("Начало: 10.09.2026 20:00");
    expect(text).toContain("Окончание: 10.09.2026 21:00");
  });

  it("exports the date, start, and calculated end time for public consumers", () => {
    const match: MatchTable = { id: "m1", number: 1, tournamentId: "tr1", stage: "Основной этап", team1Id: "t1", startTime: "2026-09-10T17:00:00.000Z", endTime: "2026-09-10T18:00:00.000Z", timezone: "Europe/Moscow", status: "scheduled" };
    const rows = matchExportRows({ nextTeamNumber: 2, registrationPrice: 0, teamIds: ["t1"], teams: { t1: { id: "t1", uniqueId: 1, name: "Alpha", captainTelegramId: "11", captainContact: "", paid: true, status: "entered", players: [] } }, auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 2, tournaments: {}, tournamentIds: [], nextMatchNumber: 2, matches: { m1: match }, matchIds: ["m1"] });
    expect(rows[0]).toMatchObject({ date: "2026-09-10", start_time: "2026-09-10T17:00:00.000Z", end_time: "2026-09-10T18:00:00.000Z" });
    expect(formatTime(undefined, "Europe/Moscow")).toBe("Не назначено");
  });

  it("requires a date and valid 24-hour time, then schedules the remaining fixture", async () => {
    const priorAdmin = process.env.ADMIN_CHAT_ID;
    process.env.ADMIN_CHAT_ID = "1";
    const register = (name: string, prefix: string): BotSpec["steps"] => [
      { send: { callback: "register:start" }, expect: [] }, { send: { text: name }, expect: [] },
      { send: { text: `${prefix}1` }, expect: [] }, { send: { text: `${name} Captain` }, expect: [] }, { send: { text: `@${prefix}` }, expect: [] },
      ...[2, 3, 4, 5].flatMap((number) => [{ send: { text: `${prefix}${number}` }, expect: [] }, { send: { text: `${name} ${number}` }, expect: [] }]),
      { send: { callback: "register:preview" }, expect: [] }, { send: { callback: "register:confirm" }, expect: [] },
    ];
    const spec: BotSpec = { name: "admin scheduling flow", steps: [
      ...register("Alpha", "a"), ...register("Bravo", "b"), ...register("Charlie", "c"), ...register("Delta", "d"),
      { send: { callback: "admin:tournament:compose" }, expect: [] }, { send: { callback: "admin:tournament:confirm" }, expect: [] },
      { send: { callback: "admin:match:time:m1" }, expect: [{ method: "sendMessage", payload: { text: "Введите дату матча в формате YYYY-MM-DD. Время турнира — Москва (UTC+3)." } }] },
      { send: { text: "2026-09-10" }, expect: [{ method: "sendMessage", payload: { text: "Введите время начала в формате HH:MM, например 20:00." } }] },
      { send: { text: "8:00" }, expect: [{ method: "sendMessage", payload: { text: "Введите корректное время в формате HH:MM, например 20:00." } }] },
      { send: { text: "20:00" }, expect: [{ method: "sendMessage", payload: { text: "Расписание сохранено: 10.09.2026 20:00–10.09.2026 21:00. Следующим матчам назначено последовательное время: 1." } }] },
      { send: { callback: "matches:show" }, expect: [{ method: "editMessageText" }] },
    ] };
    try {
      const result = await runSpecs(() => buildBot("123456:TEST"), [spec]);
      expect(result.failed, formatSuiteResult(result)).toBe(0);
    } finally {
      if (priorAdmin === undefined) delete process.env.ADMIN_CHAT_ID;
      else process.env.ADMIN_CHAT_ID = priorAdmin;
    }
  });
});
