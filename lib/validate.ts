import { automationIds, findAutomation, recipeProblems } from "./automations";
import type { Recipe } from "./automations/recipe";
import { flatten } from "./tree";
import { OTHER, type BotConfig, type BotNode } from "./types";

/**
 * The checks that used to run on save. Nothing is saved any more, so they run
 * in the browser on every edit instead, and the header shows what is wrong
 * while you are still looking at it.
 *
 * None of these stop the bot from answering. They are the mistakes that make a
 * jev call fail, or make it route somewhere you did not mean.
 */
export function problemsIn(config: BotConfig): string[] {
  const problems: string[] = [];

  if (!config.model?.trim()) problems.push("model is empty");
  if (!config.root || !Array.isArray(config.root.children)) problems.push("root is missing");

  // The same rules apply at every level, so check every level the same way.
  // The root is a node too, so its children are checked by the same loop.
  const recipes = config.automations ?? [];
  const ids = automationIds(recipes);
  for (const recipe of recipes) problems.push(...recipeProblems(recipe, ids));

  for (const { node } of flatten(config.root ? [config.root] : [])) {
    if (!node.name?.trim()) problems.push("a node has an empty name");
    if (node.children.length > 0) checkLevel(node.children, `"${node.name}"`, problems);
    checkAutomation(node, recipes, problems);
  }

  if (typeof config.maxClarifications !== "number" || config.maxClarifications < 0) {
    problems.push("maxClarifications must be 0 or more");
  }

  for (const [name, value] of Object.entries(config.thresholds ?? {})) {
    if (typeof value !== "number" || value < 0 || value > 1) {
      problems.push(`threshold "${name}" must be between 0 and 1`);
    }
  }

  return problems;
}

/**
 * A Choice needs at least two options, and duplicate names break routing.
 *
 * An empty response is allowed on purpose: a new node starts blank, and you
 * should be able to leave it that way while you think. At run time a leaf with
 * no response escalates instead of sending nothing.
 */
function checkLevel(nodes: BotNode[], where: string, problems: string[]): void {
  if (nodes.length === 1) {
    problems.push(`${where} has exactly 1 child; use 0 or 2+, a Choice needs options`);
  }
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.name)) problems.push(`${where} has duplicate child name "${node.name}"`);
    if (node.name === OTHER) problems.push(`${where} uses the reserved name "${OTHER}"`);
    seen.add(node.name);
  }
}

/**
 * An automation id that is not in the registry escalates every time the leaf
 * is reached, silently. A branch with an automation is the same kind of
 * mistake: a node with children routes, it never acts.
 */
function checkAutomation(node: BotNode, recipes: Recipe[], problems: string[]): void {
  const id = node.automation;
  if (!id) return;
  if (!findAutomation(id, recipes)) {
    problems.push(
      `"${node.name}" wants unknown automation "${id}"; known ids: ${automationIds(recipes).join(", ")}`,
    );
  }
  if (node.children.length > 0) {
    problems.push(`"${node.name}" has children, so it cannot run automation "${id}"`);
  }
}
