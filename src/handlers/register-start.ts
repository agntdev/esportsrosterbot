import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { conflicts, now, readTournament, type Player, type Team, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Register team", data: "register:start", order: 10 });

const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Type here" } as const;

function reset(ctx: Ctx): void {
  ctx.session.flow = undefined;
  ctx.session.draft = undefined;
}
function playerPrompt(position: number): string {
  return `Starter ${position} of 5: send the in-game ID and nickname as ID | nickname.`;
}
function parsePlayer(text: string): Player | undefined {
  const [id, ...rest] = text.split("|");
  const nickname = rest.join("|").trim();
  const inGameId = id?.trim();
  if (!inGameId || !nickname || inGameId.length > 64 || nickname.length > 64) return undefined;
  return { inGameId, nickname, isSubstitute: false };
}
function subKeyboard() {
  return inlineKeyboard([[inlineButton("Add substitute", "register:sub"), inlineButton("Finish roster", "register:finish")], [inlineButton("Back to menu", "menu:main")]]);
}

async function saveDraft(ctx: Ctx): Promise<void> {
  const draft = ctx.session.draft;
  if (!draft || draft.players.filter((player) => !player.isSubstitute).length !== 5) {
    await ctx.reply("Your roster needs five starters before it can be submitted.");
    return;
  }
  const data = await readTournament(ctx);
  const id = `t${data.nextTeamNumber}`;
  const team: Team = { id, name: draft.name, captainTelegramId: String(ctx.from?.id ?? ctx.chat?.id ?? ""), paid: data.registrationPrice === 0, status: data.registrationPrice === 0 ? "confirmed" : "awaiting_payment", players: draft.players };
  if (data.registrationPrice > 0) {
    data.nextTeamNumber += 1;
    data.teamIds.push(id);
    data.teams[id] = team;
    await writeTournament(ctx, data);
    reset(ctx);
    await ctx.replyWithInvoice("Tournament registration", `Registration for ${team.name}`, `registration:${id}`, "XTR", [{ label: "Registration", amount: data.registrationPrice }]);
    return;
  }
  const duplicate = conflicts(data, team);
  data.nextTeamNumber += 1;
  data.teamIds.push(id);
  data.teams[id] = team;
  if (duplicate.length > 0) {
    team.status = "pending_conflict";
    await writeTournament(ctx, data);
    reset(ctx);
    const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
    if (!admin) {
    await ctx.reply("Your roster has an in-game ID already used by another team. Owner access isn't set up yet, so it can't be reviewed.");
      return;
    }
    const names = duplicate.map((other) => other.name).join(", ");
    const ids = team.players.filter((player) => duplicate.some((other) => other.players.some((otherPlayer) => otherPlayer.inGameId.toLowerCase() === player.inGameId.toLowerCase()))).map((player) => player.inGameId).join(", ");
    try {
      await ctx.api.sendMessage(admin, `Roster conflict: ${team.name} overlaps with ${names}. Conflicting IDs: ${ids}.`, { reply_markup: inlineKeyboard([[inlineButton("Keep new team", `conf:new:${id}`), inlineButton("Keep existing team", `conf:old:${id}`)]]) });
    } catch {
      // The captain still receives the pending-review state below.
    }
    await ctx.reply("Your roster is awaiting owner review because an in-game ID is already registered.");
    return;
  }
  await writeTournament(ctx, data);
  reset(ctx);
  await ctx.reply(`Team ${team.name} is registered. Your roster is confirmed.`, { reply_markup: inlineKeyboard([[inlineButton("View teams", "teams:show"), inlineButton("Match table", "matches:show")]]) });
}

composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = "team_name";
  ctx.session.draft = { name: "", players: [] };
  await ctx.reply("Send your team name. Send a blank message to use your Telegram name.", { reply_markup: input });
});

composer.callbackQuery("register:sub", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = ctx.session.draft;
  if (ctx.session.flow !== "substitute" || !draft) { await ctx.reply("Start a registration first."); return; }
  if (draft.players.filter((player) => player.isSubstitute).length >= 2) { await ctx.reply("You already have two substitutes. Tap Finish roster."); return; }
  await ctx.reply("Send the substitute's in-game ID and nickname as ID | nickname.", { reply_markup: input });
});

