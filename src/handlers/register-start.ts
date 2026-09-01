import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, createNameReview, logEvent, nicknameConflict, now, readTournament, teamHeader, teamIdentity, type NameSubject, type Player, type Team, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Регистрация команды", data: "register:start", order: 10 });

type Draft = { name: string; captainContact: string; players: Player[] };
type EditableField = "name" | "captain" | "player" | "sub";
type RegistrationSession = {
  flow?: string;
  draft?: Draft;
  editField?: EditableField;
  editIndex?: number;
  pendingPlayer?: Player;
  afterName?: "starter_id" | "preview";
  blockedName?: { value: string; subject: NameSubject };
};
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Введите текст" } as const;
const session = (ctx: Ctx): RegistrationSession => ctx.session as unknown as RegistrationSession;

function reset(ctx: Ctx): void {
  session(ctx).flow = undefined;
  session(ctx).draft = undefined;
  session(ctx).editField = undefined;
  session(ctx).editIndex = undefined;
  session(ctx).pendingPlayer = undefined;
  session(ctx).afterName = undefined;
  session(ctx).blockedName = undefined;
}
function playerLabel(index: number): string { return index === 0 ? "Капитан" : `Игрок ${index + 1}`; }
function prompt(index: number, field: "id" | "nickname" | "contact"): string {
  if (field === "contact") return "Укажите контакт капитана: @username или номер телефона.";
  return `${playerLabel(index)} — ${field === "id" ? "Game ID" : "игровой никнейм"}.`;
}
function currentPlayer(draft: Draft): Player { return draft.players[draft.players.length - 1]; }
function optionalKeyboard() { return inlineKeyboard([[inlineButton("Добавить замену", "register:sub"), inlineButton("К просмотру", "register:preview")], [inlineButton("Отмена", "menu:main")]]); }
function previewKeyboard() { return inlineKeyboard([[inlineButton("Подтвердить", "register:confirm"), inlineButton("Редактировать", "register:edit")], [inlineButton("Отмена", "menu:main")]]); }
function editMenuKeyboard() {
  return inlineKeyboard([
    [inlineButton("Название команды", "register:edit:name"), inlineButton("Капитан", "register:edit:captain")],
    [inlineButton("Игрок 1", "register:edit:player:0"), inlineButton("Игрок 2", "register:edit:player:1")],
    [inlineButton("Игрок 3", "register:edit:player:2"), inlineButton("Игрок 4", "register:edit:player:3")],
    [inlineButton("Игрок 5", "register:edit:player:4"), inlineButton("Замена 1", "register:edit:sub:0")],
    [inlineButton("Замена 2", "register:edit:sub:1")],
    [inlineButton("К просмотру", "register:preview")],
  ]);
}
function formatApplication(team: Pick<Team, "uniqueId" | "name" | "captainContact" | "players"> | Draft, uniqueId?: number): string {
  const starters = team.players.filter((player) => !player.isSubstitute);
  const subs = team.players.filter((player) => player.isSubstitute);
  const number = "uniqueId" in team ? team.uniqueId : uniqueId;
  const lines = number ? [`🏆 Команда #${number} — ${team.name}`, `Капитан: ${starters[0]?.nickname ?? "не указан"}`, `Контакт капитана: ${team.captainContact}`, "Состав:"] : [`Команда: ${team.name}`, `Контакт капитана: ${team.captainContact}`, "Состав:"];
  lines.push(...starters.map((player, i) => `${i === 0 ? "Капитан" : `Игрок ${i + 1}`}: ${player.inGameId} — ${player.nickname}`));
  lines.push(subs.length ? `Замены: ${subs.map((player) => `${player.inGameId} — ${player.nickname}`).join("; ")}` : "Замены: нет");
  return lines.join("\n");
}
async function showPreview(ctx: Ctx): Promise<void> {
  const draft = session(ctx).draft;
  if (!draft || draft.players.filter((player) => !player.isSubstitute).length !== 5) {
    await ctx.reply("Сначала заполните пять основных игроков.");
    return;
  }
  session(ctx).flow = "preview";
  session(ctx).editField = undefined;
  session(ctx).editIndex = undefined;
  session(ctx).pendingPlayer = undefined;
  const data = await readTournament(ctx);
  await ctx.reply(`Проверьте заявку:\n\n${formatApplication(draft, data.nextTeamNumber)}`, { reply_markup: previewKeyboard() });
}
function editPlayer(draft: Draft, field: EditableField, index?: number): Player | undefined {
  if (field === "captain") return draft.players[0];
  if (field === "player" && index !== undefined) return draft.players[index];
  if (field === "sub" && index !== undefined) return draft.players.filter((player) => player.isSubstitute)[index];
  return undefined;
}
function duplicateDraftId(draft: Draft, player: Player): boolean {
  const id = player.inGameId.trim().toLocaleLowerCase();
  const matches = id ? draft.players.filter((item) => item !== player && item.inGameId.trim().toLocaleLowerCase() === id) : [];
  return matches.length > 0;
}
function conflictDetails(data: Awaited<ReturnType<typeof readTournament>>, team: Team): string {
  const overlaps = conflicts(data, team);
  const items = team.players.flatMap((player) => {
    const names = overlaps.filter((other) => other.players.some((p) => p.inGameId.toLowerCase() === player.inGameId.toLowerCase())).map(teamIdentity);
    return names.length ? [`${player.inGameId} (${names.join(", ")})`] : [];
  });
  return items.length ? `\nКонфликты ID: ${items.join(", ")}` : "\nКонфликтов ID нет.";
}
async function notifyAdmin(ctx: Ctx, data: Awaited<ReturnType<typeof readTournament>>, team: Team): Promise<boolean> {
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (!admin) return false;
  try {
    await ctx.api.sendMessage(admin, `${formatApplication(team)}${conflictDetails(data, team)}`, {
      reply_markup: conflicts(data, team).length ? inlineKeyboard([[inlineButton("Оставить новую", `conf:new:${team.id}`), inlineButton("Оставить прежнюю", `conf:old:${team.id}`)]]) : undefined,
    });
    logEvent(data, "admin_notified", team.id);
    return true;
  } catch { return false; }
}
async function publish(ctx: Ctx): Promise<void> {
  const draft = session(ctx).draft;
  const ids = draft?.players.map((player) => player.inGameId.trim().toLocaleLowerCase()).filter(Boolean) ?? [];
  if (!draft || draft.players.filter((p) => !p.isSubstitute).length !== 5 || !draft.captainContact || draft.players.some((player) => !player.inGameId.trim() || !player.nickname.trim()) || new Set(ids).size !== ids.length) { await ctx.reply("Анкета заполнена не полностью или содержит повторяющийся Game ID. Исправьте заявку и подтвердите её снова."); return; }
  const data = await readTournament(ctx);
  const blockedTeam = nicknameConflict(data, draft.name, "team");
  const blockedPlayer = draft.players.find((player, index) => nicknameConflict(data, player.nickname, "player", undefined, draft.players.filter((_, otherIndex) => otherIndex !== index).map((item) => item.nickname)));
  if (blockedTeam || blockedPlayer) {
    session(ctx).blockedName = blockedTeam ? { value: draft.name, subject: "team" } : { value: blockedPlayer!.nickname, subject: "player" };
    await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")], [inlineButton("Редактировать заявку", "register:edit")]]) });
    return;
  }
  const uniqueId = data.nextTeamNumber;
  const id = `t${uniqueId}`;
  const team: Team = { id, uniqueId, name: draft.name, captainContact: draft.captainContact, captainTelegramId: String(ctx.from?.id ?? ctx.chat?.id ?? ""), paid: data.registrationPrice === 0, status: data.registrationPrice === 0 ? "confirmed" : "awaiting_payment", players: draft.players };
  data.nextTeamNumber += 1; data.teamIds.push(id); data.teams[id] = team; logEvent(data, "team_created", id);
  const overlap = conflicts(data, team);
  if (overlap.length) team.status = "pending_conflict";
  const sent = await notifyAdmin(ctx, data, team);
  await writeTournament(ctx, data);
  reset(ctx);
  if (data.registrationPrice > 0) {
    await ctx.replyWithInvoice("Регистрация турнира", `Регистрация команды ${teamIdentity(team)}`, `registration:${id}`, "XTR", [{ label: "Регистрация", amount: data.registrationPrice }]);
    return;
  }
  const review = overlap.length ? " Заявка отмечена для проверки конфликта ID." : "";
  const adminNote = sent ? "" : " Уведомление организатору пока не настроено.";
  await ctx.reply(`${teamHeader(team)}\nКапитан: ${team.players[0]?.nickname ?? "не указан"}\nКоманда опубликована в списке команд.${review}${adminNote}`, { reply_markup: inlineKeyboard([[inlineButton("Список команд", "teams:show"), inlineButton("Редактировать команду", "edit:team")]]) });
}

