import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { activeTournament, captainIdentifier, matchStartEpoch, readTournament, refreshMatchStatuses, teamIdentity, teams, tournamentMatches, type MatchTable, type Player, type Team, type TournamentData, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Список команд", data: "teams:show", order: 30 });
registerMainMenuItem({ label: "Таблица матчей", data: "matches:show", order: 40 });
registerMainMenuItem({ label: "Турнир", data: "tournament:show", order: 50 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Введите название команды" } as const;
type MatchViewSession = { flow?: string; matchStage?: string; matchTeamQuery?: string };
const view = (ctx: Ctx): MatchViewSession => ctx.session as unknown as MatchViewSession;

function status(value: string): string { return value === "entered" ? "В турнире" : value === "confirmed" ? "Подтверждена" : value === "awaiting_payment" ? "Ожидает оплаты" : value === "pending_conflict" ? "На проверке" : value === "needs_correction" ? "Нужна правка" : "Отклонена"; }
function teamText(list: Team[]): string { return list.length ? `Команды\n\n${list.map((team) => `${teamIdentity(team)}\nСтатус: ${status(team.status)}`).join("\n\n")}` : "Команд пока нет — зарегистрируйте первую заявку."; }
function teamDisplay(team: Team | undefined): string { return team ? `${team.name} (капитан: ${captainIdentifier(team)})` : "Не назначено"; }
function formatTime(timestamp: string | number | undefined, timezone: string): string {
  if (timestamp === undefined) return "Не назначено";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Не назначено";
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}.${value("month")}.${value("year")} ${value("hour")}:${value("minute")}`;
}

/** A rapid double tap must not leak Telegram's harmless no-op edit error. */
async function editTableMessage(ctx: Ctx, text: string, replyMarkup?: ReturnType<typeof inlineKeyboard>): Promise<void> {
  try {
    await ctx.editMessageText(text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
  } catch (error) {
    if (!String(error).includes("message is not modified")) throw error;
  }
}
function matchLine(data: TournamentData, match: MatchTable): string {
  const team1 = data.teams[match.team1Id]; const team2 = match.team2Id ? data.teams[match.team2Id] : undefined;
  const matchStatus = match.status === "in_progress" ? "Идёт" : match.status === "completed" ? "Завершён" : "Запланирован";
  return [`№ матча: ${match.number}`, `Этап: ${match.stage}`, `Команда 1 (капитан): ${teamDisplay(team1)}`, `Команда 2 (капитан): ${teamDisplay(team2)}`, `Начало: ${formatTime(match.startTime ?? match.scheduledTime, match.timezone)}`, `Окончание: ${formatTime(match.endTime, match.timezone)}`, `Сервер / ссылка: ${match.serverLink ?? "Не назначено"}`, `Статус: ${matchStatus}`, `Результат: ${match.result ?? "Не определён"}`].join("\n");
}
function filteredMatches(data: TournamentData, ctx: Ctx): MatchTable[] {
  const active = activeTournament(data); const filter = view(ctx); const query = filter.matchTeamQuery?.trim().toLocaleLowerCase();
  return tournamentMatches(data, active?.id).filter((match) => {
    const names = `${data.teams[match.team1Id]?.name ?? ""} ${match.team2Id ? data.teams[match.team2Id]?.name ?? "" : ""}`.toLocaleLowerCase();
    return (!filter.matchStage || match.stage === filter.matchStage) && (!query || names.includes(query));
  }).sort((a, b) => (matchStartEpoch(a) ?? Number.MAX_SAFE_INTEGER) - (matchStartEpoch(b) ?? Number.MAX_SAFE_INTEGER) || a.number - b.number);
}
function matchKeyboard(data: TournamentData, ctx: Ctx, list: MatchTable[]) {
  const stages = [...new Set(tournamentMatches(data, activeTournament(data)?.id).map((match) => match.stage))];
  const rows = [
    [inlineButton("Фильтр по этапу", "matches:filter:stage"), inlineButton("Поиск команды", "matches:filter:team")],
    [inlineButton("Сбросить фильтры", "matches:filter:clear")],
    ...stages.slice(0, 5).map((stage, index) => [inlineButton(stage.slice(0, 24), `matches:stage:${index}`)]),
    ...list.map((match) => [inlineButton(`Команда 1: ${data.teams[match.team1Id]?.name?.slice(0, 18) ?? "—"}`, `team:detail:${match.team1Id}`), ...(match.team2Id ? [inlineButton(`Команда 2: ${data.teams[match.team2Id]?.name?.slice(0, 18) ?? "—"}`, `team:detail:${match.team2Id}`)] : [])]),
    [inlineButton("В меню", "menu:main")],
  ];
  // Stage callbacks use an index, keeping callback payloads under Telegram's limit.
  void ctx;
  return inlineKeyboard(rows);
}
async function showMatches(ctx: Ctx, edit: boolean): Promise<void> {
  const data = await readTournament(ctx);
  if (refreshMatchStatuses(data)) await writeTournament(ctx, data);
  const active = activeTournament(data);
  if (!active) { const text = "Турнир ещё не составлен — таблица появится после решения организатора."; if (edit) await editTableMessage(ctx, text, inlineKeyboard([[inlineButton("В меню", "menu:main")]])); else await ctx.reply(text); return; }
  const list = filteredMatches(data, ctx);
  const text = list.length ? `Таблица матчей\nМатч | Начало | Окончание | Статус\n\n${list.map((match) => matchLine(data, match)).join("\n\n")}` : "Матчи по этому фильтру не найдены. Сбросьте фильтры или выберите другой запрос.";
  const keyboard = matchKeyboard(data, ctx, list);
  if (edit) await editTableMessage(ctx, text, keyboard); else await ctx.reply(text, { reply_markup: keyboard });
}
async function showTeams(ctx: Ctx): Promise<void> { const list = teams(await readTournament(ctx)); await editTableMessage(ctx, teamText(list), inlineKeyboard([[inlineButton("В меню", "menu:main")]])); }
composer.callbackQuery("teams:show", async (ctx) => { await ctx.answerCallbackQuery(); await showTeams(ctx); });
composer.callbackQuery("matches:show", async (ctx) => { await ctx.answerCallbackQuery(); await showMatches(ctx, true); });
composer.callbackQuery("matches:filter:stage", async (ctx) => { await ctx.answerCallbackQuery(); const stages = [...new Set(tournamentMatches(await readTournament(ctx), activeTournament(await readTournament(ctx))?.id).map((match) => match.stage))]; await ctx.reply(stages.length ? "Выберите этап для таблицы." : "Этапы пока не созданы.", { reply_markup: stages.length ? inlineKeyboard(stages.slice(0, 5).map((stage, index) => [inlineButton(stage.slice(0, 24), `matches:stage:${index}`)])) : undefined }); });
composer.callbackQuery(/^matches:stage:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const data = await readTournament(ctx); const stages = [...new Set(tournamentMatches(data, activeTournament(data)?.id).map((match) => match.stage))]; const stage = stages[Number(ctx.match?.[1])]; if (!stage) { await ctx.reply("Этот этап больше недоступен."); return; } view(ctx).matchStage = stage; await showMatches(ctx, false); });
composer.callbackQuery("matches:filter:team", async (ctx) => { await ctx.answerCallbackQuery(); view(ctx).flow = "match_team_filter"; await ctx.reply("Введите название команды для поиска.", { reply_markup: input }); });
composer.callbackQuery("matches:filter:clear", async (ctx) => { await ctx.answerCallbackQuery(); view(ctx).matchStage = undefined; view(ctx).matchTeamQuery = undefined; await showMatches(ctx, true); });
composer.callbackQuery(/^team:detail:(t\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const data = await readTournament(ctx); const team = data.teams[ctx.match?.[1] ?? ""]; if (!team) { await ctx.reply("Эта команда больше недоступна."); return; } await ctx.reply(rosterCard(data, team), { reply_markup: inlineKeyboard([[inlineButton("К таблице матчей", "matches:show")]]) }); });

function populated(player: Player | undefined): player is Player { return Boolean(player?.nickname.trim() && player.inGameId.trim()); }
function duplicateIds(data: TournamentData, team: Team): Set<string> { const own = new Set(team.players.map((player) => player.inGameId.trim().toLocaleLowerCase()).filter(Boolean)); const duplicates = new Set<string>(); for (const other of teams(data)) for (const player of other.players) { const id = player.inGameId.trim().toLocaleLowerCase(); if (other.id !== team.id && id && own.has(id)) duplicates.add(id); } return duplicates; }
function playerLine(player: Player | undefined, duplicates: Set<string>, prefix: string, unassigned = false): string { if (!populated(player)) return `${prefix}Пустой слот`; return `${prefix}${player.nickname} (${player.inGameId})${duplicates.has(player.inGameId.trim().toLocaleLowerCase()) ? " ⚠️ конфликт ID" : ""}${unassigned ? " — не назначен" : ""}`; }
/** Detailed pane preserves five starting positions and two substitute positions. */
export function rosterCard(data: TournamentData, team: Team, full = false): string { const duplicates = duplicateIds(data, team); const starters = Array.from({ length: 5 }, (_, index) => team.players[index] && !team.players[index].isSubstitute ? team.players[index] : undefined); const subs = team.players.slice(5).map((player) => ({ player, unassigned: !player.isSubstitute })).slice(0, 2); const captain = starters[0]; const lines = [`Команда: ${team.name}`, `Капитан: ${populated(captain) ? `${captain.nickname} (ID: ${captain.inGameId})` : "Пустой слот"}`, "Основной состав:", ...starters.map((player, index) => playerLine(player, duplicates, `${index + 1}. `)), "Замены:", ...Array.from({ length: 2 }, (_, index) => playerLine(subs[index]?.player, duplicates, `- Замена ${index + 1}: `, subs[index]?.unassigned))]; if (full && team.players.length > 7) for (const player of team.players.slice(7)) lines.push(playerLine(player, duplicates, "- Дополнительно: ", !player.isSubstitute)); return lines.join("\n"); }
async function showTournament(ctx: Ctx, edit: boolean): Promise<void> { const data = await readTournament(ctx); if (refreshMatchStatuses(data)) await writeTournament(ctx, data); const tournament = activeTournament(data); if (!tournament) { const text = "Турнир ещё не составлен — таблица появится после решения организатора."; if (edit) await editTableMessage(ctx, text); else await ctx.reply(text); return; } const entered = tournament.teamIds.map((id) => data.teams[id]).filter((team): team is Team => Boolean(team)); const heading = tournament.status === "in_progress" || tournament.status === "active" ? "Турнир идёт" : "Подготовка турнира"; const text = `${heading}\nПодробный вид\n\n${entered.map((team) => rosterCard(data, team)).join("\n\n")}`; const stages = [...new Set(tournamentMatches(data, tournament.id).map((match) => match.stage))]; const keyboard = inlineKeyboard([[inlineButton("Открыть полную сетку", "matches:show")], ...stages.slice(0, 5).map((stage, index) => [inlineButton(stage.slice(0, 24), `matches:stage:${index}`)]), [inlineButton("В меню", "menu:main")]]); if (edit) await editTableMessage(ctx, text, keyboard); else await ctx.reply(text, { reply_markup: keyboard }); }
composer.callbackQuery("tournament:show", async (ctx) => { await ctx.answerCallbackQuery(); await showTournament(ctx, true); });
composer.on("message:text", async (ctx, next) => { if (view(ctx).flow !== "match_team_filter") return next(); const query = ctx.message.text.trim(); if (!query || query.length > 128) { await ctx.reply("Введите название команды до 128 символов.", { reply_markup: input }); return; } view(ctx).flow = undefined; view(ctx).matchTeamQuery = query; await showMatches(ctx, false); });
// Old menu messages can outlive a deployment.  A removed or renamed callback
// must still give the captain a quick, useful answer instead of an endless
// Telegram spinner. This composer is registered last, so live callbacks above
// always take precedence.
composer.callbackQuery(/.+/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Эта кнопка больше не доступна. Откройте /start и выберите действие из актуального меню.");
});
export { formatTime, matchLine };
export default composer;
