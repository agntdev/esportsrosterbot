import { describe, expect, it } from "vitest";
import { levenshtein, nicknameConflict, nicknameSimilar, normalizeNickname, type TournamentData } from "../src/tournament-store.js";

describe("tournament nickname validation", () => {
  it("normalizes exact duplicates including diacritics and punctuation", () => {
    expect(normalizeNickname("  Nórth-Wínd! ")).toBe(normalizeNickname("north-wind"));
    expect(nicknameSimilar("Nórth Wind", "northwind")).toBe(true);
  });

  it("uses distance one for short nicknames", () => {
    expect(nicknameSimilar("Ace", "Axe")).toBe(true);
    expect(nicknameSimilar("Ace", "Azz")).toBe(false);
  });

  it("blocks similarity at the 0.8 threshold but not below it", () => {
    expect(levenshtein("northwind", "northwint")).toBe(1);
    expect(nicknameSimilar("northwind", "northwint")).toBe(true);
    expect(nicknameSimilar("northwind", "noxthxndz")).toBe(false);
  });

  it("does not treat unregistered or merely similar nicknames as a conflict", () => {
    const data: TournamentData = {
      nextTeamNumber: 2, registrationPrice: 0, teamIds: ["t1"], auditEvents: [], nextNameReviewNumber: 1,
      nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 1, tournaments: {}, tournamentIds: [],
      teams: { t1: { id: "t1", uniqueId: 1, name: "Alpha", captainTelegramId: "1", captainContact: "@alpha", paid: true, status: "confirmed", players: [{ inGameId: "one", nickname: "dim", isSubstitute: false }] } },
    };
    expect(nicknameConflict(data, "dima", "player")).toBe(false);
    expect(nicknameConflict(data, "new-player", "player")).toBe(false);
    expect(nicknameConflict(data, "dim", "player")).toBe(true);
  });
});
