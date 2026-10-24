import { ItemStack, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { subscribeSafe } from "./safe.js";
import { isInteractive } from "./blocks.js";
import { isWand } from "./items.js";
import {
  markCorner, selectedShape, clearSelection,
} from "./selection.js";
import { t } from "./msg.js";

/**
 * The marking wand: a stick handed out for as long as an area is being marked,
 * and taken back when it is not.
 *
 * The deed used to do this job as well, and it made every stray click on a
 * block into a corner. Someone reaching for the menu, or tapping a wall on the
 * way past, kept finding themselves halfway through a selection they never
 * asked to start. An item that only exists while you are marking cannot do
 * that: the gesture is unambiguous because the tool is.
 *
 * It is temporary on purpose. A permanent wand is a second thing to carry, to
 * lose, and to explain; this one arrives when asked for and leaves when the
 * claim is made or the marking is abandoned.
 */

/**
 * The screen the wand opens, handed in by menu.js at load.
 *
 * Imported directly, this was a cycle: the menu needs the wand to give it out,
 * and the wand needs the menu to show its controls. ES modules tolerate that
 * on paper, but the Bedrock script engine is not the place to find out which
 * half initialises first — a binding that is still undefined at load fails
 * silently and takes the whole add-on with it.
 */
let markingScreen = () => {};

export function setMarkingScreen(screen) {
  markingScreen = screen;
}

let resolvedItemId;
const ISSUED_PROPERTY = "homestead:wand_issued";

function wasIssued(player) {
  try { return player.getDynamicProperty(ISSUED_PROPERTY) === true; } catch { return false; }
}

function rememberIssued(player, value = true) {
  try { player.setDynamicProperty(ISSUED_PROPERTY, value ? true : undefined); } catch { /* unavailable */ }
}

function wandItemId() {
  if (resolvedItemId) return resolvedItemId;
  for (const id of CONFIG.wand.itemIds) {
    try {
      new ItemStack(id, 1);
      resolvedItemId = id;
      return id;
    } catch { /* missing in this version, try the next */ }
  }
  resolvedItemId = CONFIG.wand.itemIds[CONFIG.wand.itemIds.length - 1];
  return resolvedItemId;
}

function wandSlots(player) {
  const indices = [];
  try {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) return { inventory: undefined, indices };
    for (let i = 0; i < inventory.size; i++) {
      if (isWand(inventory.getItem(i))) indices.push(i);
    }
    return { inventory, indices };
  } catch {
    return { inventory: undefined, indices };
  }
}

export function hasWand(player) {
  return wandSlots(player).indices.length > 0;
}

/** Upgrades the carried wand and removes any duplicate copies. */
function refreshWand(player) {
  const { inventory, indices } = wandSlots(player);
  if (!inventory || indices.length === 0) return false;
  rememberIssued(player);
  for (const index of indices.slice(1)) {
    try { inventory.setItem(index, undefined); } catch { /* inventory changed */ }
  }
  try {
    const stack = inventory.getItem(indices[0]);
    if (stack.keepOnDeath !== true) {
      stack.keepOnDeath = true;
      inventory.setItem(indices[0], stack);
    }
  } catch { /* inventory changed */ }
  return true;
}

/** Hands one over, or does nothing when the player already carries it. */
export function giveWand(player) {
  if (refreshWand(player)) return true;
  if (wasIssued(player)) {
    player.sendMessage(t("homestead.wand.stored"));
    return false;
  }

  try {
    const stack = new ItemStack(wandItemId(), 1);
    stack.nameTag = CONFIG.wand.itemName;
    stack.setLore([CONFIG.wand.loreHint, CONFIG.wand.loreFooter]);
    stack.keepOnDeath = true;

    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) return false;

    const leftover = inventory.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    rememberIssued(player);

    player.sendMessage(t("homestead.wand.received"));
    return true;
  } catch (e) {
    console.warn(`[Homestead] could not hand over the wand: ${e}`);
    return false;
  }
}

/**
 * Takes every copy back.
 *
 * Every copy and not just one: the wand can be dropped, picked up again, or
 * duplicated by a second request that raced the first, and a stick left in the
 * inventory after the claim is made is exactly the accidental marking this was
 * meant to end.
 */
