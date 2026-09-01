import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { readTournament, teams } from "../tournament-store.js";

registerMainMenuItem({ label: "Список команд", data: "teams:show", order: 30 });
registerMainMenuItem({ label: "Таблица матчей", data: "matches:show", order: 40 });
const composer = new Composer<Ctx>();
function status(status: string): string { return status === "confirmed" ? "Подтверждена" : status === "awaiting_payment" ? "Ожидает оплаты" : status === "pending_conflict" ? "На проверке" : status === "needs_correction" ? "Нужна правка" : "Отклонена"; }
function teamText(list: ReturnType<typeof teams>): string { return list.length ? `Команды\n\n${list.map((team) => `${team.name} — ${status(team.status)}`).join("\n")}` : "Команд пока нет — зарегистрируйте первую заявку."; }
function matchText(list: ReturnType<typeof teams>): string { const active = list.filter((team) => team.status === "confirmed"); return active.length ? `Таблица матчей\n\n${active.map((team) => `${team.name} — ${team.matchStatus === "won" ? "Победа" : team.matchStatus === "lost" ? "Поражение" : team.matchLink ? "Ссылка опубликована" : "Матч ожидается"}`).join("\n")}` : "Подтверждённых команд пока нет — таблица появится после регистрации."; }
async function show(ctx: Ctx, kind: "team" | "match", edit: boolean): Promise<void> { const list = teams(await readTournament(ctx)); const text = kind === "team" ? teamText(list) : matchText(list); const rows: Array<Array<ReturnType<typeof inlineButton> | ReturnType<typeof urlButton>>> = kind === "match" ? list.filter((team) => team.status === "confirmed" && team.matchLink).slice(0, 7).map((team) => [urlButton(`Открыть ${team.name}`.slice(0, 24), team.matchLink!)]) : []; rows.push([inlineButton("В меню", "menu:main")]); const extra = inlineKeyboard(rows); if (edit) await ctx.editMessageText(text, { reply_markup: extra }); else await ctx.reply(text, { reply_markup: extra }); }
composer.callbackQuery("teams:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "team", true); });
composer.callbackQuery("matches:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "match", true); });
export default composer;
