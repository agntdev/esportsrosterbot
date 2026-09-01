import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { activeTournament, readTournament, teamIdentity, teams, type Player, type Team, type TournamentData } from "../tournament-store.js";

registerMainMenuItem({ label: "Список команд", data: "teams:show", order: 30 });
registerMainMenuItem({ label: "Таблица матчей", data: "matches:show", order: 40 });
registerMainMenuItem({ label: "Турнир", data: "tournament:show", order: 50 });
const composer = new Composer<Ctx>();
function status(status: string): string { return status === "entered" ? "В турнире" : status === "confirmed" ? "Подтверждена" : status === "awaiting_payment" ? "Ожидает оплаты" : status === "pending_conflict" ? "На проверке" : status === "needs_correction" ? "Нужна правка" : "Отклонена"; }
function teamText(list: ReturnType<typeof teams>): string { return list.length ? `Команды\n\n${list.map((team) => `${teamIdentity(team)}\nСтатус: ${status(team.status)}`).join("\n\n")}` : "Команд пока нет — зарегистрируйте первую заявку."; }
function matchText(list: ReturnType<typeof teams>): string { const active = list.filter((team) => team.status === "confirmed" || team.status === "entered"); return active.length ? `Таблица матчей\n\n${active.map((team) => `${teamIdentity(team)} — ${team.matchStatus === "won" ? "Победа" : team.matchStatus === "lost" ? "Поражение" : team.matchLink ? "Ссылка опубликована" : "Матч ожидается"}`).join("\n")}` : "Подтверждённых команд пока нет — таблица появится после регистрации."; }
async function show(ctx: Ctx, kind: "team" | "match", edit: boolean): Promise<void> { const list = teams(await readTournament(ctx)); const text = kind === "team" ? teamText(list) : matchText(list); const rows: Array<Array<ReturnType<typeof inlineButton> | ReturnType<typeof urlButton>>> = kind === "match" ? list.filter((team) => (team.status === "confirmed" || team.status === "entered") && team.matchLink).slice(0, 7).map((team) => [urlButton(`Открыть ${teamIdentity(team)}`.slice(0, 24), team.matchLink!)]) : []; rows.push([inlineButton("В меню", "menu:main")]); const extra = inlineKeyboard(rows); if (edit) await ctx.editMessageText(text, { reply_markup: extra }); else await ctx.reply(text, { reply_markup: extra }); }
composer.callbackQuery("teams:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "team", true); });
composer.callbackQuery("matches:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "match", true); });

function populated(player: Player | undefined): player is Player { return Boolean(player?.nickname.trim() && player.inGameId.trim()); }
function duplicateIds(data: TournamentData, team: Team): Set<string> {
  const own = new Set(team.players.map((player) => player.inGameId.trim().toLocaleLowerCase()).filter(Boolean));
  const duplicates = new Set<string>();
  for (const other of teams(data)) {
    if (other.id === team.id) continue;
    for (const player of other.players) {
      const id = player.inGameId.trim().toLocaleLowerCase();
      if (id && own.has(id)) duplicates.add(id);
    }
  }
  return duplicates;
}
function playerLine(player: Player | undefined, duplicates: Set<string>, prefix: string, unassigned = false): string {
  if (!populated(player)) return `${prefix}Пустой слот`;
  const conflict = duplicates.has(player.inGameId.trim().toLocaleLowerCase()) ? " ⚠️ конфликт ID" : "";
  return `${prefix}${player.nickname} (${player.inGameId})${conflict}${unassigned ? " — не назначен" : ""}`;
}
/** A fixed seven-slot card keeps the tournament preparation screen scannable. */
export function rosterCard(data: TournamentData, team: Team, full = false): string {
  const duplicates = duplicateIds(data, team);
  const starters = Array.from({ length: 5 }, (_, index) => {
    const player = team.players[index];
    return player && !player.isSubstitute ? player : undefined;
  });
  const subs = team.players.slice(5).map((player) => ({ player, unassigned: !player.isSubstitute })).slice(0, 2);
  const captain = starters[0];
  const captainText = populated(captain) ? `${captain.nickname} (ID: ${captain.inGameId})` : "Пустой слот";
  const lines = [
    `Команда: ${team.name}`,
    `Капитан: ${captainText}`,
    "Основной состав:",
    ...starters.map((player, index) => playerLine(player, duplicates, `${index + 1}. `)),
    "Замены:",
    ...Array.from({ length: 2 }, (_, index) => playerLine(subs[index]?.player, duplicates, `- Замена ${index + 1}: `, subs[index]?.unassigned)),
  ];
  if (full && team.players.length > 7) {
    for (const player of team.players.slice(7)) lines.push(playerLine(player, duplicates, "- Дополнительно: ", !player.isSubstitute));
  }
  return lines.join("\n");
}
function rawRoster(team: Team): string {
  return `${teamIdentity(team)}\nКапитан: ${team.captainContact || team.players[0]?.nickname || "не указан"}\nСостав: ${team.players.map((player) => `${player.inGameId} — ${player.nickname}`).join(", ") || "не указан"}`;
}
function rosterKeyboard(data: TournamentData, list: Team[], clean: boolean): ReturnType<typeof inlineKeyboard> {
  const rows = [[inlineButton(clean ? "Полный вид" : "Компактный вид", `tournament:view:${clean ? "raw" : "clean"}`)]];
  for (const team of list) {
    if (team.players.length > 7) rows.push([inlineButton("Показать полный состав", `tournament:roster:${team.id}:full`)]);
    if (duplicateIds(data, team).size) rows.push([inlineButton("Решить конфликт ID", `admin:conf:${team.id}`)]);
  }
  rows.push([inlineButton("Таблица матчей", "matches:show")], [inlineButton("В меню", "menu:main")]);
  return inlineKeyboard(rows);
}
async function showTournament(ctx: Ctx, clean: boolean, edit: boolean): Promise<void> {
  const data = await readTournament(ctx);
  const tournament = activeTournament(data);
  if (!tournament) {
    const options = { reply_markup: inlineKeyboard([[inlineButton("В меню", "menu:main")]]) };
    if (edit) await ctx.editMessageText("Турнир ещё не составлен — таблица появится после решения организатора.", options); else await ctx.reply("Турнир ещё не составлен — таблица появится после решения организатора.", options);
    return;
  }
  const entered = tournament.teamIds.map((id) => data.teams[id]).filter((team): team is Team => Boolean(team));
  const text = `Подготовка турнира\n${clean ? "Подробный" : "Компактный"} вид\n\n${entered.map((team) => clean ? rosterCard(data, team) : rawRoster(team)).join("\n\n")}`;
  const options = { reply_markup: rosterKeyboard(data, entered, clean) };
  if (edit) await ctx.editMessageText(text, options); else await ctx.reply(text, options);
}
composer.callbackQuery("tournament:show", async (ctx) => { await ctx.answerCallbackQuery(); await showTournament(ctx, true, true); });
composer.callbackQuery(/^tournament:view:(clean|raw)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showTournament(ctx, ctx.match?.[1] === "clean", true); });
composer.callbackQuery(/^tournament:roster:(t\d+):full$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx); const team = data.teams[ctx.match?.[1] ?? ""];
  if (!team) { await ctx.reply("Эта команда больше недоступна."); return; }
  await ctx.reply(rosterCard(data, team, true), { reply_markup: inlineKeyboard([[inlineButton("К подготовке турнира", "tournament:show")]]) });
});
export default composer;
