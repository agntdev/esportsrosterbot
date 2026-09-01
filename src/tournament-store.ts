import type { Ctx } from "./bot.js";

export type TeamStatus = "PENDING" | "APPROVED" | "REJECTED" | "CONFLICTED" | "PLAYING" | "FINISHED";
export type Player = { fullName: string; inGameId: string; telegramUsername?: string; isSubstitute: boolean };
export type Team = { id: string; name: string; captainTelegramId: string; captainContact: string; status: TeamStatus; playerIds: string[]; matchIds: string[] };
export type Conflict = { id: string; inGameId: string; teamIds: string[]; status: "OPEN" | "RESOLVED"; createdAt: number };
export type Match = { id: string; teamAId: string; teamBId: string; link?: string; status: "SCHEDULED" | "LIVE" | "FINISHED"; scoreA: number; scoreB: number };
export type Audit = { at: number; actorId: string; action: string; targetId?: string };
export type Data = { nextTeam: number; nextConflict: number; nextMatch: number; teamIds: string[]; teams: Record<string, Team>; playerIds: string[]; players: Record<string, Player>; conflictIds: string[]; conflicts: Record<string, Conflict>; matchIds: string[]; matches: Record<string, Match>; users: Record<string, { role: "admin" | "captain" }>; audit: Audit[] };

let clock: () => number = () => Date.now();
export const now = (): number => clock();
export const setNowForTests = (value?: () => number): void => { clock = value ?? (() => Date.now()); };

const initial = (): Data => ({ nextTeam: 1, nextConflict: 1, nextMatch: 1, teamIds: [], teams: {}, playerIds: [], players: {}, conflictIds: [], conflicts: {}, matchIds: [], matches: {}, users: {}, audit: [] });
export async function readTournament(ctx: Ctx): Promise<Data> {
  const env = (ctx as Ctx & { env?: { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> } } } }).env;
  if (env?.CHAT_DO) {
    const response = await env.CHAT_DO.get(env.CHAT_DO.idFromName("team-collector:data")).fetch("https://do/tournament", { method: "GET" });
    if (response.ok) return { ...initial(), ...(await response.json() as Partial<Data>) };
  }
  const value = await ctx.tournamentStorage?.read("team-collector:data");
  if (!value || typeof value !== "object") return initial();
  return { ...initial(), ...(value as Partial<Data>) };
}
export async function writeTournament(ctx: Ctx, data: Data): Promise<void> {
  const env = (ctx as Ctx & { env?: { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> } } } }).env;
  if (env?.CHAT_DO) { const response = await env.CHAT_DO.get(env.CHAT_DO.idFromName("team-collector:data")).fetch("https://do/tournament", { method: "PUT", body: JSON.stringify(data) }); if (!response.ok) throw new Error("Persistent storage is unavailable."); return; }
  if (!ctx.tournamentStorage) throw new Error("Persistent storage is unavailable.");
  await ctx.tournamentStorage.write("team-collector:data", data);
}
export function allTeams(data: Data): Team[] { return data.teamIds.map((id) => data.teams[id]).filter(Boolean); }
export function teamPlayers(data: Data, team: Team): Player[] { return team.playerIds.map((id) => data.players[id]).filter(Boolean); }
export function log(data: Data, actorId: string, action: string, targetId?: string): void {
  data.audit.push({ at: now(), actorId, action, targetId });
  if (data.audit.length > 300) data.audit.splice(0, data.audit.length - 300);
}
export function createTeam(data: Data, name: string, captainId: string, contact: string, players: Player[]): Team {
  const id = `t${data.nextTeam++}`;
  const team: Team = { id, name, captainTelegramId: captainId, captainContact: contact, status: "PENDING", playerIds: [], matchIds: [] };
  for (const player of players) { const playerId = `${id}p${team.playerIds.length + 1}`; data.players[playerId] = player; data.playerIds.push(playerId); team.playerIds.push(playerId); }
  data.teams[id] = team; data.teamIds.push(id); return team;
}
export function detectConflicts(data: Data, team: Team): Conflict[] {
  const found: Conflict[] = [];
  for (const player of teamPlayers(data, team)) {
    const id = player.inGameId.trim().toLowerCase();
    const overlapping = allTeams(data).filter((other) => other.id !== team.id && (other.status === "PENDING" || other.status === "APPROVED" || other.status === "CONFLICTED") && teamPlayers(data, other).some((candidate) => candidate.inGameId.trim().toLowerCase() === id));
    if (!overlapping.length) continue;
    const teamIds = [team.id, ...overlapping.map((other) => other.id)];
    const existing = data.conflictIds.map((key) => data.conflicts[key]).find((conflict) => conflict.status === "OPEN" && conflict.inGameId === id && teamIds.every((key) => conflict.teamIds.includes(key)));
    const conflict = existing ?? { id: `c${data.nextConflict++}`, inGameId: player.inGameId, teamIds, status: "OPEN" as const, createdAt: now() };
    if (!existing) { data.conflicts[conflict.id] = conflict; data.conflictIds.push(conflict.id); }
    for (const affected of teamIds) { const affectedTeam = data.teams[affected]; if (affectedTeam) affectedTeam.status = "CONFLICTED"; }
    found.push(conflict);
  }
  return found;
}
export function statusLabel(status: TeamStatus): string { return ({ PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CONFLICTED: "Conflicted", PLAYING: "Playing", FINISHED: "Finished" })[status]; }
export function matchLabel(data: Data, match: Match): string { const a = data.teams[match.teamAId]?.name ?? "Unknown"; const b = data.teams[match.teamBId]?.name ?? "Unknown"; return `${a} ${match.scoreA}–${match.scoreB} ${b}`; }
export function matchExportRows(data: Data) { return data.matchIds.map((id) => { const match = data.matches[id]; return { match: matchLabel(data, match), status: match.status, link: match.link ?? "" }; }); }
export function matchExportCsv(data: Data): string { return ["match,status,link", ...matchExportRows(data).map((row) => `"${row.match.replaceAll('"', '""')}",${row.status},"${row.link.replaceAll('"', '""')}"`)].join("\n"); }
