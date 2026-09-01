import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, nicknameConflict, readTournament, teamHeader, teamIdentity, teams, type NameSubject, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Редактировать команду", data: "edit:team", order: 20 });
const composer = new Composer<Ctx>();
const rosterInput = { force_reply: true, input_field_placeholder: "Game ID | никнейм" } as const;
const nameInput = { force_reply: true, input_field_placeholder: "Введите название команды" } as const;
type EditSession = {
  flow?: string;
  editingTeamId?: string;
  editingSlot?: number;
  pendingTeamName?: string;
  blockedName?: { value: string; subject: NameSubject };
};
const editSession = (ctx: Ctx): EditSession => ctx.session as unknown as EditSession;

function rosterKeyboard(count: number) {
  const rows = [] as ReturnType<typeof inlineKeyboard>["inline_keyboard"];
  for (let i = 0; i < count; i += 1) rows.push([inlineButton(`${i < 5 ? `Игрок ${i + 1}` : `Замена ${i - 4}`}`, `edit:slot:${i}`)]);
  rows.push([inlineButton("В меню", "menu:main")]);
  return inlineKeyboard(rows);
}

function identityKeyboard() {
  return inlineKeyboard([[inlineButton("Подтвердить ID", "edit:team:id:confirm")], [inlineButton("В меню", "menu:main")]]);
}

function completedIdentityKeyboard() {
  return inlineKeyboard([[inlineButton("Изменить состав", "edit:roster")], [inlineButton("Готово", "menu:main")]]);
}

function canEdit(ctx: Ctx, captainTelegramId: string): boolean {
  return isOwner(ctx) || captainTelegramId === String(ctx.from?.id ?? "");
}

async function beginIdentityStep(ctx: Ctx, teamId: string): Promise<void> {
  const data = await readTournament(ctx);
  const team = data.teams[teamId];
  if (!team || !canEdit(ctx, team.captainTelegramId)) {
    await ctx.reply("Эта команда недоступна для редактирования.");
    return;
  }
  editSession(ctx).editingTeamId = team.id;
  editSession(ctx).editingSlot = undefined;
  editSession(ctx).pendingTeamName = undefined;
  editSession(ctx).flow = "edit_team_id";
  await ctx.reply(`${teamIdentity(team)}\n\nID команды #${team.uniqueId} не изменяется. Подтвердите ID, чтобы перейти к названию.`, { reply_markup: identityKeyboard() });
}

composer.callbackQuery("edit:team", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  const available = isOwner(ctx)
    ? teams(data).filter((team) => team.status !== "rejected")
    : teams(data).filter((team) => team.captainTelegramId === String(ctx.from?.id ?? "") && team.status !== "rejected");
  if (!available.length) { await ctx.reply(isOwner(ctx) ? "Нет команд, доступных для редактирования." : "У вас пока нет команды — зарегистрируйте заявку."); return; }
  if (isOwner(ctx)) {
    await ctx.reply("Выберите команду для редактирования.", { reply_markup: inlineKeyboard([...available.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `edit:select:${team.id}`)]), [inlineButton("В меню", "menu:main")]]) });
    return;
  }
  await beginIdentityStep(ctx, available[0].id);
});

composer.callbackQuery(/^edit:select:(t\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) { await ctx.reply("Только организатор может выбирать чужую команду."); return; }
  await beginIdentityStep(ctx, ctx.match?.[1] ?? "");
});

composer.callbackQuery("edit:team:id:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = editSession(ctx);
  const data = await readTournament(ctx);
  const team = s.editingTeamId ? data.teams[s.editingTeamId] : undefined;
  if (s.flow !== "edit_team_id" || !team || !canEdit(ctx, team.captainTelegramId)) { await ctx.reply("Сначала откройте редактирование команды."); return; }
  s.flow = "edit_team_name";
  await ctx.reply(`ID команды #${team.uniqueId} подтверждён. Введите название команды. Текущее: ${team.name}.`, { reply_markup: nameInput });
});

composer.callbackQuery("edit:team:name:change", async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = editSession(ctx);
  if (s.flow !== "edit_team_name_blocked") { await ctx.reply("Сначала откройте редактирование команды."); return; }
  s.flow = "edit_team_name";
  s.pendingTeamName = undefined;
  s.blockedName = undefined;
  await ctx.reply("Введите другое название команды.", { reply_markup: nameInput });
});

composer.callbackQuery("edit:roster", async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = editSession(ctx);
  const data = await readTournament(ctx);
  const team = s.editingTeamId ? data.teams[s.editingTeamId] : undefined;
  if (s.flow !== undefined) { await ctx.reply("Сначала подтвердите ID команды и обновите название."); return; }
  if (!team || !canEdit(ctx, team.captainTelegramId)) { await ctx.reply("Редактирование больше недоступно. Откройте его снова."); return; }
  await ctx.reply(`Выберите игрока для изменения в команде ${teamIdentity(team)}.`, { reply_markup: rosterKeyboard(team.players.length) });
});

