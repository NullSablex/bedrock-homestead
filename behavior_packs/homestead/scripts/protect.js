import { ItemStack, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { subscribeSafe, coveredElsewhere } from "./safe.js";
import { claimAt, mayDo } from "./claims.js";
import {
  adjacentLocation, interactionKind, isInteractive, itemMutationAction,
} from "./blocks.js";
import { isSelectionMarker } from "./selection.js";
import { t } from "./msg.js";

const MUTATION_DENIALS = {
  break: "homestead.deny.break",
  place: "homestead.deny.place",
  use: "homestead.deny.use",
};
const INTERACTION_DENIALS = {
  container: "homestead.deny.container",
  door: "homestead.deny.door",
  mechanism: "homestead.deny.mechanism",
  bed: "homestead.deny.bed",
  use: "homestead.deny.use",
};

/**
 * Every protection hangs off a cancellable "before" event, so nothing here is
 * a warning after the damage: the action simply does not happen.
 */

/**
 * `beforeEvents` runs in a read-only context — sending a message from inside
 * one throws and the cancel never lands. system.run defers it by a tick.
 */
function deny(player, claim, key) {
  system.run(() => player.sendMessage(t(key, claim.ownerName)));
}

function denyMarker(player) {
  system.run(() => player.sendMessage(t("homestead.select.marker.protected")));
}

/** Forces a client-predicted break to agree with the cancelled server state. */
function refreshCancelledBreak(block) {
  const { dimension, location, permutation } = block;
  system.run(() => {
    try {
      dimension.getBlock(location)?.setPermutation(permutation);
    } catch { /* chunk unloaded, or the block is gone for another reason */ }
  });
}

/**
 * Placement protection without `playerPlaceBlock` on beforeEvents.
 *
 * That before-event is the ONE thing in this add-on that is still pre-release,
 * which means it exists only on a world with Beta APIs switched on. Everything
 * else — breaking, interacting, explosions, spawning, the menus — is stable
 * API, so this is the whole of the difference the flag makes, and it is why
 * the add-on does not ask for it: a protection that needs an experimental
 * toggle is a protection most players cannot have.
 *
 * The first attempt cancelled `playerInteractWithBlock` and did nothing at all:
 * cancelling an interaction cancels the INTERACTION, not the placement. They
 * are different paths in the game, and assuming that placing was a kind of
 * interacting was a guess that was never checked in game.
 *
 * What is left is the after event, which cannot be cancelled — so the block is
 * put back to air the moment it lands. The player sees it appear and vanish,
 * which is worse than never appearing, and it is the strongest guarantee the
 * stable API allows.
 *
 * The item is returned, because losing a block to someone else's boundary
 * would make the protection cost the visitor something. Block id and item id
 * are the same string for almost everything placeable; where they are not, the
 * construction throws and nothing is given back rather than something wrong.
 */
function registerPlacementUndo() {
  const undone = subscribeSafe(world.afterEvents, "playerPlaceBlock", (ev) => {
    const claim = claimAt(ev.block.dimension.id, ev.block.location);
    if (mayDo(claim, ev.player, "place")) return;

    const typeId = ev.block.typeId;
    try {
      ev.block.setType("minecraft:air");
    } catch {
      // Could not undo it. Saying nothing here would leave the player thinking
      // the protection held when it did not.
      console.warn(`[Homestead] could not undo a placement at ${ev.block.location.x}, ${ev.block.location.z}`);
      return;
    }

    giveBack(ev.player, typeId);
    deny(ev.player, claim, "homestead.deny.place");
  });

  if (undone) {
    coveredElsewhere("playerPlaceBlock", "cancelling needs Beta APIs; placements are undone instead");
    console.warn("[Homestead] playerPlaceBlock is not cancellable here; placements are undone instead");
  } else {
    console.warn("[Homestead] placement is NOT protected: no usable event in this API version");
  }
}

/** Hands a block back after its placement was undone. */
function giveBack(player, typeId) {
  try {
    // Creative loses nothing, and adding to that inventory is noise.
    if (player.getGameMode?.() === "Creative") return;
  } catch { /* no game mode in this version: give it back, it is the safe side */ }

  try {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) return;
    const leftover = inventory.addItem(new ItemStack(typeId, 1));
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  } catch { /* not an item, or the inventory is gone; nothing safe to give */ }
}

/**
 * Which permission governs which kind of block.
 *
 * A furnace and a chest both open a screen, and the API reports both the same
 * way, but they are not the same thing to the person who owns them: one is a
 * tool that works for you, the other is where your belongings live. Letting a
 * builder run the furnaces without handing them the storage is the ordinary
 * case, so the two are kept apart here.
 */
function permissionFor(kind) {
  if (kind === "container") return "containers";
  if (kind === "door" || kind === "mechanism") return "doors";
  return "use";
}