async function acceptName(ctx: Ctx, value: string, afterName: "starter_id" | "preview"): Promise<void> {
  const draft = session(ctx).draft;
  if (!draft) return;
  draft.name = value.slice(0, 128);
  session(ctx).afterName = afterName;
  if (nicknameConflict(await readTournament(ctx), draft.name, "team")) {
    session(ctx).flow = "blocked_name";
    session(ctx).blockedName = { value: draft.name, subject: "team" };
    await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")], [inlineButton("Выбрать другой ник", "register:name:change")]]) });
    return;
  }
  if (afterName === "starter_id") {
    draft.players.push({ inGameId: "", nickname: "", isSubstitute: false });
    session(ctx).flow = "starter_id";
    await ctx.reply(prompt(0, "id"), { reply_markup: input });
  } else await showPreview(ctx);
}

composer.callbackQuery("register:start", async (ctx) => { await ctx.answerCallbackQuery(); session(ctx).flow = "team_name"; session(ctx).draft = { name: "", captainContact: "", players: [] }; await ctx.reply("Введите название команды.", { reply_markup: input }); });
composer.callbackQuery(["register:edit", "register:restart"], async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!session(ctx).draft || session(ctx).flow !== "preview") {
    await ctx.reply("Сначала откройте просмотр заявки.");
    return;
  }
  await ctx.reply("Выберите поле для изменения.", { reply_markup: editMenuKeyboard() });
});
composer.callbackQuery("register:edit:name", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = session(ctx).draft;
  if (!draft || session(ctx).flow !== "preview") { await ctx.reply("Сначала откройте просмотр заявки."); return; }
  session(ctx).flow = "edit_name";
  session(ctx).editField = "name";
  await ctx.reply(`Введите название команды. Текущее: ${draft.name}`, { reply_markup: input });
});
composer.callbackQuery("register:name:change", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!session(ctx).draft || !["blocked_name", "duplicate_name"].includes(session(ctx).flow ?? "")) { await ctx.reply("Введите название команды ещё раз."); return; }
  session(ctx).flow = "team_name";
  session(ctx).blockedName = undefined;
  await ctx.reply("Введите другое название команды.", { reply_markup: input });
});
composer.callbackQuery("name:review", async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = session(ctx); const blocked = s.blockedName;
  if (!blocked) { await ctx.reply("Сначала отправьте никнейм на проверку."); return; }
  const data = await readTournament(ctx);
  const review = createNameReview(data, String(ctx.from?.id ?? ctx.chat?.id ?? ""), blocked.value, blocked.subject);
  await writeTournament(ctx, data);
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (admin) {
    try { await ctx.api.sendMessage(admin, `Проверка похожего никнейма: ${blocked.value}.`, { reply_markup: inlineKeyboard([[inlineButton("Разрешить ник", `admin:name:approve:${review.id}`), inlineButton("Отклонить", `admin:name:reject:${review.id}`)]]) }); } catch { /* The request remains in the owner desk. */ }
  }
  await ctx.reply("Запрос на проверку отправлен организатору. После решения введите ник ещё раз.");
});
composer.callbackQuery("register:edit:captain", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = session(ctx).draft;
  if (!draft || session(ctx).flow !== "preview") { await ctx.reply("Сначала откройте просмотр заявки."); return; }
  session(ctx).flow = "edit_id";
  session(ctx).editField = "captain";
  session(ctx).editIndex = 0;
  await ctx.reply(`Капитан — Game ID. Текущее: ${draft.players[0]?.inGameId ?? "не указано"}.`, { reply_markup: input });
});
composer.callbackQuery(/^register:edit:(player|sub):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = session(ctx).draft;
  const field = ctx.match?.[1] as EditableField | undefined;
  const index = Number(ctx.match?.[2]);
  if (!draft || session(ctx).flow !== "preview" || !field || !Number.isInteger(index)) { await ctx.reply("Сначала откройте просмотр заявки."); return; }
  if (field === "player" && (index < 0 || index > 4 || !draft.players[index])) { await ctx.reply("Этот игрок недоступен для изменения."); return; }
  const subs = draft.players.filter((player) => player.isSubstitute);
  if (field === "sub" && (index < 0 || index > 1 || (index === 1 && !subs[0]))) { await ctx.reply(index === 1 ? "Сначала добавьте первую замену." : "Эта замена недоступна для изменения."); return; }
  let player = editPlayer(draft, field, index);
  // Keep a new substitute out of the draft until both required fields have been
  // saved, so backing out cannot leave an incomplete roster entry behind.
  if (field === "sub" && !player) {
    player = { inGameId: "", nickname: "", isSubstitute: true };
    session(ctx).pendingPlayer = player;
  }
  if (!player) { await ctx.reply("Этот игрок недоступен для изменения."); return; }
  session(ctx).flow = "edit_id";
  session(ctx).editField = field;
  session(ctx).editIndex = index;
  const label = field === "sub" ? `Замена ${index + 1}` : `Игрок ${index + 1}`;
  await ctx.reply(`${label} — Game ID. Текущее: ${player.inGameId || "не указано"}.`, { reply_markup: input });
});
composer.callbackQuery("register:sub", async (ctx) => { await ctx.answerCallbackQuery(); const draft = session(ctx).draft; if (!draft || session(ctx).flow !== "sub_choice") { await ctx.reply("Сначала заполните основную заявку."); return; } if (draft.players.filter((p) => p.isSubstitute).length >= 2) { await ctx.reply("Можно добавить не больше двух замен. Перейдите к просмотру.", { reply_markup: optionalKeyboard() }); return; } draft.players.push({ inGameId: "", nickname: "", isSubstitute: true }); session(ctx).flow = "sub_id"; await ctx.reply("Замена — Game ID.", { reply_markup: input }); });
composer.callbackQuery("register:preview", async (ctx) => { await ctx.answerCallbackQuery(); await showPreview(ctx); });
composer.callbackQuery("register:confirm", async (ctx) => { await ctx.answerCallbackQuery(); if (session(ctx).flow !== "preview") { await ctx.reply("Сначала откройте просмотр заявки."); return; } await publish(ctx); });

