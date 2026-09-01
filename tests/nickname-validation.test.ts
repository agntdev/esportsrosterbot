import { describe, expect, it } from "vitest";
import { levenshtein, nicknameSimilar, normalizeNickname } from "../src/tournament-store.js";

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
});
