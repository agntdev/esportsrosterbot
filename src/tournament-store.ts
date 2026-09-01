import type { Ctx } from "./bot.js";

export type Player = { inGameId: string; nickname: string; isSubstitute: boolean };
export type TeamStatus = "awaiting_payment" | "confirmed" | "pending_conflict" | "needs_correction" | "rejected" | "entered";
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
  /** Set once a team is included in a published tournament. */
  tournamentId?: string;
  rosterLocked?: boolean;
  /** IDs an organizer explicitly allowed to be shared by the affected teams. */
  allowedDuplicateIds?: string[];
  status: TeamStatus;
  players: Player[];
};
export type NameSubject = "team" | "player";
export type NameReview = { id: string; requestedBy: string; candidate: string; subject: NameSubject; status: "pending" | "approved" | "rejected" };
export type Tournament = { id: string; teamIds: string[]; createdAt: number; createdBy: string; status: "active" };
export type AuditEvent = { at: number; type: "team_created" | "admin_notified" | "name_review_requested" | "name_override_approved" | "name_override_rejected" | "tournament_created" | "conflict_resolved"; teamId?: string; reviewId?: string; tournamentId?: string; adminId?: string; resolution?: "team1" | "team2" | "both"; relatedTeamIds?: string[] };
export type TournamentData = { nextTeamNumber: number; registrationPrice: number; teamIds: string[]; teams: Record<string, Team>; auditEvents: AuditEvent[]; nextNameReviewNumber: number; nameReviews: Record<string, NameReview>; nameReviewIds: string[]; nameOverrides: Array<{ normalized: string; subject: NameSubject }>; nextTournamentNumber: number; tournaments: Record<string, Tournament>; tournamentIds: string[] };
export type RosterSlotUpdate = { teamId: string; slot: number; player?: Player };

const initial = (): TournamentData => ({ nextTeamNumber: 1, registrationPrice: 0, teamIds: [], teams: {}, auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 1, tournaments: {}, tournamentIds: [] });
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
    nextTournamentNumber: data.nextTournamentNumber ?? 1,
    tournaments: data.tournaments ?? {},
    tournamentIds: data.tournamentIds ?? [],
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

/**
 * Changes exactly one roster position. The Workers path is a single Durable
 * Object request, so two quick taps cannot turn a slot-zero replacement into
 * an insertion at slot one or leave a stale player behind.
 */
export async function updateRosterSlot(ctx: Ctx, update: RosterSlotUpdate): Promise<TournamentData> {
  const ns = envFor(ctx)?.CHAT_DO;
  if (ns) {
    const response = await ns.get(ns.idFromName("tournament:data")).fetch("https://do/tournament/roster-slot", {
      method: "POST", body: JSON.stringify(update),
    });
    if (!response.ok) throw new Error("Roster slot could not be saved.");
    return normalize(await response.json());
  }
  const data = await readTournament(ctx);
  applyRosterSlotUpdate(data, update);
  await writeTournament(ctx, data);
  return data;
}

/** Shared by the Durable Object and harness fallback; indexes are always zero-based. */
export function applyRosterSlotUpdate(data: TournamentData, update: RosterSlotUpdate): void {
  const team = data.teams[update.teamId];
  if (!team || !Number.isInteger(update.slot) || update.slot < 0 || update.slot >= team.players.length) {
    throw new Error("Roster slot is unavailable.");
  }
  const player = update.player;
  if (player) {
    const id = player.inGameId.trim().toLocaleLowerCase();
    if (!id || !player.nickname.trim()) throw new Error("Player details are incomplete.");
    if (team.players.some((current, index) => index !== update.slot && current.inGameId.trim().toLocaleLowerCase() === id)) {
      throw new Error("This Game ID is already on the roster.");
    }
    // Assign rather than splice: slot 0 remains slot 0 for every replacement.
    team.players[update.slot] = { inGameId: player.inGameId.trim(), nickname: player.nickname.trim(), isSubstitute: update.slot >= 5 };
  } else {
    // Preserve the position instead of shifting later players left.
    team.players[update.slot] = { inGameId: "", nickname: "", isSubstitute: update.slot >= 5 };
  }
  const complete = team.players.slice(0, 5).every((current) => current.inGameId.trim() && current.nickname.trim());
  team.status = complete ? (conflicts(data, team).length ? "pending_conflict" : "confirmed") : "needs_correction";
}

export function teams(data: TournamentData): Team[] {
  return data.teamIds.map((id) => data.teams[id]).filter((team): team is Team => Boolean(team));
}

