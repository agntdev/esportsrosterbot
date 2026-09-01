import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Register team", data: "register:start", order: 10 });
registerMainMenuItem({ label: "View matches", data: "matches:show", order: 20 });
registerMainMenuItem({ label: "Help", data: "menu:help", order: 30 });
const composer = new Composer<Ctx>();
export const menu = () => inlineKeyboard([[inlineButton("Register team", "register:start")], [inlineButton("View matches", "matches:show")], [inlineButton("Help", "menu:help")]]);
export const welcome = "Manage your tournament roster here. Choose an option.";
composer.command("start", async (ctx) => { ctx.session.flow = undefined; await ctx.reply(welcome, { reply_markup: menu() }); });
composer.callbackQuery("menu:main", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.flow = undefined; await ctx.reply(welcome, { reply_markup: menu() }); });
export default composer;
