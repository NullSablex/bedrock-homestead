import { CONFIG } from "./config.js";

/**
 * Telling this add-on's two items apart from ordinary ones.
 *
 * It lives on its own because everything needs the answer and nothing should
 * have to import the deed or the wand to get it — the outline asks what the
 * player is holding, and the deed and the wand both already depend on the
 * menu, so asking either of them directly would close a circle the Bedrock
 * script engine is a bad place to discover.
 *
 * Identification is by NAME, not by item type. Without a resource pack there
 * is no item with a texture of its own, so a book stays a book and a stick
 * stays a stick; the custom name is what makes one of them ours, and `nameTag`
 * takes a plain string, which is exactly why the name is the same in every
 * language.
 */

function named(stack, cfg) {
  if (!stack || !cfg.itemIds.includes(stack.typeId)) return false;
  return stack.nameTag === cfg.itemName;
}

export function isDeed(stack) {
  return named(stack, CONFIG.deed);
}

export function isWand(stack) {
  return named(stack, CONFIG.wand);
}

/** What the player has in hand, or undefined. */
export function heldItem(player) {
  try {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    return inventory?.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

/** Is the player holding either of ours? */
export function holdingTool(player) {
  const stack = heldItem(player);
  return isDeed(stack) || isWand(stack);
}