/** The currently published tournament, if the organizer has assembled one. */
export function activeTournament(data: TournamentData): Tournament | undefined {
  return [...data.tournamentIds].reverse().map((id) => data.tournaments[id]).find((tournament) => tournament?.status === "active");
}

/** Entry criteria are deliberately centralized so preview and confirmation agree. */
export function eligibleTeams(data: TournamentData): Team[] {
  return teams(data).filter((team) =>
    team.status === "confirmed" &&
    !team.rosterLocked &&
    team.players.filter((player) => !player.isSubstitute).length === 5 &&
    team.players.filter((player) => player.isSubstitute).length <= 2 &&
    conflicts(data, team).length === 0,
  );
}

export function createTournament(data: TournamentData, selected: Team[], adminId: string): Tournament {
  const id = `tr${data.nextTournamentNumber++}`;
  const tournament: Tournament = { id, teamIds: selected.map((team) => team.id), createdAt: now(), createdBy: adminId, status: "active" };
  data.tournamentIds.push(id);
  data.tournaments[id] = tournament;
  for (const team of selected) {
    team.status = "entered";
    team.tournamentId = id;
    team.rosterLocked = true;
    team.matchStatus = "pending";
  }
  data.auditEvents.push({ at: tournament.createdAt, type: "tournament_created", tournamentId: id, adminId });
  if (data.auditEvents.length > 200) data.auditEvents.splice(0, data.auditEvents.length - 200);
  return tournament;
}

export function conflicts(data: TournamentData, team: Team): Team[] {
  const ids = new Set((team.players ?? []).map((player) => stringField(player?.inGameId).toLocaleLowerCase()).filter(Boolean));
  if (ids.size === 0) return [];
  return teams(data).filter((other) => other.id !== team.id && other.status !== "rejected" && (other.players ?? []).some((p) => {
    const id = stringField(p?.inGameId).toLocaleLowerCase();
    return Boolean(id) && ids.has(id) && !isAllowedDuplicate(team, other, id);
  }));
}

function isAllowedDuplicate(team: Team, other: Team, id: string): boolean {
  return (team.allowedDuplicateIds ?? []).includes(id) && (other.allowedDuplicateIds ?? []).includes(id);
}

/** Records an intentional shared ID on every affected roster. */
export function allowDuplicateIds(affected: Team[], ids: string[]): void {
  const normalized = [...new Set(ids.map((id) => stringField(id).toLocaleLowerCase()).filter(Boolean))];
  for (const team of affected) {
    const allowed = new Set((team.allowedDuplicateIds ?? []).map((id) => id.toLocaleLowerCase()));
    for (const id of normalized) allowed.add(id);
    team.allowedDuplicateIds = [...allowed];
  }
}

/** Removes cosmetic differences before tournament nickname comparisons. */
function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeNickname(value: unknown): string {
  return stringField(value).toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}_-]/gu, "");
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

/**
 * A roster is the registration record for a player: a previously unseen
 * nickname is valid input, not an error.  Only an exact normalized duplicate
 * already stored in another submitted team needs organizer review.  This
 * deliberately avoids fuzzy matches such as "dim" and "dima".
 */
export function nicknameConflict(data: TournamentData, candidate: string, subject: NameSubject, excludeTeamId?: string, localNames: string[] = []): boolean {
  const normalized = normalizeNickname(candidate);
  const overrides = Array.isArray(data.nameOverrides) ? data.nameOverrides : [];
  if (!normalized || overrides.some((item) => item?.subject === subject && normalizeNickname(item?.normalized) === normalized)) return false;
  const existing = subject === "team"
    ? teams(data).filter((team) => team.id !== excludeTeamId && team.status !== "rejected").map((team) => stringField(team.name))
    : teams(data).filter((team) => team.id !== excludeTeamId && team.status !== "rejected").flatMap((team) => (team.players ?? []).map((player) => stringField(player?.nickname)));
  const names = [...existing, ...localNames].map(normalizeNickname).filter(Boolean);
  if (!names.includes(normalized)) {
    // Do not include the nickname itself: this records lookup misses without
    // retaining player data in logs.
    console.info("[tournament] nickname lookup found no registered record");
    return false;
  }
  return true;
}

export function createNameReview(data: TournamentData, requestedBy: string, candidate: string, subject: NameSubject): NameReview {
  const id = `n${data.nextNameReviewNumber++}`;
  const review: NameReview = { id, requestedBy, candidate, subject, status: "pending" };
  data.nameReviewIds.push(id); data.nameReviews[id] = review; logEvent(data, "name_review_requested", undefined, id);
  return review;
}
