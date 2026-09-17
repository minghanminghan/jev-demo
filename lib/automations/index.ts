import { CODED } from "./coded";
import { compileRecipe, type Recipe } from "./recipe";
import type { Automation } from "./types";

/**
 * The registry, in two halves.
 *
 * Most automations are JSON recipes, shipped in `data/automations.default.json`
 * and carried in `config.automations`, so the engine is handed them with the
 * bot. The rest are in `coded.ts`, because they need a calculation a schema
 * cannot express.
 *
 * A node stores only the id. Code always wins a name clash, so a recipe cannot
 * quietly take the name of a coded one and change what it does.
 */
export const AUTOMATIONS: Automation[] = [...CODED];

const BY_ID = new Map(AUTOMATIONS.map((automation) => [automation.id, automation]));

export function findAutomation(id: string, recipes: Recipe[] = []): Automation | undefined {
  const coded = BY_ID.get(id);
  if (coded) return coded;
  const recipe = recipes.find((one) => one.id === id);
  return recipe ? compileRecipe(recipe) : undefined;
}

/** Ids, for validation. */
export function automationIds(recipes: Recipe[] = []): string[] {
  return [...BY_ID.keys(), ...recipes.map((one) => one.id)];
}

export * from "./recipe";
export * from "./types";