composer.callbackQuery("register:finish", async (ctx) => {
  await ctx.answerCallbackQuery();
  await saveDraft(ctx);
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.flow;
  if (!flow || flow === "edit_player" || flow === "price") return next();
  const text = ctx.message.text.trim();
  if (flow === "team_name") {
    const fallback = ctx.from?.username?.trim() || ctx.from?.first_name?.trim() || "Captain";
    ctx.session.draft = { name: text || `${fallback}-${now()}`, players: [] };
    ctx.session.flow = "starter";
    await ctx.reply(playerPrompt(1), { reply_markup: input });
    return;
  }
  const player = parsePlayer(text);
  if (!player) { await ctx.reply("Use ID | nickname, then try again.", { reply_markup: input }); return; }
  const draft = ctx.session.draft;
  if (!draft) { reset(ctx); await ctx.reply("That registration expired. Tap Register team to start again."); return; }
  if (draft.players.some((existing) => existing.inGameId.toLowerCase() === player.inGameId.toLowerCase())) { await ctx.reply("Each roster ID can only be used once. Send a different player.", { reply_markup: input }); return; }
  if (flow === "starter") {
    draft.players.push(player);
    const count = draft.players.filter((item) => !item.isSubstitute).length;
    if (count < 5) await ctx.reply(playerPrompt(count + 1), { reply_markup: input });
    else { ctx.session.flow = "substitute"; await ctx.reply("Your five starters are set. Add up to two substitutes, or finish the roster.", { reply_markup: subKeyboard() }); }
    return;
  }
  if (flow === "substitute") {
    player.isSubstitute = true;
    draft.players.push(player);
    await ctx.reply("Substitute added. Add another or finish the roster.", { reply_markup: subKeyboard() });
  }
});

composer.on("pre_checkout_query", async (ctx) => {
  const match = /^registration:(t\d+)$/.exec(ctx.preCheckoutQuery.invoice_payload);
  const data = await readTournament(ctx);
  const team = match ? data.teams[match[1]] : undefined;
  const valid = Boolean(team && team.captainTelegramId === String(ctx.from?.id ?? "") && team.status === "awaiting_payment" && ctx.preCheckoutQuery.currency === "XTR" && ctx.preCheckoutQuery.total_amount === data.registrationPrice);
  await ctx.answerPreCheckoutQuery(valid, valid ? undefined : { error_message: "This registration is no longer available. Start a new registration." });
});

composer.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const match = /^registration:(t\d+)$/.exec(payment.invoice_payload);
  const data = await readTournament(ctx);
  const team = match ? data.teams[match[1]] : undefined;
  if (!team || team.captainTelegramId !== String(ctx.from?.id ?? "") || team.status !== "awaiting_payment" || payment.currency !== "XTR" || payment.total_amount !== data.registrationPrice) return;
  team.paid = true;
  team.status = "confirmed";
  const duplicate = conflicts(data, team);
  if (duplicate.length) {
    team.status = "pending_conflict";
    const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
    if (admin) {
      const ids = team.players.filter((player) => duplicate.some((other) => other.players.some((otherPlayer) => otherPlayer.inGameId.toLowerCase() === player.inGameId.toLowerCase()))).map((player) => player.inGameId).join(", ");
      try { await ctx.api.sendMessage(admin, `Roster conflict: ${team.name} overlaps with ${duplicate.map((other) => other.name).join(", ")}. Conflicting IDs: ${ids}.`, { reply_markup: inlineKeyboard([[inlineButton("Keep new team", `conf:new:${team.id}`), inlineButton("Keep existing team", `conf:old:${team.id}`)]]) }); } catch { /* Captain confirmation still completes. */ }
    }
  }
  await writeTournament(ctx, data);
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (admin) { try { await ctx.api.sendMessage(admin, `Payment received for ${team.name}.`); } catch { /* Captain confirmation still completes. */ } }
  await ctx.reply(duplicate.length ? "Payment received. Your roster is awaiting owner review because an in-game ID is already registered." : `Payment received. Team ${team.name} is registered.`);
});

export default composer;
