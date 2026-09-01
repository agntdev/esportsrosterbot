import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { activeTournament, allowDuplicateIds, conflicts, createTournament, eligibleTeams, logEvent, normalizeNickname, now, readTournament, teamHeader, teamIdentity, teams, type Team, writeTournament } from "../tournament-store.js";
import { rosterCard } from "./tournament-table.js";

registerMainMenuItem({ label: "Панель администратора", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Введите значение" } as const;
async function owner(ctx: Ctx): Promise<boolean> { if (isOwner(ctx)) { await ctx.answerCallbackQuery(); return true; } return requireOwner(ctx as never); }
function deskKeyboard() { return inlineKeyboard([[inlineButton("Установить цену регистрации", "admin:price")], [inlineButton("Разрешить конфликты", "admin:conflicts")], [inlineButton("Проверить запросы никнеймов", "admin:names")], [inlineButton("Управлять матчами", "admin:matches")], [inlineButton("Составить турнир", "admin:tournament:compose")], [inlineButton("В меню", "menu:main")]]); }
function tournamentPreview(data: Awaited<ReturnType<typeof readTournament>>, list: Team[]): string {
  return `Подготовка турнира\nПодробный вид: включён\n\n${list.map((team) => rosterCard(data, team)).join("\n\n")}`;
}

composer.callbackQuery("admin:desk", async (ctx) => { if (!(await owner(ctx))) return; await ctx.reply("Управляйте регистрациями, конфликтами и матчами.", { reply_markup: deskKeyboard() }); });
composer.callbackQuery("admin:tournament:compose", async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx);
  const existing = activeTournament(data);
  if (existing) { await ctx.reply("Турнир уже составлен. Откройте его в публичной таблице.", { reply_markup: inlineKeyboard([[inlineButton("Открыть турнир", "tournament:show")], [inlineButton("К панели", "admin:desk")]]) }); return; }
  const list = eligibleTeams(data);
  if (!list.length) { await ctx.reply("Нет заявок, готовых к включению в турнир. Нужны подтверждённые команды без конфликтов ID.", { reply_markup: deskKeyboard() }); return; }
  await ctx.reply(tournamentPreview(data, list), { reply_markup: inlineKeyboard([[inlineButton("Подтвердить составление", "admin:tournament:confirm")], [inlineButton("Отменить", "admin:tournament:cancel")]]) });
});
composer.callbackQuery("admin:tournament:cancel", async (ctx) => {
  if (!(await owner(ctx))) return;
  await ctx.reply("Составление турнира отменено. Заявки не изменены.", { reply_markup: deskKeyboard() });
});
composer.callbackQuery("admin:tournament:confirm", async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx);
  const existing = activeTournament(data);
  if (existing) { await ctx.reply("Турнир уже составлен. Повторное подтверждение ничего не изменило.", { reply_markup: inlineKeyboard([[inlineButton("Открыть турнир", "tournament:show")], [inlineButton("К панели", "admin:desk")]]) }); return; }
  const list = eligibleTeams(data);
  if (!list.length) { await ctx.reply("Нет заявок, готовых к включению в турнир. Проверьте статусы команд.", { reply_markup: deskKeyboard() }); return; }
  const tournament = createTournament(data, list, String(ctx.from?.id ?? ctx.chat?.id ?? ""));
  await writeTournament(ctx, data);
  const view = inlineKeyboard([[inlineButton("Открыть турнир", "tournament:show")]]);
  const confirmation = `Турнир составлен. В него включено команд: ${tournament.teamIds.length}. Составы команд зафиксированы.`;
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (admin && admin !== String(ctx.chat?.id ?? "")) {
    try { await ctx.api.sendMessage(admin, confirmation, { reply_markup: view }); } catch { /* Admin may have blocked the bot. */ }
  }
  for (const team of list) {
    try { await ctx.api.sendMessage(team.captainTelegramId, `Ваша команда ${teamIdentity(team)} включена в турнир. Состав зафиксирован.`, { reply_markup: view }); } catch { /* A blocked captain must not prevent other notifications. */ }
  }
  await ctx.reply(confirmation, { reply_markup: inlineKeyboard([[inlineButton("Открыть турнир", "tournament:show")], [inlineButton("К панели", "admin:desk")]]) });
});
composer.callbackQuery("admin:price", async (ctx) => { if (!(await owner(ctx))) return; ctx.session.flow = "price"; await ctx.reply("Введите цену регистрации целым числом. Введите 0, чтобы оставить регистрацию бесплатной.", { reply_markup: input }); });
composer.callbackQuery("admin:conflicts", async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const list = teams(data).filter((team) => conflicts(data, team).length > 0); await ctx.reply(list.length ? "Выберите конфликт состава для решения." : "Нет конфликтов состава, ожидающих проверки.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:conf:${team.id}`)]), [inlineButton("К панели", "admin:desk")]]) : deskKeyboard() }); });
composer.callbackQuery("admin:names", async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); const pending = data.nameReviewIds.map((id) => data.nameReviews[id]).filter((review) => review?.status === "pending");
  await ctx.reply(pending.length ? "Выберите запрос никнейма для проверки." : "Нет запросов никнеймов, ожидающих проверки.", { reply_markup: pending.length ? inlineKeyboard([...pending.slice(0, 7).map((review) => [inlineButton(review.candidate.slice(0, 32), `admin:name:open:${review.id}`)]), [inlineButton("К панели", "admin:desk")]]) : deskKeyboard() });
});
composer.callbackQuery(/^admin:name:open:(n\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const review = (await readTournament(ctx)).nameReviews[ctx.match?.[1] ?? ""];
  if (!review || review.status !== "pending") { await ctx.reply("Этот запрос никнейма больше недоступен."); return; }
  await ctx.reply(`Проверить никнейм: ${review.candidate}.`, { reply_markup: inlineKeyboard([[inlineButton("Принять", `admin:name:approve:${review.id}`), inlineButton("Отклонить", `admin:name:reject:${review.id}`)], [inlineButton("К панели", "admin:desk")]]) });
});
composer.callbackQuery(/^admin:name:(approve|reject):(n\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); const review = data.nameReviews[ctx.match?.[2] ?? ""];
  if (!review || review.status !== "pending") { await ctx.reply("Этот запрос никнейма больше недоступен."); return; }
  const approved = ctx.match?.[1] === "approve";
  review.status = approved ? "approved" : "rejected";
  if (approved && !data.nameOverrides.some((item) => item.subject === review.subject && item.normalized === normalizeNickname(review.candidate))) data.nameOverrides.push({ subject: review.subject, normalized: normalizeNickname(review.candidate) });
  logEvent(data, approved ? "name_override_approved" : "name_override_rejected", undefined, review.id);
  await writeTournament(ctx, data);
  if (approved) {
    try { await ctx.api.sendMessage(review.requestedBy, `Организатор разрешил никнейм «${review.candidate}». Введите его ещё раз, чтобы продолжить.`); } catch { /* The requester may have blocked the bot. */ }
  }
  await ctx.reply(approved ? `Никнейм ${review.candidate} принят.` : `Никнейм ${review.candidate} отклонён.`, { reply_markup: deskKeyboard() });
});
function sharedIds(team: Team, other: Team): string[] {
  const theirs = new Set(other.players.map((player) => player.inGameId.trim().toLocaleLowerCase()));
  return team.players.map((player) => player.inGameId.trim().toLocaleLowerCase()).filter((id) => id && theirs.has(id));
}
function conflictChoices(team: Team, other: Team) {
  return inlineKeyboard([
    [inlineButton("Назначить команде 1", `conf:choose:team1:${team.id}`)],
    [inlineButton("Назначить команде 2", `conf:choose:team2:${team.id}`)],
    [inlineButton("Оставить обеим", `conf:choose:both:${team.id}`)],
    [inlineButton("К панели", "admin:desk")],
  ]);
}
function resolutionLabel(choice: "team1" | "team2" | "both"): string {
  return choice === "team1" ? "ID останется у команды 1, команде 2 потребуется исправить состав" : choice === "team2" ? "ID останется у команды 2, команде 1 потребуется исправить состав" : "ID останется у обеих команд; это намеренно разрешённый дубликат";
}
composer.callbackQuery(/^admin:conf:(t\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); const team = data.teams[ctx.match?.[1] ?? ""];
  if (!team) { await ctx.reply("Эта команда больше недоступна."); return; }
  const other = conflicts(data, team)[0];
  if (!other) { await ctx.reply(`${teamHeader(team)} больше не имеет конфликта состава.`, { reply_markup: deskKeyboard() }); return; }
  await ctx.reply(`${teamHeader(team)} конфликтует с ${teamIdentity(other)}.\n\nКоманда 1 — эта заявка. Команда 2 — конфликтующая заявка. Назначение одной команде потребует правок от другой; «Оставить обеим» намеренно разрешает одинаковый игровой ID.`, { reply_markup: conflictChoices(team, other) });
});
composer.callbackQuery(/^conf:choose:(team1|team2|both):(t\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const choice = ctx.match?.[1] as "team1" | "team2" | "both"; const teamId = ctx.match?.[2] ?? "";
  const data = await readTournament(ctx); const team = data.teams[teamId]; const other = team ? conflicts(data, team)[0] : undefined;
  if (!team || !other) { await ctx.reply("Этот конфликт больше недоступен.", { reply_markup: deskKeyboard() }); return; }
  await ctx.reply(`Подтвердите решение: ${resolutionLabel(choice)}.`, { reply_markup: inlineKeyboard([[inlineButton("Подтвердить", `conf:confirm:${choice}:${team.id}`), inlineButton("Отмена", "admin:conflicts")]]) });
});
composer.callbackQuery(/^conf:confirm:(team1|team2|both):(t\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const choice = ctx.match?.[1] as "team1" | "team2" | "both"; const data = await readTournament(ctx); const team = data.teams[ctx.match?.[2] ?? ""]; const other = team ? conflicts(data, team)[0] : undefined;
  if (!team || !other) { await ctx.reply("Этот конфликт больше недоступен.", { reply_markup: deskKeyboard() }); return; }
  const affected = [team, other];
  if (choice === "team1") { team.status = "confirmed"; other.status = "needs_correction"; }
  else if (choice === "team2") { team.status = "needs_correction"; other.status = "confirmed"; }
  else { allowDuplicateIds(affected, sharedIds(team, other)); team.status = "confirmed"; other.status = "confirmed"; }
  data.auditEvents.push({ at: now(), type: "conflict_resolved", teamId: team.id, relatedTeamIds: affected.map((item) => item.id), adminId: String(ctx.from?.id ?? ctx.chat?.id ?? ""), resolution: choice });
  if (data.auditEvents.length > 200) data.auditEvents.splice(0, data.auditEvents.length - 200);
  await writeTournament(ctx, data);
  const adminName = ctx.from?.username ? `@${ctx.from.username}` : "организатор";
  for (const affectedTeam of affected) {
    try { await ctx.api.sendMessage(affectedTeam.captainTelegramId, `Организатор ${adminName} подтвердил решение по конфликту ID: ${resolutionLabel(choice)}.`); } catch { /* A blocked captain must not interrupt notifications. */ }
  }
  await ctx.reply(`Решение применено: ${resolutionLabel(choice)}. Капитаны уведомлены.`, { reply_markup: deskKeyboard() });
});
composer.callbackQuery("admin:matches", async (ctx) => { if (!(await owner(ctx))) return; const list = teams(await readTournament(ctx)).filter((team) => team.status === "confirmed" || team.status === "entered"); await ctx.reply(list.length ? "Выберите команду для обновления." : "Нет принятых команд для обновления матчей.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:match:${team.id}`)]), [inlineButton("К панели", "admin:desk")]]) : deskKeyboard() }); });
composer.callbackQuery(/^admin:match:(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const teamId = ctx.match?.[1]; const data = await readTournament(ctx); const team = teamId ? data.teams[teamId] : undefined; if (!team) { await ctx.reply("Эта команда больше недоступна."); return; } ctx.session.managingTeamId = team.id; await ctx.reply(`Обновите ${teamIdentity(team)}.`, { reply_markup: inlineKeyboard([[inlineButton("Прикрепить ссылку на матч", "admin:link")], [inlineButton("Отметить победу", "admin:result:won"), inlineButton("Отметить поражение", "admin:result:lost")], [inlineButton("Отметить ожидание", "admin:result:pending")]]) }); });
composer.callbackQuery("admin:link", async (ctx) => { if (!(await owner(ctx))) return; if (!ctx.session.managingTeamId) { await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } ctx.session.flow = "match_link"; await ctx.reply("Отправьте полную ссылку на матч, начиная с https://.", { reply_markup: input }); });
composer.callbackQuery(/^admin:result:(won|lost|pending)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } team.matchStatus = ctx.match?.[1] as "won" | "lost" | "pending"; await writeTournament(ctx, data); const labels = { won: "Победа", lost: "Поражение", pending: "Ожидает" } as const; await ctx.reply(`${teamIdentity(team)}: ${labels[team.matchStatus]}.`, { reply_markup: deskKeyboard() }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.flow !== "price" && ctx.session.flow !== "match_link") return next(); if (!isOwner(ctx)) { ctx.session.flow = undefined; await ctx.reply("Это действие доступно только администратору."); return; } if (ctx.session.flow === "price") { const price = Number(ctx.message.text.trim()); if (!Number.isInteger(price) || price < 0 || price > 1_000_000) { await ctx.reply("Введите целое число от 0 до 1000000.", { reply_markup: input }); return; } const data = await readTournament(ctx); data.registrationPrice = price; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(price === 0 ? "Регистрация бесплатна." : `Стоимость регистрации: ${price} звёзд Telegram.`, { reply_markup: deskKeyboard() }); return; } const link = ctx.message.text.trim(); if (!/^https:\/\/.+/.test(link) || link.length > 512) { await ctx.reply("Отправьте корректную ссылку на матч, начинающуюся с https://.", { reply_markup: input }); return; } const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { ctx.session.flow = undefined; await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } team.matchLink = link; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(`Ссылка на матч прикреплена к ${teamIdentity(team)}.`, { reply_markup: deskKeyboard() }); });

export default composer;
