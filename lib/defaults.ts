import automations from "@/data/automations.default.json";
import chatbot from "@/data/chatbot.default.json";
import userRecord from "@/data/user.default.json";

import type { Recipe } from "./automations/recipe";
import type { BotConfig, UserRecord } from "./types";

/**
 * The three shipped files, and the only data this app starts from.
 *
 * They are imported rather than read off disk, so they are bundled with the
 * page and there is no server in the picture. `npm run dev` still picks up a
 * hand edit to one: Vite reloads the module.
 *
 * Nothing is ever written. The bot you are editing lives in your browser tab,
 * in memory. Nothing is kept in the browser either, so a reload starts here
 * again — and these are also what the Reset buttons put back.
 *
 * The automations file is folded into the config, because that is where a
 * recipe lives once it is loaded: `config.automations` is read straight off
 * the config wherever a node names one.
 */
export function defaultConfig(): BotConfig {
  return { ...(chatbot as BotConfig), automations: automations as Recipe[] };
}

export function defaultUser(): UserRecord {
  return userRecord as UserRecord;
}
