import { describe, expect, it } from "vitest";
import { rosterCard } from "../src/handlers/tournament-table.js";
import type { Team, TournamentData } from "../src/tournament-store.js";

function dataWith(team: Team, other?: Team): TournamentData {
  const all = [team, ...(other ? [other] : [])];
  return {
    nextTeamNumber: 3, registrationPrice: 0, teamIds: all.map((item) => item.id),
    teams: Object.fromEntries(all.map((item) => [item.id, item])), auditEvents: [],
    nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [],
    nextTournamentNumber: 1, tournaments: {}, tournamentIds: [],
  };
}

describe("tournament roster cards", () => {
  it("keeps five starter positions, two substitutes, and conflict flags readable", () => {
    const team: Team = {
      id: "t1", uniqueId: 1, name: "Northwind", captainTelegramId: "101", captainContact: "@northwind", paid: true, status: "entered",
      players: [
        { nickname: "Nova", inGameId: "n1", isSubstitute: false },
        { nickname: "Orbit", inGameId: "n2", isSubstitute: false },
        { nickname: "Apex", inGameId: "n3", isSubstitute: false },
        { nickname: "", inGameId: "", isSubstitute: false },
        { nickname: "", inGameId: "", isSubstitute: false },
        { nickname: "Reserve", inGameId: "s1", isSubstitute: true },
      ],
    };
    const other: Team = { ...team, id: "t2", uniqueId: 2, name: "Rivals", captainTelegramId: "202", players: [{ nickname: "Else", inGameId: "n2", isSubstitute: false }] };
    expect(rosterCard(dataWith(team, other), team)).toBe("Team: Northwind\nCaptain: Nova (ID: n1)\nStarters:\n1. Nova (n1)\n2. Orbit (n2) ⚠️ ID conflict\n3. Apex (n3)\n4. Empty slot\n5. Empty slot\nSubs:\n- Sub1: Reserve (s1)\n- Sub2: Empty slot");
  });

  it("marks overflow roster entries as unassigned only in the expanded card", () => {
    const team: Team = {
      id: "t1", uniqueId: 1, name: "Overflow", captainTelegramId: "101", captainContact: "", paid: true, status: "entered",
      players: Array.from({ length: 8 }, (_, index) => ({ nickname: `P${index + 1}`, inGameId: `p${index + 1}`, isSubstitute: index >= 5 })),
    };
    expect(rosterCard(dataWith(team), team)).not.toContain("P8");
    expect(rosterCard(dataWith(team), team, true)).toContain("- Extra: P8 (p8)");
  });
});
