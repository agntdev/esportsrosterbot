import { Composer } from "grammy";
import { createBot, type BotContext, type CreateBotOptions } from "./toolkit/index.js";
import { resolveSessionStorage } from "./toolkit/session/redis.js";
import type { StorageAdapter } from "grammy";
import adminDesk from "./handlers/admin-desk.js";
import editTeam from "./handlers/edit-team.js";
import help from "./handlers/help.js";
import registerStart from "./handlers/register-start.js";
import start from "./handlers/start.js";
import tournamentTable from "./handlers/tournament-table.js";

export interface Session { flow?: string; draft?: { name: string; players: Array<{ fullName: string; inGameId: string; telegramUsername?: string; isSubstitute: boolean }> }; editIndex?: number; adminTeamId?: string; adminMatchId?: string; }
export type Ctx = BotContext<Session> & { tournamentStorage?: StorageAdapter<unknown> };
export interface BuildBotOptions { handlers?: Composer<Ctx>[]; storage?: StorageAdapter<Session>; telemetryEnv?: CreateBotOptions<Session>["telemetryEnv"]; telemetryReporterOptions?: CreateBotOptions<Session>["telemetryReporterOptions"]; }
export function buildBot(token: string, opts: BuildBotOptions = {}) {
  const storage = opts.storage ?? resolveSessionStorage<Session>(undefined);
  const bot = createBot<Session>(token, { initial: () => ({ flow: undefined }), storage, telemetryEnv: opts.telemetryEnv, telemetryReporterOptions: opts.telemetryReporterOptions });
  bot.use((ctx, next) => { (ctx as Ctx).tournamentStorage = storage as StorageAdapter<unknown>; return next(); });
  for (const handler of opts.handlers ?? [start, help, registerStart, editTeam, adminDesk, tournamentTable]) bot.use(handler);
  bot.on("message", (ctx) => ctx.reply("I couldn’t use that message. Open /start and choose an option."));
  return bot;
}
