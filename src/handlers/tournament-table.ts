import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { allTeams, matchLabel, readTournament, statusLabel } from "../tournament-store.js";
const composer = new Composer<Ctx>();
async function table(ctx: Ctx) { const data = await readTournament(ctx); const teams = allTeams(data); const teamLines = teams.length ? teams.map((team) => `${team.name} — ${statusLabel(team.status)}`) : ["No teams registered yet."]; const matchLines = data.matchIds.length ? data.matchIds.map((id) => { const match = data.matches[id]; return `${matchLabel(data, match)} — ${match.status}${match.link ? `\n${match.link}` : ""}`; }) : ["No matches scheduled yet."]; return `Teams\n${teamLines.join("\n")}\n\nMatches\n${matchLines.join("\n")}`; }
async function show(ctx: Ctx) { await ctx.reply(await table(ctx), { reply_markup: inlineKeyboard([[inlineButton("Register team", "register:start"), inlineButton("Back to menu", "menu:main")]]) }); }
composer.command("matches", show);
composer.callbackQuery("matches:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
export default composer;
