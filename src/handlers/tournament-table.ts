import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { readTournament, teams } from "../tournament-store.js";

registerMainMenuItem({ label: "Teams", data: "teams:show", order: 30 });
registerMainMenuItem({ label: "Match table", data: "matches:show", order: 40 });
const composer = new Composer<Ctx>();
function status(status: string): string { return status === "confirmed" ? "Ready" : status === "awaiting_payment" ? "Payment pending" : status === "pending_conflict" ? "Under review" : status === "needs_correction" ? "Needs correction" : "Not accepted"; }
function teamText(list: ReturnType<typeof teams>): string { return list.length ? `Registered teams\n\n${list.map((team) => `${team.name} — ${status(team.status)}`).join("\n")}` : "No teams yet — tap Register team to add the first roster."; }
function matchText(list: ReturnType<typeof teams>): string { const active = list.filter((team) => team.status === "confirmed"); return active.length ? `Match table\n\n${active.map((team) => `${team.name} — ${team.matchStatus === "won" ? "Won" : team.matchStatus === "lost" ? "Lost" : team.matchLink ? "Match link posted" : "Match pending"}`).join("\n")}` : "No confirmed teams yet — the match table will appear after registrations are approved."; }
async function show(ctx: Ctx, kind: "team" | "match", edit: boolean): Promise<void> { const list = teams(await readTournament(ctx)); const text = kind === "team" ? teamText(list) : matchText(list); const rows: Array<Array<ReturnType<typeof inlineButton> | ReturnType<typeof urlButton>>> = kind === "match" ? list.filter((team) => team.status === "confirmed" && team.matchLink).slice(0, 7).map((team) => [urlButton(`Open ${team.name}`.slice(0, 24), team.matchLink!)]) : []; rows.push([inlineButton("Back to menu", "menu:main")]); const extra = inlineKeyboard(rows); if (edit) await ctx.editMessageText(text, { reply_markup: extra }); else await ctx.reply(text, { reply_markup: extra }); }
composer.callbackQuery("teams:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "team", true); });
composer.callbackQuery("matches:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "match", true); });
export default composer;
