import type { Ctx } from "./bot.js";

export type Player = { inGameId: string; nickname: string; isSubstitute: boolean };
export type TeamStatus = "awaiting_payment" | "confirmed" | "pending_conflict" | "needs_correction" | "rejected";
export type Team = {
  id: string;
  /** Human-facing, immutable tournament number. */
  uniqueId: number;
  name: string;
  captainTelegramId: string;
  captainContact: string;
  paid: boolean;
  matchLink?: string;
  matchStatus?: "pending" | "won" | "lost";
  status: TeamStatus;
  players: Player[];
};
export type NameSubject = "team" | "player";
export type NameReview = { id: string; requestedBy: string; candidate: string; subject: NameSubject; status: "pending" | "approved" | "rejected" };
export type AuditEvent = { at: number; type: "team_created" | "admin_notified" | "name_review_requested" | "name_override_approved" | "name_override_rejected"; teamId?: string; reviewId?: string };
export type TournamentData = { nextTeamNumber: number; registrationPrice: number; teamIds: string[]; teams: Record<string, Team>; auditEvents: AuditEvent[]; nextNameReviewNumber: number; nameReviews: Record<string, NameReview>; nameReviewIds: string[]; nameOverrides: Array<{ normalized: string; subject: NameSubject }> };

const initial = (): TournamentData => ({ nextTeamNumber: 1, registrationPrice: 0, teamIds: [], teams: {}, auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [] });
let clock: () => number = () => Date.now();

/** Single injectable clock seam for generated default names and future cutoffs. */
export function now(): number { return clock(); }
export function setNowForTests(value: (() => number) | undefined): void { clock = value ?? (() => Date.now()); }
type DataStub = { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> };
type DataEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): DataStub } };

function envFor(ctx: Ctx): DataEnv | undefined {
  return (ctx as Ctx & { env?: DataEnv }).env;
}

export async function readTournament(ctx: Ctx): Promise<TournamentData> {
  const ns = envFor(ctx)?.CHAT_DO;
  if (ns) {
    const response = await ns.get(ns.idFromName("tournament:data")).fetch("https://do/tournament", { method: "GET" });
    if (response.ok) return normalize(await response.json());
  }
  const value = ctx.session.tournamentData;
  return value && typeof value === "object" ? normalize(value) : initial();
}

function normalize(value: unknown): TournamentData {
  const data = value as Partial<TournamentData>;
  const storedTeams = data.teams ?? {};
  const ids = data.teamIds ?? [];
  // Older records predate `uniqueId`. Assign a stable number once and persist
  // it on the next write; explicit indexes mean this never needs a key scan.
  const used = new Set<number>();
  for (const id of ids) {
    const value = storedTeams[id] as Partial<Team> | undefined;
    if (Number.isInteger(value?.uniqueId) && (value?.uniqueId ?? 0) > 0) used.add(value!.uniqueId!);
  }
  let next = Math.max(data.nextTeamNumber ?? 1, ...used, 0) + (used.has(data.nextTeamNumber ?? 1) ? 1 : 0);
  for (const id of ids) {
    const team = storedTeams[id] as Partial<Team> | undefined;
    if (team && (!Number.isInteger(team.uniqueId) || (team.uniqueId ?? 0) < 1)) {
      while (used.has(next)) next += 1;
      (team as Team).uniqueId = next;
      used.add(next);
      next += 1;
    }
  }
  const highest = Math.max(...used, 0);
  return {
    nextTeamNumber: Math.max(data.nextTeamNumber ?? 1, highest + 1),
    registrationPrice: data.registrationPrice ?? 0,
    teamIds: ids,
    teams: storedTeams as Record<string, Team>,
    auditEvents: data.auditEvents ?? [],
    nextNameReviewNumber: data.nextNameReviewNumber ?? 1,
    nameReviews: data.nameReviews ?? {},
    nameReviewIds: data.nameReviewIds ?? [],
    nameOverrides: data.nameOverrides ?? [],
  };
}

/** Consistent identity for every user-facing team display. */
export function teamIdentity(team: Pick<Team, "uniqueId" | "name">): string {
  return `🏆 Команда #${team.uniqueId} — ${team.name}`;
}

export function teamHeader(team: Pick<Team, "uniqueId" | "name">): string {
  return teamIdentity(team);
}

/** Keeps a small, durable audit trail without enumerating the store. */
export function logEvent(data: TournamentData, type: AuditEvent["type"], teamId?: string, reviewId?: string): void {
  data.auditEvents.push({ at: now(), type, ...(teamId ? { teamId } : {}), ...(reviewId ? { reviewId } : {}) });
  if (data.auditEvents.length > 200) data.auditEvents.splice(0, data.auditEvents.length - 200);
}

export async function writeTournament(ctx: Ctx, data: TournamentData): Promise<void> {
  // Persist migrations too: callers may have loaded legacy records before
  // changing another tournament setting.
  const normalized = normalize(data);
  const ns = envFor(ctx)?.CHAT_DO;
  if (ns) {
    const response = await ns.get(ns.idFromName("tournament:data")).fetch("https://do/tournament", {
      method: "PUT", body: JSON.stringify(normalized),
    });
    if (!response.ok) throw new Error("Tournament records could not be saved.");
    return;
  }
  ctx.session.tournamentData = normalized;
}

export function teams(data: TournamentData): Team[] {
  return data.teamIds.map((id) => data.teams[id]).filter((team): team is Team => Boolean(team));
}

export function conflicts(data: TournamentData, team: Team): Team[] {
  const ids = new Set(team.players.map((player) => player.inGameId.toLowerCase()));
  return teams(data).filter((other) => other.id !== team.id && other.status !== "rejected" && other.players.some((p) => ids.has(p.inGameId.toLowerCase())));
}

/** Removes cosmetic differences before tournament nickname comparisons. */
export function normalizeNickname(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}_-]/gu, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

export function nicknameSimilar(a: string, b: string): boolean {
  const left = normalizeNickname(a); const right = normalizeNickname(b);
  if (!left || !right) return false;
  const distance = levenshtein(left, right); const longest = Math.max(left.length, right.length);
  return longest <= 4 ? distance <= 1 : 1 - distance / longest >= 0.8;
}

export function nicknameConflict(data: TournamentData, candidate: string, subject: NameSubject, excludeTeamId?: string, localNames: string[] = []): boolean {
  const normalized = normalizeNickname(candidate);
  if (!normalized || data.nameOverrides.some((item) => item.subject === subject && item.normalized === normalized)) return false;
  const existing = subject === "team"
    ? teams(data).filter((team) => team.id !== excludeTeamId && team.status !== "rejected").map((team) => team.name)
    : teams(data).filter((team) => team.id !== excludeTeamId && team.status !== "rejected").flatMap((team) => team.players.map((player) => player.nickname));
  return [...existing, ...localNames].some((name) => nicknameSimilar(candidate, name));
}

export function createNameReview(data: TournamentData, requestedBy: string, candidate: string, subject: NameSubject): NameReview {
  const id = `n${data.nextNameReviewNumber++}`;
  const review: NameReview = { id, requestedBy, candidate, subject, status: "pending" };
  data.nameReviewIds.push(id); data.nameReviews[id] = review; logEvent(data, "name_review_requested", undefined, id);
  return review;
}
