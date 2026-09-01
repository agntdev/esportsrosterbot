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
export type Tournament = { id: string; teamIds: string[]; createdAt: number; createdBy: string; status: "ready" | "in_progress" | "completed" | "active"; bracketSize?: number; bracketRounds?: number };
export type MatchStatus = "scheduled" | "in_progress" | "completed";
/** A pairing is stored once, rather than duplicated on each team. */
export type MatchTable = {
  id: string;
  number: number;
  tournamentId: string;
  stage: string;
  team1Id: string;
  team2Id?: string;
  /** ISO8601 UTC timestamps. `scheduledTime` is retained only to migrate old records. */
  startTime?: string;
  endTime?: string;
  scheduledTime?: number;
  timezone: string;
  serverLink?: string;
  status: MatchStatus;
  result?: string;
  winnerTeamId?: string;
  /** Position in a single-elimination bracket. Old fixtures are round one. */
  bracketRound?: number;
  bracketSlot?: number;
};
export type AuditEvent = { at: number; type: "team_created" | "admin_notified" | "name_review_requested" | "name_override_approved" | "name_override_rejected" | "tournament_created" | "conflict_resolved"; teamId?: string; reviewId?: string; tournamentId?: string; adminId?: string; resolution?: "team1" | "team2" | "both"; relatedTeamIds?: string[] };
export type TournamentData = { nextTeamNumber: number; registrationPrice: number; teamIds: string[]; teams: Record<string, Team>; auditEvents: AuditEvent[]; nextNameReviewNumber: number; nameReviews: Record<string, NameReview>; nameReviewIds: string[]; nameOverrides: Array<{ normalized: string; subject: NameSubject }>; nextTournamentNumber: number; tournaments: Record<string, Tournament>; tournamentIds: string[]; nextMatchNumber: number; matches: Record<string, MatchTable>; matchIds: string[] };
export type RosterSlotUpdate = { teamId: string; slot: number; player?: Player };

const initial = (): TournamentData => ({ nextTeamNumber: 1, registrationPrice: 0, teamIds: [], teams: {}, auditEvents: [], nextNameReviewNumber: 1, nameReviews: {}, nameReviewIds: [], nameOverrides: [], nextTournamentNumber: 1, tournaments: {}, tournamentIds: [], nextMatchNumber: 1, matches: {}, matchIds: [] });
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
  const storedMatches = data.matches ?? {};
  const storedMatchIds = data.matchIds ?? [];
  // Older deployments used a local epoch field. Convert it once so every new
  // scheduling path has an explicit, portable start and end time.
  for (const matchId of storedMatchIds) {
    const match = storedMatches[matchId];
    if (match?.scheduledTime && !match.startTime) {
      match.startTime = new Date(match.scheduledTime).toISOString();
      match.endTime = new Date(match.scheduledTime + 60 * 60 * 1000).toISOString();
    }
  }
  let nextMatchNumber = data.nextMatchNumber ?? 1;
  for (const matchId of storedMatchIds) nextMatchNumber = Math.max(nextMatchNumber, (storedMatches[matchId]?.number ?? 0) + 1);
  // Migration for tournaments created before pairings were introduced.  The
  // explicit tournament team index lets this be deterministic without a scan.
  for (const tournamentId of data.tournamentIds ?? []) {
    const tournament = data.tournaments?.[tournamentId];
    if (!tournament || storedMatchIds.some((matchId) => storedMatches[matchId]?.tournamentId === tournamentId)) continue;
    for (let index = 0; index < tournament.teamIds.length; index += 2) {
      const number = nextMatchNumber++;
      const match: MatchTable = { id: `m${number}`, number, tournamentId, stage: "Основной этап", team1Id: tournament.teamIds[index], team2Id: tournament.teamIds[index + 1], timezone: "Europe/Moscow", status: "scheduled" };
      storedMatchIds.push(match.id); storedMatches[match.id] = match;
    }
  }
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
    nextMatchNumber,
    matches: storedMatches,
    matchIds: storedMatchIds,
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

/** Arms Worker alarms for scheduled fixtures. Reading the table still reconciles
 * state, so an unavailable alarm never leaves a tournament stuck. */
