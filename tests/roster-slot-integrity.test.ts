import { describe, expect, it } from "vitest";
import { applyRosterSlotUpdate, type TournamentData } from "../src/tournament-store.js";

function data(): TournamentData {
  return {
    nextTeamNumber: 2, registrationPrice: 0, teamIds: ["t1"], auditEvents: [],
    nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [],
    nextTournamentNumber: 1, tournaments: {}, tournamentIds: [],
    teams: {
      t1: {
        id: "t1", uniqueId: 1, name: "Northwind", captainTelegramId: "1", captainContact: "@northwind", paid: true, status: "confirmed",
        players: [
          { inGameId: "p1", nickname: "One", isSubstitute: false },
          { inGameId: "p2", nickname: "Two", isSubstitute: false },
          { inGameId: "p3", nickname: "Three", isSubstitute: false },
          { inGameId: "p4", nickname: "Four", isSubstitute: false },
          { inGameId: "p5", nickname: "Five", isSubstitute: false },
          { inGameId: "s1", nickname: "Sub", isSubstitute: true },
        ],
      },
    },
  };
}

describe("roster slot integrity", () => {
  it("clears and replaces slot zero without shifting slot one", () => {
    const tournament = data();
    applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 0 });
    expect(tournament.teams.t1.players[0]).toMatchObject({ inGameId: "", nickname: "", isSubstitute: false });
    expect(tournament.teams.t1.players[1]).toMatchObject({ inGameId: "p2", nickname: "Two" });
    expect(tournament.teams.t1.status).toBe("needs_correction");

    applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 0, player: { inGameId: "new1", nickname: "New One", isSubstitute: false } });
    expect(tournament.teams.t1.players.map((player) => player.inGameId)).toEqual(["new1", "p2", "p3", "p4", "p5", "s1"]);
    expect(tournament.teams.t1.status).toBe("confirmed");
  });

  it("rejects a duplicate ID without changing the intended slot", () => {
    const tournament = data();
    expect(() => applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 0, player: { inGameId: "p2", nickname: "Duplicate", isSubstitute: false } })).toThrow("already on the roster");
    expect(tournament.teams.t1.players[0].inGameId).toBe("p1");
    expect(tournament.teams.t1.players[1].inGameId).toBe("p2");
  });

  it("keeps adjacent slots stable through rapid successive replacements", () => {
    const tournament = data();
    applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 0, player: { inGameId: "first", nickname: "First", isSubstitute: false } });
    applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 1, player: { inGameId: "second", nickname: "Second", isSubstitute: false } });
    applyRosterSlotUpdate(tournament, { teamId: "t1", slot: 0, player: { inGameId: "latest", nickname: "Latest", isSubstitute: false } });
    expect(tournament.teams.t1.players.map((player) => player.inGameId)).toEqual(["latest", "second", "p3", "p4", "p5", "s1"]);
  });
});
