import { ItemStack, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { subscribeSafe } from "./safe.js";
import { isInteractive } from "./blocks.js";
import { isDeed } from "./items.js";
import { claimsOf, forgetVisitor, cleanClaimName } from "./claims.js";
import { showMenu } from "./menu.js";
import { t } from "./msg.js";

/**
 * The deed: the book every player carries, and the only way into this add-on.
 *
 * Nothing here is reachable by command. `/scriptevent` requires cheats, which
 * are off by default and disable achievements when switched on — an add-on
 * that can only be opened that way is one most players never open at all.
 * Handing an item over from a script has no such condition, so the deed is
 * given on spawn and the menu lives on the item.
 *
 * The claim data never lives on the item; the lore is rewritten from the
 * registry. That keeps a deed that changed hands showing its new holder's
 * claims instead of leaking the previous owner's.
 */

let resolvedItemId;
const ISSUED_PROPERTY = "homestead:deed_issued";

function wasIssued(player) {
  try { return player.getDynamicProperty(ISSUED_PROPERTY) === true; } catch { return false; }
}

function rememberIssued(player) {
  try { player.setDynamicProperty(ISSUED_PROPERTY, true); } catch { /* player unavailable */ }
}

/**
 * A missing item id throws at construction rather than returning nothing, so
 * the fallbacks are tried once and the answer kept.
 */
function deedItemId() {
  if (resolvedItemId) return resolvedItemId;
  for (const id of CONFIG.deed.itemIds) {
    try {
      new ItemStack(id, 1);
      resolvedItemId = id;
      return id;
    } catch { /* missing in this version, try the next */ }
  }
  resolvedItemId = CONFIG.deed.itemIds[CONFIG.deed.itemIds.length - 1];
  return resolvedItemId;
}

/**
 * Item lore takes plain strings, never RawMessage, so this text cannot follow
 * each player's language. It uses the one set in config.js; the coordinates
 * themselves are numbers and read the same everywhere.
 */
function loreFor(player) {
  const mine = claimsOf(player.id);
  if (mine.length === 0) {
    return [CONFIG.deed.loreBlank, CONFIG.deed.loreHint, CONFIG.deed.loreFooter];
  }

  const lines = [CONFIG.deed.loreHeader, "§8-------------------"];
  for (const claim of mine) {
    const dimension = claim.dimension.replace("minecraft:", "");
    const name = cleanClaimName(claim.name) || `Area ${claim.x1}, ${claim.z1}`;
    lines.push(`§f${name} §8| ${dimension}`, `§8${claim.x1}, ${claim.z1}`);
  }
  lines.push("§8-------------------", CONFIG.deed.loreHint, CONFIG.deed.loreFooter);
  return lines;
}

function deedSlots(player) {
  const indices = [];
  try {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) return { inventory: undefined, indices };
    for (let i = 0; i < inventory.size; i++) {
      if (isDeed(inventory.getItem(i))) indices.push(i);
    }
    return { inventory, indices };
  } catch {
    return { inventory: undefined, indices };
  }
}

/**
 * One deed per player. Extras — picked up off the ground, say — are identical
 * copies, since the contents come from the holder's registry, not the item.
 */
function dedupe(inventory, indices) {
  for (const index of indices.slice(1)) {
    try { inventory.setItem(index, undefined); } catch { /* ignore */ }
  }
}

/** Rewrites the lore for whoever holds the deed. */
export function refreshDeed(player) {
  const { inventory, indices } = deedSlots(player);
  if (!inventory || indices.length === 0) return;
  rememberIssued(player);
  if (indices.length > 1) dedupe(inventory, indices);

  try {
    const stack = inventory.getItem(indices[0]);
    const wanted = loreFor(player);
    // The deed never becomes a death drop. This also upgrades deeds created by
    // older releases the next time they are seen.
    const needsKeep = stack.keepOnDeath !== true;
    if ((stack.getLore() ?? []).join("\n") === wanted.join("\n") && !needsKeep) return;

    stack.setLore(wanted);
    stack.keepOnDeath = true;
    inventory.setItem(indices[0], stack);
  } catch { /* inventory changed underneath us */ }
}

/** Hands one over, or refreshes the one already carried. */
export function giveDeed(player, announce) {
  if (deedSlots(player).indices.length > 0) {
    refreshDeed(player);
    return;
  }
  // If the delivered deed is not carried, it may be safely stored in a
  // container. Do not manufacture a second one merely because of a respawn.
  if (wasIssued(player)) return;

  try {
    const stack = new ItemStack(deedItemId(), 1);
    stack.nameTag = CONFIG.deed.itemName;
    stack.setLore(loreFor(player));
    stack.keepOnDeath = true;

    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) return;
    const leftover = inventory.addItem(stack);
    // A full inventory would swallow the only way in, so the rest drops at the
    // player's feet rather than disappearing.
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    rememberIssued(player);

    if (announce) player.sendMessage(t("homestead.deed.received"));
  } catch (e) {
    console.warn(`[Homestead] could not hand over the deed: ${e}`);
  }
}

export function registerDeed() {
  if (CONFIG.deed.giveOnSpawn) {
    // Both the first join and every respawn: giveDeed refreshes the retained
    // item and is a no-op when the one issued earlier was deliberately stored.
    subscribeSafe(world.afterEvents, "playerSpawn", (ev) => {
      system.runTimeout(() => giveDeed(ev.player, ev.initialSpawn), CONFIG.deed.giveDelay);
    });
  }

  // Picking up an old death drop cannot create a second carried deed.
  subscribeSafe(world.afterEvents, "playerInventoryItemChange", (ev) => {
    if (!isDeed(ev.itemStack)) return;
    system.run(() => refreshDeed(ev.player));
  });

  /*
   * The deed opens the menu, and does nothing else.
   *
   * It used to mark corners too, when the click landed on a block. That made
   * every stray tap into a corner: reaching for the menu near a wall was
   * enough to start a selection nobody asked for. Marking moved to a wand
   * handed out from the menu, and the book went back to being one thing.
   */
  const lastUse = new Map();

  function openOnce(player) {
    // Right-click repeats while the button is held, and a form reopening
    // several times a second cannot be dismissed.
    const now = system.currentTick;
    if (now - (lastUse.get(player.id) ?? -Infinity) < CONFIG.deed.openCooldown) return;
    lastUse.set(player.id, now);
    refreshDeed(player);
    showMenu(player);
  }

  subscribeSafe(world.afterEvents, "itemUse", (ev) => {
    if (!isDeed(ev.itemStack)) return;
    const player = ev.source;
    system.run(() => openOnce(player));
  });

  subscribeSafe(world.afterEvents, "playerInteractWithBlock", (ev) => {
    if (!isDeed(ev.itemStack)) return;
    // The block gets first refusal: opening a chest should open the chest.
    if (isInteractive(ev.block)) return;
    const player = ev.player;
    system.run(() => openOnce(player));
  });

  subscribeSafe(world.afterEvents, "playerLeave", (ev) => {
    lastUse.delete(ev.playerId);
    forgetVisitor(ev.playerId);
  });
}
