import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Выберите действие для участия в турнире.";
const MENU_REPLY_KEYBOARD = {
  keyboard: [[{ text: "Главное меню" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  input_field_placeholder: "Откройте главное меню",
};

async function sendMenu(ctx: Ctx): Promise<void> {
  const sent = await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
  if (ctx.chat?.type === "private") {
    await ctx.reply("Главное меню всегда доступно с клавиатуры ниже.", { reply_markup: MENU_REPLY_KEYBOARD });
  }
  // In groups the inline menu is the stable navigation surface. Pinning is
  // best-effort because many groups do not grant the bot that permission.
  if (ctx.chat && ctx.chat.type !== "private") {
    try { await ctx.api.pinChatMessage(ctx.chat.id, sent.message_id, { disable_notification: true }); } catch { /* Pin permission is optional. */ }
  }
}

composer.command("start", async (ctx) => {
  await sendMenu(ctx);
});

// A recoverable menu is deliberately a shortcut command: it restores the
// button-first surface after a user has deleted an earlier menu message.
composer.command("menu", async (ctx) => {
  await sendMenu(ctx);
});

composer.hears("Главное меню", async (ctx) => {
  await sendMenu(ctx);
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
