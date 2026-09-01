import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, logEvent, now, readTournament, type Player, type Team, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Регистрация команды", data: "register:start", order: 10 });

type Draft = { name: string; captainContact: string; players: Player[] };
type RegistrationSession = { flow?: string; draft?: Draft };
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Введите текст" } as const;
const session = (ctx: Ctx): RegistrationSession => ctx.session as unknown as RegistrationSession;

function reset(ctx: Ctx): void { session(ctx).flow = undefined; session(ctx).draft = undefined; }
function playerLabel(index: number): string { return index === 0 ? "Капитан" : `Игрок ${index + 1}`; }
function prompt(index: number, field: "id" | "nickname" | "contact"): string {
  if (field === "contact") return "Укажите контакт капитана: @username или номер телефона.";
  return `${playerLabel(index)} — ${field === "id" ? "Game ID" : "игровой никнейм"}.`;
}
function currentPlayer(draft: Draft): Player { return draft.players[draft.players.length - 1]; }
function optionalKeyboard() { return inlineKeyboard([[inlineButton("Добавить замену", "register:sub"), inlineButton("К просмотру", "register:preview")], [inlineButton("Отмена", "menu:main")]]); }
function previewKeyboard() { return inlineKeyboard([[inlineButton("Подтвердить", "register:confirm"), inlineButton("Редактировать", "register:restart")], [inlineButton("Отмена", "menu:main")]]); }
function formatApplication(team: Pick<Team, "name" | "captainContact" | "players"> | Draft): string {
  const starters = team.players.filter((player) => !player.isSubstitute);
  const subs = team.players.filter((player) => player.isSubstitute);
  const lines = [`Команда: ${team.name}`, `Контакт капитана: ${team.captainContact}`, "Состав:"];
  lines.push(...starters.map((player, i) => `${i === 0 ? "Капитан" : `Игрок ${i + 1}`}: ${player.inGameId} — ${player.nickname}`));
  lines.push(subs.length ? `Замены: ${subs.map((player) => `${player.inGameId} — ${player.nickname}`).join("; ")}` : "Замены: нет");
  return lines.join("\n");
}
function conflictDetails(data: Awaited<ReturnType<typeof readTournament>>, team: Team): string {
  const overlaps = conflicts(data, team);
  const items = team.players.flatMap((player) => {
    const names = overlaps.filter((other) => other.players.some((p) => p.inGameId.toLowerCase() === player.inGameId.toLowerCase())).map((other) => other.name);
    return names.length ? [`${player.inGameId} (${names.join(", ")})`] : [];
  });
  return items.length ? `\nКонфликты ID: ${items.join(", ")}` : "\nКонфликтов ID нет.";
}
async function notifyAdmin(ctx: Ctx, data: Awaited<ReturnType<typeof readTournament>>, team: Team): Promise<boolean> {
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (!admin) return false;
  try {
    await ctx.api.sendMessage(admin, `Новая заявка\n\n${formatApplication(team)}${conflictDetails(data, team)}`, {
      reply_markup: conflicts(data, team).length ? inlineKeyboard([[inlineButton("Оставить новую", `conf:new:${team.id}`), inlineButton("Оставить прежнюю", `conf:old:${team.id}`)]]) : undefined,
    });
    logEvent(data, "admin_notified", team.id);
    return true;
  } catch { return false; }
}
async function publish(ctx: Ctx): Promise<void> {
  const draft = session(ctx).draft;
  if (!draft || draft.players.filter((p) => !p.isSubstitute).length !== 5 || !draft.captainContact) { await ctx.reply("Анкета заполнена не полностью. Начните регистрацию заново."); reset(ctx); return; }
  const data = await readTournament(ctx);
  const id = `t${data.nextTeamNumber}`;
  const team: Team = { id, name: draft.name, captainContact: draft.captainContact, captainTelegramId: String(ctx.from?.id ?? ctx.chat?.id ?? ""), paid: data.registrationPrice === 0, status: data.registrationPrice === 0 ? "confirmed" : "awaiting_payment", players: draft.players };
  data.nextTeamNumber += 1; data.teamIds.push(id); data.teams[id] = team; logEvent(data, "team_created", id);
  const overlap = conflicts(data, team);
  if (overlap.length) team.status = "pending_conflict";
  const sent = await notifyAdmin(ctx, data, team);
  await writeTournament(ctx, data);
  reset(ctx);
  if (data.registrationPrice > 0) {
    await ctx.replyWithInvoice("Регистрация турнира", `Регистрация команды ${team.name}`, `registration:${id}`, "XTR", [{ label: "Регистрация", amount: data.registrationPrice }]);
    return;
  }
  const review = overlap.length ? " Заявка отмечена для проверки конфликта ID." : "";
  const adminNote = sent ? "" : " Уведомление организатору пока не настроено.";
  await ctx.reply(`Команда ${team.name} опубликована в списке команд.${review}${adminNote}`, { reply_markup: inlineKeyboard([[inlineButton("Список команд", "teams:show"), inlineButton("Редактировать команду", "edit:team")]]) });
}

