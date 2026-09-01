import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, isOwner, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { conflicts, logEvent, normalizeNickname, readTournament, teamHeader, teamIdentity, teams, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Панель администратора", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Введите значение" } as const;
async function owner(ctx: Ctx): Promise<boolean> { if (isOwner(ctx)) { await ctx.answerCallbackQuery(); return true; } return requireOwner(ctx as never); }
function deskKeyboard() { return inlineKeyboard([[inlineButton("Установить цену регистрации", "admin:price")], [inlineButton("Разрешить конфликты", "admin:conflicts")], [inlineButton("Проверить запросы никнеймов", "admin:names")], [inlineButton("Управлять матчами", "admin:matches")], [inlineButton("В меню", "menu:main")]]); }

composer.callbackQuery("admin:desk", async (ctx) => { if (!(await owner(ctx))) return; await ctx.reply("Управляйте регистрациями, конфликтами и матчами.", { reply_markup: deskKeyboard() }); });
composer.callbackQuery("admin:price", async (ctx) => { if (!(await owner(ctx))) return; ctx.session.flow = "price"; await ctx.reply("Введите цену регистрации целым числом. Введите 0, чтобы оставить регистрацию бесплатной.", { reply_markup: input }); });
composer.callbackQuery("admin:conflicts", async (ctx) => { if (!(await owner(ctx))) return; const list = teams(await readTournament(ctx)).filter((team) => team.status === "pending_conflict" || team.status === "needs_correction"); await ctx.reply(list.length ? "Выберите конфликт состава для решения." : "Нет конфликтов состава, ожидающих проверки.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:conf:${team.id}`)]), [inlineButton("К панели", "admin:desk")]]) : deskKeyboard() }); });
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
composer.callbackQuery(/^admin:conf:(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = data.teams[ctx.match?.[1] ?? ""]; if (!team) { await ctx.reply("Эта команда больше недоступна."); return; } const overlap = conflicts(data, team); await ctx.reply(overlap.length ? `${teamHeader(team)} конфликтует с ${overlap.map(teamIdentity).join(", ")}. Выберите заявку, которую нужно принять.` : `${teamHeader(team)} больше не имеет конфликта состава.`, { reply_markup: overlap.length ? inlineKeyboard([[inlineButton("Принять эту команду", `conf:new:${team.id}`), inlineButton("Принять текущую команду", `conf:old:${team.id}`)]]) : deskKeyboard() }); });
composer.callbackQuery(/^conf:(new|old):(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = data.teams[ctx.match?.[2] ?? ""]; if (!team) { await ctx.reply("Этот конфликт больше недоступен."); return; } const overlap = conflicts(data, team); if (ctx.match?.[1] === "new") { team.status = "confirmed"; for (const other of overlap) other.status = "needs_correction"; } else team.status = "rejected"; await writeTournament(ctx, data); await ctx.reply(ctx.match?.[1] === "new" ? `${teamIdentity(team)} принята. Конфликтующий состав ожидает правок.` : `${teamIdentity(team)} отклонена. Текущий состав остаётся принят.`, { reply_markup: deskKeyboard() }); });
composer.callbackQuery("admin:matches", async (ctx) => { if (!(await owner(ctx))) return; const list = teams(await readTournament(ctx)).filter((team) => team.status === "confirmed"); await ctx.reply(list.length ? "Выберите команду для обновления." : "Нет принятых команд для обновления матчей.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:match:${team.id}`)]), [inlineButton("К панели", "admin:desk")]]) : deskKeyboard() }); });
composer.callbackQuery(/^admin:match:(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const teamId = ctx.match?.[1]; const data = await readTournament(ctx); const team = teamId ? data.teams[teamId] : undefined; if (!team) { await ctx.reply("Эта команда больше недоступна."); return; } ctx.session.managingTeamId = team.id; await ctx.reply(`Обновите ${teamIdentity(team)}.`, { reply_markup: inlineKeyboard([[inlineButton("Прикрепить ссылку на матч", "admin:link")], [inlineButton("Отметить победу", "admin:result:won"), inlineButton("Отметить поражение", "admin:result:lost")], [inlineButton("Отметить ожидание", "admin:result:pending")]]) }); });
composer.callbackQuery("admin:link", async (ctx) => { if (!(await owner(ctx))) return; if (!ctx.session.managingTeamId) { await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } ctx.session.flow = "match_link"; await ctx.reply("Отправьте полную ссылку на матч, начиная с https://.", { reply_markup: input }); });
composer.callbackQuery(/^admin:result:(won|lost|pending)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } team.matchStatus = ctx.match?.[1] as "won" | "lost" | "pending"; await writeTournament(ctx, data); const labels = { won: "Победа", lost: "Поражение", pending: "Ожидает" } as const; await ctx.reply(`${teamIdentity(team)}: ${labels[team.matchStatus]}.`, { reply_markup: deskKeyboard() }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.flow !== "price" && ctx.session.flow !== "match_link") return next(); if (!isOwner(ctx)) { ctx.session.flow = undefined; await ctx.reply("Это действие доступно только администратору."); return; } if (ctx.session.flow === "price") { const price = Number(ctx.message.text.trim()); if (!Number.isInteger(price) || price < 0 || price > 1_000_000) { await ctx.reply("Введите целое число от 0 до 1000000.", { reply_markup: input }); return; } const data = await readTournament(ctx); data.registrationPrice = price; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(price === 0 ? "Регистрация бесплатна." : `Стоимость регистрации: ${price} звёзд Telegram.`, { reply_markup: deskKeyboard() }); return; } const link = ctx.message.text.trim(); if (!/^https:\/\/.+/.test(link) || link.length > 512) { await ctx.reply("Отправьте корректную ссылку на матч, начинающуюся с https://.", { reply_markup: input }); return; } const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { ctx.session.flow = undefined; await ctx.reply("Сначала выберите команду в разделе управления матчами."); return; } team.matchLink = link; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(`Ссылка на матч прикреплена к ${teamIdentity(team)}.`, { reply_markup: deskKeyboard() }); });

export default composer;
