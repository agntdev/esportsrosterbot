import { describe, expect, it } from "vitest";
import { advanceMatchWinner, createTournament, resolveBracketByes, type Team, type TournamentData } from "../src/tournament-store.js";

function team(id: string, uniqueId: number): Team {
  return { id, uniqueId, name: `Team ${uniqueId}`, captainTelegramId: String(uniqueId), captainContact: "", paid: true, status: "confirmed", players: [{ inGameId: `${id}1`, nickname: id, isSubstitute: false }, { inGameId: `${id}2`, nickname: `${id}2`, isSubstitute: false }, { inGameId: `${id}3`, nickname: `${id}3`, isSubstitute: false }, { inGameId: `${id}4`, nickname: `${id}4`, isSubstitute: false }, { inGameId: `${id}5`, nickname: `${id}5`, isSubstitute: false }] };
}

function dataWith(count: number): TournamentData {
  const entries = Array.from({ length: count }, (_, index) => team(`t${index + 1}`, index + 1));
  return { nextTeamNumber: count + 1, registrationPrice: 0, teamIds: entries.map((item) => item.id), teams: Object.fromEntries(entries.map((item) => [item.id, item])), auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 1, tournaments: {}, tournamentIds: [], nextMatchNumber: 1, matches: {}, matchIds: [] };
}

describe("single-elimination bracket progression", () => {
  it("creates and populates the next slot through the final", () => {
    const data = dataWith(4); const tournament = createTournament(data, Object.values(data.teams), "1");
    const first = data.matches.m1; const second = data.matches.m2;
    const firstAdvance = advanceMatchWinner(data, first, "t1").advanced[0].nextMatch;
    expect(firstAdvance).toMatchObject({ bracketRound: 2, bracketSlot: 0, team1Id: "t1", status: "scheduled" });
    advanceMatchWinner(data, second, "t3");
    expect(firstAdvance).toMatchObject({ team2Id: "t3" });
    advanceMatchWinner(data, firstAdvance!, "t1");
    expect(tournament.status).toBe("completed");
  });

  it("automatically advances a bye in an odd bracket", () => {
    const data = dataWith(5); const tournament = createTournament(data, Object.values(data.teams), "1");
    const advances = resolveBracketByes(data, tournament);
    expect(data.matches.m3.status).toBe("completed");
    expect(advances.map((item) => item.teamId)).toContain("t5");
    expect(advances[0].nextMatch?.bracketRound).toBe(2);
  });
});