composer.callbackQuery(/^edit:slot:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const slot = Number(ctx.match?.[1]);
  const data = await readTournament(ctx);
  const s = editSession(ctx);
  const team = s.editingTeamId ? data.teams[s.editingTeamId] : undefined;
  if (s.flow !== undefined || !team || !canEdit(ctx, team.captainTelegramId) || !Number.isInteger(slot) || slot < 0 || slot >= team.players.length) { await ctx.reply("Этот слот недоступен. Откройте редактирование команды снова."); return; }
  s.flow = "edit_player";
  s.editingSlot = slot;
  await ctx.reply(`Введите Game ID и никнейм для ${slot < 5 ? `игрока ${slot + 1}` : `замены ${slot - 4}`} через |.`, { reply_markup: rosterInput });
});

composer.on("message:text", async (ctx, next) => {
  const s = editSession(ctx);
  if (s.flow === "edit_team_name") {
    const name = ctx.message.text.trim();
    const data = await readTournament(ctx);
    const team = s.editingTeamId ? data.teams[s.editingTeamId] : undefined;
    if (!team || !canEdit(ctx, team.captainTelegramId)) { s.flow = undefined; await ctx.reply("Редактирование больше недоступно. Откройте его снова."); return; }
    if (!name || name.length > 128) { await ctx.reply("Введите название команды до 128 символов.", { reply_markup: nameInput }); return; }
    if (nicknameConflict(data, name, "team", team.id)) {
      s.flow = "edit_team_name_blocked";
      s.blockedName = { value: name, subject: "team" };
      await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")], [inlineButton("Выбрать другой ник", "edit:team:name:change")]]) });
      return;
    }
    team.name = name;
    await writeTournament(ctx, data);
    s.flow = undefined;
    await ctx.reply(`Команда обновлена: ${teamIdentity(team)}.`, { reply_markup: completedIdentityKeyboard() });
    return;
  }
  if (s.flow !== "edit_player") return next();
  const [rawId, ...nicknameParts] = ctx.message.text.split("|");
  const inGameId = rawId?.trim(); const nickname = nicknameParts.join("|").trim();
  if (!inGameId || !nickname || inGameId.length > 128 || nickname.length > 128) { await ctx.reply("Введите Game ID и никнейм через |.", { reply_markup: rosterInput }); return; }
  const data = await readTournament(ctx);
  const team = s.editingTeamId ? data.teams[s.editingTeamId] : undefined;
  const slot = s.editingSlot;
  if (!team || slot === undefined || !canEdit(ctx, team.captainTelegramId)) { s.flow = undefined; await ctx.reply("Редактирование больше недоступно. Откройте его снова."); return; }
  if (team.players.some((player, index) => index !== slot && player.inGameId.toLowerCase() === inGameId.toLowerCase())) { await ctx.reply("Этот Game ID уже есть в составе. Укажите другой.", { reply_markup: rosterInput }); return; }
  if (nicknameConflict(data, nickname, "player", team.id, team.players.filter((_, index) => index !== slot).map((player) => player.nickname))) {
    s.blockedName = { value: nickname, subject: "player" };
    await ctx.reply("Похожий никнейм уже зарегистрирован в этом турнире — выберите другой ник или свяжитесь с администратором.", { reply_markup: inlineKeyboard([[inlineButton("Запросить проверку", "name:review")]]) });
    return;
  }
  team.players[slot] = { inGameId, nickname, isSubstitute: slot >= 5 };
  const overlap = conflicts(data, team);
  team.status = overlap.length ? "pending_conflict" : "confirmed";
  await writeTournament(ctx, data);
  if (overlap.length) {
    const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
    const ids = team.players.filter((player) => overlap.some((other) => other.players.some((otherPlayer) => otherPlayer.inGameId.toLowerCase() === player.inGameId.toLowerCase()))).map((player) => player.inGameId).join(", ");
    if (admin) {
      try { await ctx.api.sendMessage(admin, `${teamHeader(team)}\nКонфликт ID с: ${overlap.map((other) => teamIdentity(other)).join(", ")}. ID: ${ids}.`, { reply_markup: inlineKeyboard([[inlineButton("Оставить эту", `conf:new:${team.id}`), inlineButton("Оставить прежнюю", `conf:old:${team.id}`)]]) }); } catch { /* Заявка остаётся доступной для проверки. */ }
    }
  }
  s.flow = undefined; s.editingSlot = undefined;
  await ctx.reply(overlap.length ? "Состав обновлён и ожидает проверки конфликта ID." : `Состав команды ${teamIdentity(team)} обновлён.`, { reply_markup: inlineKeyboard([[inlineButton("Изменить ещё", "edit:team"), inlineButton("Таблица матчей", "matches:show")]]) });
});

export default composer;
