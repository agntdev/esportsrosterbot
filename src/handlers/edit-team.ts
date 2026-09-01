import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, readTournament, teams, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Редактировать команду", data: "edit:team", order: 20 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "ID | nickname" } as const;

function rosterKeyboard(count: number) {
  const rows = [] as ReturnType<typeof inlineKeyboard>["inline_keyboard"];
  for (let i = 0; i < count; i += 1) rows.push([inlineButton(`${i < 5 ? `Игрок ${i + 1}` : `Замена ${i - 4}`}`, `edit:slot:${i}`)]);
  rows.push([inlineButton("В меню", "menu:main")]);
  return inlineKeyboard(rows);
}

composer.callbackQuery("edit:team", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  const mine = teams(data).find((team) => team.captainTelegramId === String(ctx.from?.id ?? "") && team.status !== "rejected");
  if (!mine) { await ctx.reply("У вас пока нет команды — зарегистрируйте заявку."); return; }
  ctx.session.editingTeamId = mine.id;
  await ctx.reply(`Выберите игрока для изменения в команде ${mine.name}.`, { reply_markup: rosterKeyboard(mine.players.length) });
});

composer.callbackQuery(/^edit:slot:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const slot = Number(ctx.match?.[1]);
  const data = await readTournament(ctx);
  const team = ctx.session.editingTeamId ? data.teams[ctx.session.editingTeamId] : undefined;
  if (!team || team.captainTelegramId !== String(ctx.from?.id ?? "") || !Number.isInteger(slot) || slot < 0 || slot >= team.players.length) { await ctx.reply("Этот слот недоступен. Откройте редактирование команды снова."); return; }
  ctx.session.flow = "edit_player";
  ctx.session.editingSlot = slot;
  await ctx.reply(`Введите Game ID и никнейм для ${slot < 5 ? `игрока ${slot + 1}` : `замены ${slot - 4}`} через |.`, { reply_markup: input });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.flow !== "edit_player") return next();
  const [rawId, ...nicknameParts] = ctx.message.text.split("|");
  const inGameId = rawId?.trim(); const nickname = nicknameParts.join("|").trim();
  if (!inGameId || !nickname || inGameId.length > 128 || nickname.length > 128) { await ctx.reply("Введите Game ID и никнейм через |.", { reply_markup: input }); return; }
  const data = await readTournament(ctx);
  const team = ctx.session.editingTeamId ? data.teams[ctx.session.editingTeamId] : undefined;
  const slot = ctx.session.editingSlot;
  if (!team || slot === undefined || team.captainTelegramId !== String(ctx.from?.id ?? "")) { ctx.session.flow = undefined; await ctx.reply("Редактирование больше недоступно. Откройте его снова."); return; }
  if (team.players.some((player, index) => index !== slot && player.inGameId.toLowerCase() === inGameId.toLowerCase())) { await ctx.reply("Этот Game ID уже есть в составе. Укажите другой.", { reply_markup: input }); return; }
  team.players[slot] = { inGameId, nickname, isSubstitute: slot >= 5 };
  const overlap = conflicts(data, team);
  team.status = overlap.length ? "pending_conflict" : "confirmed";
  await writeTournament(ctx, data);
  if (overlap.length) {
    const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
    const ids = team.players.filter((player) => overlap.some((other) => other.players.some((otherPlayer) => otherPlayer.inGameId.toLowerCase() === player.inGameId.toLowerCase()))).map((player) => player.inGameId).join(", ");
    if (admin) {
      try { await ctx.api.sendMessage(admin, `Конфликт ID: ${team.name}. Команды: ${overlap.map((other) => other.name).join(", ")}. ID: ${ids}.`, { reply_markup: inlineKeyboard([[inlineButton("Оставить эту", `conf:new:${team.id}`), inlineButton("Оставить прежнюю", `conf:old:${team.id}`)]]) }); } catch { /* Заявка остаётся доступной для проверки. */ }
    }
  }
  ctx.session.flow = undefined; ctx.session.editingSlot = undefined;
  await ctx.reply(overlap.length ? "Состав обновлён и ожидает проверки конфликта ID." : `Состав команды ${team.name} обновлён.`, { reply_markup: inlineKeyboard([[inlineButton("Изменить ещё", "edit:team"), inlineButton("Таблица матчей", "matches:show")]]) });
});

export default composer;