export function registerProtection() {
  subscribeSafe(world.beforeEvents, "playerBreakBlock", (ev) => {
    // Markers are UI state, not claim blocks. Their lifetime must not depend on
    // whether a server owner enabled ordinary claim-break protection.
    if (isSelectionMarker(ev.block.dimension.id, ev.block.location)) {
      ev.cancel = true;
      denyMarker(ev.player);
      refreshCancelledBreak(ev.block);
      return;
    }

    if (!CONFIG.protect.breakBlock) return;

    const claim = claimAt(ev.block.dimension.id, ev.block.location);
    if (mayDo(claim, ev.player, "break")) return;
    ev.cancel = true;
    deny(ev.player, claim, "homestead.deny.break");

    /*
     * In Creative the client destroys the block on screen before the server
     * has answered, so a cancelled break leaves a hole that is not there:
     * the server knows the block stands, the player sees empty air, and the
     * two disagree until the chunk reloads. Writing the same permutation
     * back a tick later costs nothing and forces the update that corrects
     * the client.
     */
    refreshCancelledBreak(ev.block);
  });

  if (CONFIG.protect.placeBlock) {
    const direct = subscribeSafe(world.beforeEvents, "playerPlaceBlock", (ev) => {
      const claim = claimAt(ev.block.dimension.id, ev.block.location);
      if (mayDo(claim, ev.player, "place")) return;
      ev.cancel = true;
      deny(ev.player, claim, "homestead.deny.place");
    });

    if (!direct) registerPlacementUndo();
  }

  if (CONFIG.protect.interact) {
    subscribeSafe(world.beforeEvents, "playerInteractWithBlock", (ev) => {
      /*
       * Buckets, fire starters, spawn eggs and placeable entities mutate the
       * world through use-on rather than reliably through playerPlaceBlock.
       * Check both the clicked block and its face: replaceable blocks use the
       * first, while frames, fluids and similar objects land in the second.
       */
      const mutation = itemMutationAction(ev.itemStack);
      if (mutation) {
        const locations = [
          ev.block.location,
          adjacentLocation(ev.block.location, ev.blockFace),
        ];
        const refused = locations
          .map((location) => claimAt(ev.block.dimension.id, location))
          .find((claim) => claim && !mayDo(claim, ev.player, mutation));
        if (refused) {
          ev.cancel = true;
          deny(ev.player, refused, MUTATION_DENIALS[mutation]);
          return;
        }
      }

      // A crafting table and an ender chest hold nothing of anyone's: free.
      if (CONFIG.publicBlocks.includes(ev.block.typeId)) return;

      /*
       * The game also reports the supporting-block click used to place a block
       * as an interaction. Cancelling every solid block here made `use: false`
       * silently override `place: true`. Only a block with its own action is an
       * interaction for permission purposes; placement has its own event.
       */
      if (!isInteractive(ev.block)) return;

      const claim = claimAt(ev.block.dimension.id, ev.block.location);
      const kind = interactionKind(ev.block);
      if (mayDo(claim, ev.player, permissionFor(kind))) return;

      ev.cancel = true;
      deny(ev.player, claim, INTERACTION_DENIALS[kind] ?? INTERACTION_DENIALS.use);

      /*
       * A door is the one refusal the player can act on before hearing it.
       * The client swings it open on its own authority and only learns the
       * server refused a moment later — long enough to walk through if the
       * attempt is repeated fast enough.
       *
       * Writing the state back forces the correction immediately instead of
       * waiting for the next update to carry it. It does not make the gap
       * impossible: nothing in this API can, because the client owns its own
       * prediction and its own movement.
       */
      const { dimension, location, permutation } = ev.block;
      system.run(() => {
        try {
          dimension.getBlock(location)?.setPermutation(permutation);
        } catch { /* chunk unloaded, or the block is gone */ }
      });
    });

    // Chest minecarts, item frames, villagers and other entity-backed objects
    // do not produce a block interaction event.
    subscribeSafe(world.beforeEvents, "playerInteractWithEntity", (ev) => {
      const claim = claimAt(ev.target.dimension.id, ev.target.location);
      if (!claim) return;

      let action = "use";
      try {
        if (ev.target.getComponent("minecraft:inventory")) action = "containers";
      } catch { /* component unavailable: ordinary use is the safe fallback */ }
      if ([
        "minecraft:armor_stand", "minecraft:item_frame", "minecraft:glow_item_frame",
      ].includes(ev.target.typeId)) action = "containers";
      if (mayDo(claim, ev.player, action)) return;

      ev.cancel = true;
      deny(ev.player, claim, action === "containers" ? "homestead.deny.container" : "homestead.deny.use");
    });
  }

  // Cancelling the whole explosion would punish the rest of the world, so
  // only protected claim blocks and exact active marker positions are removed
  // from the impacted list. Markers remain protected even when a server owner
  // deliberately disables explosion protection for completed claims.
  subscribeSafe(world.beforeEvents, "explosion", (ev) => {
    try {
      const blocks = ev.getImpactedBlocks();
      const safe = blocks.filter((b) => {
        if (isSelectionMarker(ev.dimension.id, b.location)) return false;
        return !CONFIG.protect.explosions || !claimAt(ev.dimension.id, b.location);
      });
      if (safe.length !== blocks.length) ev.setImpactedBlocks(safe);
    } catch (e) {
      console.warn("[Homestead] could not filter the explosion: " + e);
    }
  });
}