composer.callbackQuery("register:start", async (ctx) => { await ctx.answerCallbackQuery(); session(ctx).flow = "team_name"; session(ctx).draft = { name: "", captainContact: "", players: [] }; await ctx.reply("Введите название команды.", { reply_markup: input }); });
composer.callbackQuery("register:restart", async (ctx) => { await ctx.answerCallbackQuery(); session(ctx).flow = "team_name"; session(ctx).draft = { name: "", captainContact: "", players: [] }; await ctx.reply("Введите название команды.", { reply_markup: input }); });
composer.callbackQuery("register:sub", async (ctx) => { await ctx.answerCallbackQuery(); const draft = session(ctx).draft; if (!draft || session(ctx).flow !== "sub_choice") { await ctx.reply("Сначала заполните основную заявку."); return; } if (draft.players.filter((p) => p.isSubstitute).length >= 2) { await ctx.reply("Можно добавить не больше двух замен. Перейдите к просмотру.", { reply_markup: optionalKeyboard() }); return; } draft.players.push({ inGameId: "", nickname: "", isSubstitute: true }); session(ctx).flow = "sub_id"; await ctx.reply("Замена — Game ID.", { reply_markup: input }); });
composer.callbackQuery("register:preview", async (ctx) => { await ctx.answerCallbackQuery(); const draft = session(ctx).draft; if (!draft || draft.players.filter((p) => !p.isSubstitute).length !== 5) { await ctx.reply("Сначала заполните пять основных игроков."); return; } session(ctx).flow = "preview"; await ctx.reply(`Проверьте заявку:\n\n${formatApplication(draft)}`, { reply_markup: previewKeyboard() }); });
composer.callbackQuery("register:confirm", async (ctx) => { await ctx.answerCallbackQuery(); if (session(ctx).flow !== "preview") { await ctx.reply("Сначала откройте просмотр заявки."); return; } await publish(ctx); });

composer.on("message:text", async (ctx, next) => {
  const s = session(ctx); const flow = s.flow; if (!flow || ["price", "match_link", "edit_player"].includes(flow)) return next();
  const value = ctx.message.text.trim(); const draft = s.draft;
  if (!draft) { reset(ctx); await ctx.reply("Срок заполнения анкеты истёк. Начните регистрацию заново."); return; }
  if (flow === "team_name") { const fallback = ctx.from?.username?.trim() || ctx.from?.first_name?.trim() || "Команда"; draft.name = value || `${fallback}-${now()}`; draft.players.push({ inGameId: "", nickname: "", isSubstitute: false }); s.flow = "starter_id"; await ctx.reply(prompt(0, "id"), { reply_markup: input }); return; }
  if (!value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
  if (flow === "starter_id" || flow === "sub_id") { currentPlayer(draft).inGameId = value.slice(0, 128); s.flow = flow === "starter_id" ? "starter_nickname" : "sub_nickname"; await ctx.reply(prompt(draft.players.length - 1, "nickname"), { reply_markup: input }); return; }
  if (flow === "starter_nickname" || flow === "sub_nickname") {
    currentPlayer(draft).nickname = value.slice(0, 128);
    if (flow === "sub_nickname") { s.flow = "sub_choice"; await ctx.reply("Замена добавлена. Добавьте ещё одну или перейдите к просмотру.", { reply_markup: optionalKeyboard() }); return; }
    if (draft.players.length === 1) { s.flow = "captain_contact"; await ctx.reply(prompt(0, "contact"), { reply_markup: input }); return; }
    if (draft.players.length < 5) { draft.players.push({ inGameId: "", nickname: "", isSubstitute: false }); s.flow = "starter_id"; await ctx.reply(prompt(draft.players.length - 1, "id"), { reply_markup: input }); return; }
    s.flow = "sub_choice"; await ctx.reply("Пять основных игроков добавлены. Можно указать до двух замен.", { reply_markup: optionalKeyboard() }); return;
  }
  if (flow === "captain_contact") { draft.captainContact = value.slice(0, 128); draft.players.push({ inGameId: "", nickname: "", isSubstitute: false }); s.flow = "starter_id"; await ctx.reply(prompt(1, "id"), { reply_markup: input }); }
});

composer.on("pre_checkout_query", async (ctx) => { const match = /^registration:(t\d+)$/.exec(ctx.preCheckoutQuery.invoice_payload); const data = await readTournament(ctx); const team = match ? data.teams[match[1]] : undefined; const valid = Boolean(team && team.captainTelegramId === String(ctx.from?.id ?? "") && team.status === "awaiting_payment" && ctx.preCheckoutQuery.currency === "XTR" && ctx.preCheckoutQuery.total_amount === data.registrationPrice); await ctx.answerPreCheckoutQuery(valid, valid ? undefined : { error_message: "Эта регистрация больше недоступна. Начните заново." }); });
composer.on("message:successful_payment", async (ctx) => { const match = /^registration:(t\d+)$/.exec(ctx.message.successful_payment.invoice_payload); const data = await readTournament(ctx); const team = match ? data.teams[match[1]] : undefined; if (!team || team.captainTelegramId !== String(ctx.from?.id ?? "") || team.status !== "awaiting_payment") return; team.paid = true; team.status = conflicts(data, team).length ? "pending_conflict" : "confirmed"; await writeTournament(ctx, data); await ctx.reply(team.status === "confirmed" ? `Оплата получена. Команда ${team.name} опубликована.` : "Оплата получена. Заявка ожидает проверки конфликта ID."); });
export default composer;
