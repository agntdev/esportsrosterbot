import { Composer } from "grammy";
import type { Ctx } from "../bot.js";

/**
 * Active form input is transient: it may contain player IDs, contact details,
 * prices, or match URLs and should not be left in the chat after it is handled.
 * Durable tournament records deliberately live in tournament-store instead.
 */
type EphemeralEntry = { messageId: number; chatId: number; ephemeral: true };
type EphemeralSession = {
  flow?: string;
  ephemeralMessages?: EphemeralEntry[];
};

const composer = new Composer<Ctx>();

// Telegram may deliver a callback after its acknowledgement window.  A late
// acknowledgement is harmless, whereas letting its 400 abort the handler made
// valid buttons look unresponsive in production.
composer.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const answer = ctx.answerCallbackQuery.bind(ctx);
    (ctx as Ctx & { answerCallbackQuery: typeof answer }).answerCallbackQuery = async (...args) => {
      try {
        return await answer(...args);
      } catch (error) {
        if (!String(error).includes("query is too old") && !String(error).includes("query ID is invalid")) throw error;
        return true as never;
      }
    };
  }
  return next();
});

composer.on("message:text", async (ctx, next) => {
  const state = ctx.session as unknown as EphemeralSession;
  // Commands and ordinary chat messages are not form input. Only a message sent
  // while a flow is waiting for typed input is explicitly marked ephemeral.
  const isEphemeral = Boolean(state.flow) && !ctx.message.text.startsWith("/");
  const entry: EphemeralEntry | undefined = isEphemeral
    ? { messageId: ctx.message.message_id, chatId: ctx.chat.id, ephemeral: true }
    : undefined;

  if (entry) state.ephemeralMessages = [...(state.ephemeralMessages ?? []), entry];

  await next();

  if (!entry) return;
  try {
    await ctx.api.deleteMessage(entry.chatId, entry.messageId);
  } catch (error) {
    // A group may deny delete rights or Telegram may reject an old message.
    // Cleanup must never interrupt the reply or alter persistent records.
    console.error("Unable to delete ephemeral Telegram message", error);
  } finally {
    const current = state.ephemeralMessages ?? [];
    state.ephemeralMessages = current.filter((item) => item.messageId !== entry.messageId || item.chatId !== entry.chatId);
  }
});

export default composer;