export function removeWand(player) {
  const { inventory, indices } = wandSlots(player);
  if (!inventory) return;
  for (const index of indices) {
    try { inventory.setItem(index, undefined); } catch { /* ignore */ }
  }
  // Clear only when a carried wand was actually taken back. If none was
  // carried, it may be in a chest and must remain the player's only copy.
  if (indices.length > 0) rememberIssued(player, false);
}

/** Given up on marking: the wand goes, and so do the markers. */
export function putWandAway(player) {
  clearSelection(player);
  removeWand(player);
  player.sendMessage(t("homestead.wand.gone"));
}

export function registerWand() {
  const lastUse = new Map();

  subscribeSafe(world.afterEvents, "playerInventoryItemChange", (ev) => {
    if (!isWand(ev.itemStack)) return;
    system.run(() => refreshWand(ev.player));
  });

  function lookedAtBlock(player) {
    try {
      return player.getBlockFromViewDirection({
        maxDistance: CONFIG.deed.reach,
        includeLiquidBlocks: false,
        includePassableBlocks: false,
      })?.block;
    } catch {
      return undefined;
    }
  }

  function handleUse(player) {
    refreshWand(player);
    // Right-click repeats while held; one gesture per cooldown, or corners
    // land in pairs and a form reopens faster than it can be dismissed.
    const now = system.currentTick;
    if (now - (lastUse.get(player.id) ?? -Infinity) < CONFIG.deed.openCooldown) return;
    lastUse.set(player.id, now);

    const block = lookedAtBlock(player);

    // Aiming at nothing opens the marking controls: clearing one corner,
    // clearing them all, claiming what is marked, or giving the wand back.
    if (!block) return markingScreen(player);

    // The block gets first refusal: aiming at a chest should open the chest.
    if (isInteractive(block)) return;

    const {
      corners, marked, full, closed, snapped, tooClose, turned,
      becamePath, straightened, denied,
    } = markCorner(player, block.location);

    if (denied) {
      player.sendMessage(t("homestead.deny.place", denied.ownerName));
      return;
    }

    if (full) {
      player.sendMessage(t("homestead.select.full", CONFIG.selection.maxPoints));
      return;
    }

    // Back where it started: the path is shut and there is a decision to make.
    if (closed) {
      if (turned) player.sendMessage(t("homestead.select.turned"));
      player.sendMessage(t("homestead.select.closed", corners));
      markingScreen(player);
      return;
    }
    if (tooClose) {
      if (straightened) player.sendMessage(t("homestead.select.straightened"));
      player.sendMessage(t("homestead.select.tooclose"));
      return;
    }
    if (!marked) player.sendMessage(t("homestead.select.nomarker"));
    // Said where it happens: a post landing beside the block that was clicked
    // is otherwise indistinguishable from the add-on misreading the aim.
    if (snapped) player.sendMessage(t("homestead.select.snapped"));

    if (corners === 1) {
      player.sendMessage(t("homestead.select.first"));
      player.sendMessage(t("homestead.select.conflict.outline"));
      return;
    }

    /*
     * Two corners describe a rectangle completely, so there is nothing further
     * to say: the shape is finished the moment the second post lands, and the
     * confirmation comes to the player rather than waiting to be found.
     */
    if (selectedShape(player)) {
      player.sendMessage(t("homestead.select.second"));
      markingScreen(player);
      return;
    }

    /*
     * The third point is the one that changes what the marks mean, and saying
     * so is the whole of what replaced the mode switch. After it, the shape is
     * valid but not finished: it closes when the player says it does, either
     * by coming back to the first point or from the wand's own screen.
     */
    if (becamePath) {
      if (straightened) player.sendMessage(t("homestead.select.straightened"));
      player.sendMessage(t("homestead.select.became.path"));
      player.sendMessage(t("homestead.select.point", corners));
      return;
    }

    player.sendMessage(t("homestead.select.point", corners));
  }

  subscribeSafe(world.afterEvents, "itemUse", (ev) => {
    if (!isWand(ev.itemStack)) return;
    const player = ev.source;
    system.run(() => handleUse(player));
  });

  // The same gesture, for the versions where a click on a block arrives here
  // instead. The cooldown makes the overlap harmless.
  subscribeSafe(world.afterEvents, "playerInteractWithBlock", (ev) => {
    if (!isWand(ev.itemStack)) return;
    if (isInteractive(ev.block)) return;
    const player = ev.player;
    system.run(() => handleUse(player));
  });

  subscribeSafe(world.afterEvents, "playerLeave", (ev) => lastUse.delete(ev.playerId));
}
