import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, readTournament, teams, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Edit team", data: "edit:team", order: 20 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "ID | nickname" } as const;

function rosterKeyboard(count: number) {
  const rows = [] as ReturnType<typeof inlineKeyboard>["inline_keyboard"];
  for (let i = 0; i < count; i += 1) rows.push([inlineButton(`Edit ${i < 5 ? `starter ${i + 1}` : `substitute ${i - 4}`}`, `edit:slot:${i}`)]);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

composer.callbackQuery("edit:team", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  const mine = teams(data).find((team) => team.captainTelegramId === String(ctx.from?.id ?? "") && team.status !== "rejected");
  if (!mine) { await ctx.reply("You don't have a registered team yet — tap Register team to create one."); return; }
  ctx.session.editingTeamId = mine.id;
  await ctx.reply(`Choose a player to update for ${mine.name}.`, { reply_markup: rosterKeyboard(mine.players.length) });
});

composer.callbackQuery(/^edit:slot:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const slot = Number(ctx.match?.[1]);
  const data = await readTournament(ctx);
  const team = ctx.session.editingTeamId ? data.teams[ctx.session.editingTeamId] : undefined;
  if (!team || team.captainTelegramId !== String(ctx.from?.id ?? "") || !Number.isInteger(slot) || slot < 0 || slot >= team.players.length) { await ctx.reply("That roster slot isn't available. Open Edit team and try again."); return; }
  ctx.session.flow = "edit_player";
  ctx.session.editingSlot = slot;
  await ctx.reply(`Send the replacement for ${slot < 5 ? `starter ${slot + 1}` : `substitute ${slot - 4}`} as ID | nickname.`, { reply_markup: input });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.flow !== "edit_player") return next();
  const [rawId, ...nicknameParts] = ctx.message.text.split("|");
  const inGameId = rawId?.trim(); const nickname = nicknameParts.join("|").trim();
  if (!inGameId || !nickname || inGameId.length > 64 || nickname.length > 64) { await ctx.reply("Use ID | nickname, then try again.", { reply_markup: input }); return; }
  const data = await readTournament(ctx);
  const team = ctx.session.editingTeamId ? data.teams[ctx.session.editingTeamId] : undefined;
  const slot = ctx.session.editingSlot;
  if (!team || slot === undefined || team.captainTelegramId !== String(ctx.from?.id ?? "")) { ctx.session.flow = undefined; await ctx.reply("That edit is no longer available. Open Edit team and try again."); return; }
  if (team.players.some((player, index) => index !== slot && player.inGameId.toLowerCase() === inGameId.toLowerCase())) { await ctx.reply("Each roster ID can only be used once. Send a different player.", { reply_markup: input }); return; }
  team.players[slot] = { inGameId, nickname, isSubstitute: slot >= 5 };
  const overlap = conflicts(data, team);
  team.status = overlap.length ? "pending_conflict" : "confirmed";
  await writeTournament(ctx, data);
  if (overlap.length) {
    const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
    const ids = team.players.filter((player) => overlap.some((other) => other.players.some((otherPlayer) => otherPlayer.inGameId.toLowerCase() === player.inGameId.toLowerCase()))).map((player) => player.inGameId).join(", ");
    if (admin) {
      try { await ctx.api.sendMessage(admin, `Roster conflict: ${team.name} overlaps with ${overlap.map((other) => other.name).join(", ")}. Conflicting IDs: ${ids}.`, { reply_markup: inlineKeyboard([[inlineButton("Keep this team", `conf:new:${team.id}`), inlineButton("Keep existing team", `conf:old:${team.id}`)]]) }); } catch { /* The roster remains available for desk review. */ }
    }
  }
  ctx.session.flow = undefined; ctx.session.editingSlot = undefined;
  await ctx.reply(overlap.length ? `Your roster was updated and is awaiting owner review because an in-game ID is already registered.` : `Your roster for ${team.name} has been updated.`, { reply_markup: inlineKeyboard([[inlineButton("Edit another player", "edit:team"), inlineButton("Match table", "matches:show")]]) });
});

export default composer;
