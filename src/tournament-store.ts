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
export type AuditEvent = { at: number; type: "team_created" | "admin_notified"; teamId: string };
export type TournamentData = { nextTeamNumber: number; registrationPrice: number; teamIds: string[]; teams: Record<string, Team>; auditEvents: AuditEvent[] };

const initial = (): TournamentData => ({ nextTeamNumber: 1, registrationPrice: 0, teamIds: [], teams: {}, auditEvents: [] });
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
  };
}

/** Consistent identity for every user-facing team display. */
export function teamIdentity(team: Pick<Team, "uniqueId" | "name">): string {
  return `🏆 Team #${team.uniqueId} — ${team.name}`;
}

export function teamHeader(team: Pick<Team, "uniqueId" | "name">): string {
  return teamIdentity(team);
}

/** Keeps a small, durable audit trail without enumerating the store. */
export function logEvent(data: TournamentData, type: AuditEvent["type"], teamId: string): void {
  data.auditEvents.push({ at: now(), type, teamId });
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
