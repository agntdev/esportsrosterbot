import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const HELP = "Откройте /start и выберите действие кнопкой.\n\nРегистрация, состав команды и таблица матчей доступны в меню.";

const backToMenu = inlineKeyboard([[inlineButton("В меню", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText(HELP, { reply_markup: backToMenu });
  } catch (error) {
    // A repeat tap produces Telegram's harmless "message is not modified" 400.
    if (!String(error).includes("message is not modified")) throw error;
  }
});

export default composer;