export async function scheduleTournamentStartEvents(ctx: Ctx, matches: MatchTable[]): Promise<void> {
  const ns = envFor(ctx)?.CHAT_DO;
  if (!ns) return;
  try {
    await ns.get(ns.idFromName("tournament:data")).fetch("https://do/tournament/schedule", {
      method: "POST",
      body: JSON.stringify(matches
        .filter((match) => match.status === "scheduled" && matchStartEpoch(match) !== undefined)
        .map((match) => ({ matchId: match.id, at: matchStartEpoch(match) }))),
    });
  } catch {
    // Table reads provide the durable fallback if the alarm service is briefly unavailable.
  }
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
      throw new Error("Игровой ID уже есть в составе.");
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
  // The completed bracket remains the public tournament table and must not be
  // mistaken for an absent tournament (which would allow an accidental second
  // composition after a one-team/bye bracket finishes).
  return [...data.tournamentIds].reverse().map((id) => data.tournaments[id]).find((tournament) => tournament && (tournament.status === "ready" || tournament.status === "in_progress" || tournament.status === "active" || tournament.status === "completed"));
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
  const bracketSize = nextBracketSize(selected.length);
  const bracketRounds = bracketSize > 1 ? Math.ceil(Math.log2(bracketSize)) : 0;
  const tournament: Tournament = { id, teamIds: selected.map((team) => team.id), createdAt: now(), createdBy: adminId, status: "ready", bracketSize, bracketRounds };
  data.tournamentIds.push(id);
  data.tournaments[id] = tournament;
  for (const team of selected) {
    team.status = "entered";
    team.tournamentId = id;
    team.rosterLocked = true;
    team.matchStatus = "pending";
  }
  // Pair teams in their stable registration order. An unpaired team is shown
  // as a bye, never silently dropped from the public table.
  for (let index = 0; index < selected.length; index += 2) {
    const number = data.nextMatchNumber++;
    const match: MatchTable = {
      id: `m${number}`,
      number,
      tournamentId: id,
      stage: stageName(1, bracketRounds),
      team1Id: selected[index].id,
      team2Id: selected[index + 1]?.id,
      timezone: "Europe/Moscow",
      status: "scheduled",
      bracketRound: 1,
      bracketSlot: Math.floor(index / 2),
    };
    data.matchIds.push(match.id);
    data.matches[match.id] = match;
  }
  data.auditEvents.push({ at: tournament.createdAt, type: "tournament_created", tournamentId: id, adminId });
  if (data.auditEvents.length > 200) data.auditEvents.splice(0, data.auditEvents.length - 200);
  return tournament;
}

function nextBracketSize(count: number): number {
  let size = 1;
  while (size < Math.max(1, count)) size *= 2;
  return size;
}

export function stageName(round: number, totalRounds: number): string {
  const remaining = totalRounds - round + 1;
  if (remaining === 1) return "Финал";
  if (remaining === 2) return "Полуфинал";
  if (remaining === 3) return "Четвертьфинал";
  if (remaining === 4) return "Раунд 1/8 финала";
  return `Раунд ${round}`;
}

function tournamentRounds(tournament: Tournament): number {
  return tournament.bracketRounds ?? (tournament.teamIds.length > 1 ? Math.ceil(Math.log2(nextBracketSize(tournament.teamIds.length))) : 0);
}

function matchRound(match: MatchTable): number { return match.bracketRound ?? 1; }
function matchSlot(match: MatchTable): number { return match.bracketSlot ?? Math.max(0, match.number - 1); }

/** Adds a winner to the correct next bracket slot and schedules that fixture.
 * It returns every auto-advance (including byes) so the caller can notify captains. */
export function advanceMatchWinner(data: TournamentData, match: MatchTable, winnerId: string): { advanced: Array<{ teamId: string; nextMatch?: MatchTable }>; completed: boolean } {
  const tournament = data.tournaments[match.tournamentId];
  if (!tournament || !data.teams[winnerId]) return { advanced: [], completed: false };
  match.winnerTeamId = winnerId;
  match.result = `Победитель: ${data.teams[winnerId].name}`;
  match.status = "completed";
  const advanced: Array<{ teamId: string; nextMatch?: MatchTable }> = [];
  advance(data, tournament, match, winnerId, advanced);
  return { advanced, completed: tournament.status === "completed" };
}

function advance(data: TournamentData, tournament: Tournament, source: MatchTable, winnerId: string, advanced: Array<{ teamId: string; nextMatch?: MatchTable }>): void {
  const round = matchRound(source); const total = tournamentRounds(tournament);
  if (round >= total || total === 0) { tournament.status = "completed"; return; }
  const parentRound = round + 1; const parentSlot = Math.floor(matchSlot(source) / 2);
  let parent = tournamentMatches(data, tournament.id).find((item) => matchRound(item) === parentRound && matchSlot(item) === parentSlot);
  if (!parent) {
    const number = data.nextMatchNumber++;
    parent = { id: `m${number}`, number, tournamentId: tournament.id, stage: stageName(parentRound, total), team1Id: winnerId, timezone: source.timezone || "Europe/Moscow", status: "scheduled", bracketRound: parentRound, bracketSlot: parentSlot };
    const base = matchStartEpoch(source) ?? now();
    scheduleMatch(parent, new Date(base + MATCH_DURATION_MS).toISOString());
    data.matchIds.push(parent.id); data.matches[parent.id] = parent;
  } else if (!parent.team1Id) parent.team1Id = winnerId;
  else if (!parent.team2Id && parent.team1Id !== winnerId) parent.team2Id = winnerId;
  advanced.push({ teamId: winnerId, nextMatch: parent });
  // A branch with no registered entrant is a bye. Continue immediately so odd
  // brackets never strand a captain waiting for a match that cannot exist.
  if (!parent.team2Id && siblingBranchEmpty(tournament, parentRound, parentSlot, matchSlot(source) % 2)) {
    parent.winnerTeamId = parent.team1Id;
    parent.result = `Победитель по bye: ${data.teams[parent.team1Id]?.name ?? "команда"}`;
    parent.status = "completed";
    advance(data, tournament, parent, parent.team1Id, advanced);
  }
}

