import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
const composer = new Composer<Ctx>();
const text = "Register a seven-player roster, review it, then submit it for approval. Use View matches for the public table.";
const keyboard = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
composer.command("help", async (ctx) => ctx.reply(text, { reply_markup: keyboard }));
composer.callbackQuery("menu:help", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(text, { reply_markup: keyboard }); });
export default composer;
