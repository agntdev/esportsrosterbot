import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, isOwner, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { conflicts, logEvent, normalizeNickname, readTournament, teamHeader, teamIdentity, teams, writeTournament } from "../tournament-store.js";

registerMainMenuItem({ label: "Organizer desk", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const input = { force_reply: true, input_field_placeholder: "Type here" } as const;
async function owner(ctx: Ctx): Promise<boolean> { if (isOwner(ctx)) { await ctx.answerCallbackQuery(); return true; } return requireOwner(ctx as never); }
function deskKeyboard() { return inlineKeyboard([[inlineButton("Set registration price", "admin:price")], [inlineButton("Resolve conflicts", "admin:conflicts")], [inlineButton("Review nickname requests", "admin:names")], [inlineButton("Manage matches", "admin:matches")], [inlineButton("Back to menu", "menu:main")]]); }

composer.callbackQuery("admin:desk", async (ctx) => { if (!(await owner(ctx))) return; await ctx.reply("Manage registrations, conflicts, and matches.", { reply_markup: deskKeyboard() }); });
composer.callbackQuery("admin:price", async (ctx) => { if (!(await owner(ctx))) return; ctx.session.flow = "price"; await ctx.reply("Send the registration price as a whole number. Send 0 to keep registration free.", { reply_markup: input }); });
composer.callbackQuery("admin:conflicts", async (ctx) => { if (!(await owner(ctx))) return; const list = teams(await readTournament(ctx)).filter((team) => team.status === "pending_conflict" || team.status === "needs_correction"); await ctx.reply(list.length ? "Choose a roster conflict to resolve." : "No roster conflicts need review.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:conf:${team.id}`)]), [inlineButton("Back to desk", "admin:desk")]]) : deskKeyboard() }); });
composer.callbackQuery("admin:names", async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); const pending = data.nameReviewIds.map((id) => data.nameReviews[id]).filter((review) => review?.status === "pending");
  await ctx.reply(pending.length ? "Choose a nickname review." : "No nickname reviews need attention.", { reply_markup: pending.length ? inlineKeyboard([...pending.slice(0, 7).map((review) => [inlineButton(review.candidate.slice(0, 32), `admin:name:open:${review.id}`)]), [inlineButton("Back to desk", "admin:desk")]]) : deskKeyboard() });
});
composer.callbackQuery(/^admin:name:open:(n\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const review = (await readTournament(ctx)).nameReviews[ctx.match?.[1] ?? ""];
  if (!review || review.status !== "pending") { await ctx.reply("That nickname review is no longer available."); return; }
  await ctx.reply(`Review nickname: ${review.candidate}.`, { reply_markup: inlineKeyboard([[inlineButton("Approve override", `admin:name:approve:${review.id}`), inlineButton("Reject", `admin:name:reject:${review.id}`)], [inlineButton("Back to desk", "admin:desk")]]) });
});
composer.callbackQuery(/^admin:name:(approve|reject):(n\d+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); const review = data.nameReviews[ctx.match?.[2] ?? ""];
  if (!review || review.status !== "pending") { await ctx.reply("That nickname review is no longer available."); return; }
  const approved = ctx.match?.[1] === "approve";
  review.status = approved ? "approved" : "rejected";
  if (approved && !data.nameOverrides.some((item) => item.subject === review.subject && item.normalized === normalizeNickname(review.candidate))) data.nameOverrides.push({ subject: review.subject, normalized: normalizeNickname(review.candidate) });
  logEvent(data, approved ? "name_override_approved" : "name_override_rejected", undefined, review.id);
  await writeTournament(ctx, data);
  if (approved) {
    try { await ctx.api.sendMessage(review.requestedBy, `Организатор разрешил никнейм «${review.candidate}». Введите его ещё раз, чтобы продолжить.`); } catch { /* The requester may have blocked the bot. */ }
  }
  await ctx.reply(approved ? `Override approved for ${review.candidate}.` : `Nickname review rejected for ${review.candidate}.`, { reply_markup: deskKeyboard() });
});
composer.callbackQuery(/^admin:conf:(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = data.teams[ctx.match?.[1] ?? ""]; if (!team) { await ctx.reply("That team is no longer available."); return; } const overlap = conflicts(data, team); await ctx.reply(overlap.length ? `${teamHeader(team)} overlaps with ${overlap.map(teamIdentity).join(", ")}. Choose which registration to keep.` : `${teamHeader(team)} no longer has a roster conflict.`, { reply_markup: overlap.length ? inlineKeyboard([[inlineButton("Keep this team", `conf:new:${team.id}`), inlineButton("Keep existing team", `conf:old:${team.id}`)]]) : deskKeyboard() }); });
composer.callbackQuery(/^conf:(new|old):(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = data.teams[ctx.match?.[2] ?? ""]; if (!team) { await ctx.reply("That conflict is no longer available."); return; } const overlap = conflicts(data, team); if (ctx.match?.[1] === "new") { team.status = "confirmed"; for (const other of overlap) other.status = "needs_correction"; } else team.status = "rejected"; await writeTournament(ctx, data); await ctx.reply(ctx.match?.[1] === "new" ? `${teamIdentity(team)} is confirmed. The conflicting roster needs correction.` : `${teamIdentity(team)} was not accepted. The existing roster stays confirmed.`, { reply_markup: deskKeyboard() }); });
composer.callbackQuery("admin:matches", async (ctx) => { if (!(await owner(ctx))) return; const list = teams(await readTournament(ctx)).filter((team) => team.status === "confirmed"); await ctx.reply(list.length ? "Choose a team to update." : "No confirmed teams are ready for match updates.", { reply_markup: list.length ? inlineKeyboard([...list.slice(0, 7).map((team) => [inlineButton(teamIdentity(team).slice(0, 24), `admin:match:${team.id}`)]), [inlineButton("Back to desk", "admin:desk")]]) : deskKeyboard() }); });
composer.callbackQuery(/^admin:match:(t\d+)$/, async (ctx) => { if (!(await owner(ctx))) return; const teamId = ctx.match?.[1]; const data = await readTournament(ctx); const team = teamId ? data.teams[teamId] : undefined; if (!team) { await ctx.reply("That team is no longer available."); return; } ctx.session.managingTeamId = team.id; await ctx.reply(`Update ${teamIdentity(team)}.`, { reply_markup: inlineKeyboard([[inlineButton("Attach match link", "admin:link")], [inlineButton("Mark won", "admin:result:won"), inlineButton("Mark lost", "admin:result:lost")], [inlineButton("Mark pending", "admin:result:pending")]]) }); });
composer.callbackQuery("admin:link", async (ctx) => { if (!(await owner(ctx))) return; if (!ctx.session.managingTeamId) { await ctx.reply("Choose a team from Manage matches first."); return; } ctx.session.flow = "match_link"; await ctx.reply("Send the full match link, starting with https://.", { reply_markup: input }); });
composer.callbackQuery(/^admin:result:(won|lost|pending)$/, async (ctx) => { if (!(await owner(ctx))) return; const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { await ctx.reply("Choose a team from Manage matches first."); return; } team.matchStatus = ctx.match?.[1] as "won" | "lost" | "pending"; await writeTournament(ctx, data); await ctx.reply(`${teamIdentity(team)} is marked ${ctx.match?.[1]}.`, { reply_markup: deskKeyboard() }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.flow !== "price" && ctx.session.flow !== "match_link") return next(); if (!isOwner(ctx)) { ctx.session.flow = undefined; await ctx.reply("Only the owner can do that."); return; } if (ctx.session.flow === "price") { const price = Number(ctx.message.text.trim()); if (!Number.isInteger(price) || price < 0 || price > 1_000_000) { await ctx.reply("Send a whole number from 0 to 1000000.", { reply_markup: input }); return; } const data = await readTournament(ctx); data.registrationPrice = price; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(price === 0 ? "Registration is free." : `Registration costs ${price} Telegram Stars.`, { reply_markup: deskKeyboard() }); return; } const link = ctx.message.text.trim(); if (!/^https:\/\/.+/.test(link) || link.length > 512) { await ctx.reply("Send a valid https:// match link.", { reply_markup: input }); return; } const data = await readTournament(ctx); const team = ctx.session.managingTeamId ? data.teams[ctx.session.managingTeamId] : undefined; if (!team) { ctx.session.flow = undefined; await ctx.reply("Choose a team from Manage matches first."); return; } team.matchLink = link; await writeTournament(ctx, data); ctx.session.flow = undefined; await ctx.reply(`Match link attached for ${teamIdentity(team)}.`, { reply_markup: deskKeyboard() }); });

export default composer;