function siblingBranchEmpty(tournament: Tournament, parentRound: number, parentSlot: number, sourceSide: number): boolean {
  const childRound = parentRound - 1;
  const siblingSlot = parentSlot * 2 + (sourceSide === 0 ? 1 : 0);
  const leavesPerChild = 2 ** childRound;
  const start = siblingSlot * leavesPerChild;
  return !tournament.teamIds.slice(start, start + leavesPerChild).length;
}

/** Resolves first-round byes after bracket creation. */
export function resolveBracketByes(data: TournamentData, tournament: Tournament): Array<{ teamId: string; nextMatch?: MatchTable }> {
  const advanced: Array<{ teamId: string; nextMatch?: MatchTable }> = [];
  for (const match of tournamentMatches(data, tournament.id).filter((item) => matchRound(item) === 1 && !item.team2Id && item.status !== "completed")) {
    advanceMatchWinner(data, match, match.team1Id).advanced.forEach((item) => advanced.push(item));
  }
  return advanced;
}

/** Starts a prepared tournament and gives every fixture a real, visible start time. */
export function startTournament(data: TournamentData, tournament: Tournament): MatchTable[] {
  if (tournament.status === "completed") return [];
  const base = now();
  const matches = tournamentMatches(data, tournament.id).sort((a, b) => a.number - b.number);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (matchStartEpoch(match) === undefined) scheduleMatch(match, new Date(base + index * MATCH_DURATION_MS).toISOString());
    if (match.status !== "completed") match.status = (matchStartEpoch(match) ?? Number.MAX_SAFE_INTEGER) <= base ? "in_progress" : "scheduled";
  }
  tournament.status = "in_progress";
  return matches;
}

/** Reconciles a match state when it is read, including after a Worker restart. */
export function refreshMatchStatuses(data: TournamentData): boolean {
  const instant = now();
  let changed = false;
  for (const match of tournamentMatches(data)) {
    if (match.status === "scheduled" && (matchStartEpoch(match) ?? Number.MAX_SAFE_INTEGER) <= instant) {
      match.status = "in_progress";
      changed = true;
    }
  }
  return changed;
}

export function tournamentMatches(data: TournamentData, tournamentId?: string): MatchTable[] {
  return data.matchIds.map((id) => data.matches[id]).filter((match): match is MatchTable => Boolean(match) && (!tournamentId || match.tournamentId === tournamentId));
}

export const MATCH_DURATION_MS = 60 * 60 * 1000;

/** Parses a Moscow tournament date and 24-hour time into an ISO UTC instant. */
export function parseMatchStart(date: string, time: string): string | undefined {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) return undefined;
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const local = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() !== Number(month) - 1 || local.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59) return undefined;
  // Europe/Moscow is UTC+3 and has no daylight-saving transition.
  return new Date(local.getTime() - 3 * 60 * 60 * 1000).toISOString();
}

export function matchStartEpoch(match: MatchTable): number | undefined {
  if (match.startTime) { const value = Date.parse(match.startTime); if (!Number.isNaN(value)) return value; }
  return match.scheduledTime;
}

export function scheduleMatch(match: MatchTable, startTime: string): void {
  const start = Date.parse(startTime);
  if (Number.isNaN(start)) throw new Error("Match start time is invalid.");
  match.startTime = new Date(start).toISOString();
  match.endTime = new Date(start + MATCH_DURATION_MS).toISOString();
  // Preserve compatibility with legacy API consumers during rollout.
  match.scheduledTime = start;
}

export function captainIdentifier(team: Team): string {
  const contact = team.captainContact?.trim();
  return contact?.startsWith("@") ? contact : `id${team.captainTelegramId}`;
}

export function matchExportRows(data: TournamentData, tournamentId?: string): Array<Record<string, string | number>> {
  return tournamentMatches(data, tournamentId).map((match) => {
    const team1 = data.teams[match.team1Id]; const team2 = match.team2Id ? data.teams[match.team2Id] : undefined;
    const start = matchStartEpoch(match);
    const dateParts = start === undefined ? [] : new Intl.DateTimeFormat("en-CA", { timeZone: match.timezone || "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(start));
    const datePart = (type: string) => dateParts.find((part) => part.type === type)?.value ?? "";
    const date = start === undefined ? "" : `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
    return { team1_name: team1?.name ?? "", team1_captain_id: team1?.captainTelegramId ?? "", team2_name: team2?.name ?? "", team2_captain_id: team2?.captainTelegramId ?? "", date, start_time: match.startTime ?? "", end_time: match.endTime ?? "", timezone: match.timezone, status: match.status, result: match.result ?? "" };
  });
}

export function matchExportCsv(data: TournamentData, tournamentId?: string): string {
  const fields = ["team1_name", "team1_captain_id", "team2_name", "team2_captain_id", "date", "start_time", "end_time", "timezone", "status", "result"];
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return [fields.join(","), ...matchExportRows(data, tournamentId).map((row) => fields.map((field) => quote(row[field] ?? "")).join(","))].join("\n");
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