composer.on("message:text", async (ctx, next) => {
  const s = session(ctx); const flow = s.flow; if (!flow || ["price", "match_link", "edit_player"].includes(flow)) return next();
  const value = ctx.message.text.trim(); const draft = s.draft;
  if (!draft) { reset(ctx); await ctx.reply("Срок заполнения анкеты истёк. Начните регистрацию заново."); return; }
  if (flow === "edit_name") {
    if (!value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
    await acceptName(ctx, value, "preview");
    return;
  }
  if (flow === "edit_id") {
    const player = editPlayer(draft, s.editField ?? "player", s.editIndex) ?? s.pendingPlayer;
    if (!player || !value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
    const candidate = { ...player, inGameId: value.slice(0, 128) };
    if (duplicateDraftId(draft, candidate)) { await ctx.reply("Этот Game ID уже есть в составе. Укажите другой.", { reply_markup: input }); return; }
    player.inGameId = candidate.inGameId;
    s.flow = "edit_nickname";
    const label = s.editField === "captain" ? "Капитан" : s.editField === "sub" ? `Замена ${(s.editIndex ?? 0) + 1}` : `Игрок ${(s.editIndex ?? 0) + 1}`;
    await ctx.reply(`${label} — игровой никнейм. Текущее: ${player.nickname || "не указано"}.`, { reply_markup: input });
    return;
  }
  if (flow === "edit_nickname") {
    const player = editPlayer(draft, s.editField ?? "player", s.editIndex) ?? s.pendingPlayer;
    if (!player || !value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
    const candidate = value.slice(0, 128);
    const localNames = draft.players.filter((item) => item !== player).map((item) => item.nickname).filter(Boolean);
    if (nicknameConflict(await readTournament(ctx), candidate, "player", undefined, localNames)) {
      s.blockedName = { value: candidate, subject: "player" };
      await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")]]) });
      return;
    }
    player.nickname = candidate;
    if (s.editField === "captain") {
      s.flow = "edit_contact";
      await ctx.reply(`Укажите контакт капитана. Текущий: ${draft.captainContact || "не указано"}.`, { reply_markup: input });
      return;
    }
    if (s.editField === "sub" && !draft.players.includes(player)) draft.players.push(player);
    await showPreview(ctx);
    return;
  }
  if (flow === "edit_contact") {
    if (!value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
    draft.captainContact = value.slice(0, 128);
    await showPreview(ctx);
    return;
  }
  if (flow === "team_name") { const fallback = ctx.from?.username?.trim() || ctx.from?.first_name?.trim() || "Команда"; await acceptName(ctx, value || `${fallback}-${now()}`, "starter_id"); return; }
  if (!value) { await ctx.reply("Это поле обязательно. Введите значение.", { reply_markup: input }); return; }
  if (flow === "starter_id" || flow === "sub_id") {
    const player = currentPlayer(draft);
    const candidate = { ...player, inGameId: value.slice(0, 128) };
    if (duplicateDraftId(draft, candidate)) { await ctx.reply("Этот Game ID уже есть в составе. Укажите другой.", { reply_markup: input }); return; }
    player.inGameId = candidate.inGameId;
    s.flow = flow === "starter_id" ? "starter_nickname" : "sub_nickname";
    await ctx.reply(prompt(draft.players.length - 1, "nickname"), { reply_markup: input });
    return;
  }
  if (flow === "starter_nickname" || flow === "sub_nickname") {
    const player = currentPlayer(draft);
    const candidate = value.slice(0, 128);
    const localNames = draft.players.filter((item) => item !== player).map((item) => item.nickname).filter(Boolean);
    if (nicknameConflict(await readTournament(ctx), candidate, "player", undefined, localNames)) {
      s.blockedName = { value: candidate, subject: "player" };
      await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")]]) });
      return;
    }
    player.nickname = candidate;
    if (flow === "sub_nickname") { s.flow = "sub_choice"; await ctx.reply("Замена добавлена. Добавьте ещё одну или перейдите к просмотру.", { reply_markup: optionalKeyboard() }); return; }
    if (draft.players.length === 1) { s.flow = "captain_contact"; await ctx.reply(prompt(0, "contact"), { reply_markup: input }); return; }
    if (draft.players.length < 5) { draft.players.push({ inGameId: "", nickname: "", isSubstitute: false }); s.flow = "starter_id"; await ctx.reply(prompt(draft.players.length - 1, "id"), { reply_markup: input }); return; }
    s.flow = "sub_choice"; await ctx.reply("Пять основных игроков добавлены. Можно указать до двух замен.", { reply_markup: optionalKeyboard() }); return;
  }
  if (flow === "captain_contact") { draft.captainContact = value.slice(0, 128); draft.players.push({ inGameId: "", nickname: "", isSubstitute: false }); s.flow = "starter_id"; await ctx.reply(prompt(1, "id"), { reply_markup: input }); }
});

composer.on("pre_checkout_query", async (ctx) => { const match = /^registration:(t\d+)$/.exec(ctx.preCheckoutQuery.invoice_payload); const data = await readTournament(ctx); const team = match ? data.teams[match[1]] : undefined; const valid = Boolean(team && team.captainTelegramId === String(ctx.from?.id ?? "") && team.status === "awaiting_payment" && ctx.preCheckoutQuery.currency === "XTR" && ctx.preCheckoutQuery.total_amount === data.registrationPrice); await ctx.answerPreCheckoutQuery(valid, valid ? undefined : { error_message: "Эта регистрация больше недоступна. Начните заново." }); });
composer.on("message:successful_payment", async (ctx) => { const match = /^registration:(t\d+)$/.exec(ctx.message.successful_payment.invoice_payload); const data = await readTournament(ctx); const team = match ? data.teams[match[1]] : undefined; if (!team || team.captainTelegramId !== String(ctx.from?.id ?? "") || team.status !== "awaiting_payment") return; team.paid = true; team.status = conflicts(data, team).length ? "pending_conflict" : "confirmed"; await writeTournament(ctx, data); await ctx.reply(team.status === "confirmed" ? `Оплата получена. Команда ${teamIdentity(team)} опубликована.` : `Оплата получена. ${teamIdentity(team)} ожидает проверки конфликта ID.`); });
export default composer;
