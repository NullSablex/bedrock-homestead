import { CONFIG } from "./config.js";

/**
 * Does this block answer a right-click on its own?
 *
 * Asked as a property wherever the game will answer it, and only then as a
 * list. A block that opens carries a state saying so, and a container carries
 * an inventory component; a workstation carries neither and looks exactly like
 * a solid cube to both tests, which is what the short list at the end is for.
 */
export function isInteractive(block) {
  if (!block) return false;

  try {
    if (block.getComponent("minecraft:inventory")) return true;
  } catch { /* no such component in this version */ }

  try {
    const states = block.permutation.getAllStates();
    for (const state of CONFIG.deed.interactiveStates) {
      if (state in states) return true;
    }
  } catch { /* permutation unavailable */ }

  return CONFIG.deed.interactiveBlocks.includes(block.typeId);
}

/**
 * What kind of thing this block is, for the message that refuses it.
 *
 * One sentence for every refusal reads as a rule the add-on applies without
 * looking — "you cannot use that here" says nothing about a chest that a
 * player did not already know about a door. Naming what was touched is the
 * difference between a rule and a wall.
 *
 * Asked as a property where the game answers it, and by name where it does
 * not. Order matters: a trapdoor carries "door" in its id, and a chest that is
 * also a container should be called a container.
 */
export function interactionKind(block) {
  try {
    if (block.getComponent("minecraft:inventory")) return "container";
  } catch { /* no such component in this version */ }

  const id = block.typeId;

  if (id.includes("bed") && !id.includes("bedrock")) return "bed";
  if (id.includes("door") || id.includes("fence_gate")) return "door";
  if (id.includes("button") || id.includes("lever") || id.includes("pressure_plate")) {
    return "mechanism";
  }
  return "use";
}

/**
 * Items that alter the world without necessarily firing playerPlaceBlock.
 * Returning an action lets the normal claim permission decide the result.
 */
export function itemMutationAction(item) {
  const id = item?.typeId ?? "";
  if (!id) return undefined;

  if (
    id === "minecraft:bucket" || id === "minecraft:shears" ||
    id === "minecraft:brush" || id === "minecraft:honeycomb" ||
    id.endsWith("_axe") || id.endsWith("_hoe") || id.endsWith("_shovel")
  ) return "break";
  if (
    (id.endsWith("_bucket") && id !== "minecraft:milk_bucket") ||
    id.endsWith("_spawn_egg") ||
    id.endsWith("_boat") || id.endsWith("_raft") || id.endsWith("_minecart") ||
    id === "minecraft:minecart" || id === "minecraft:armor_stand" ||
    id === "minecraft:item_frame" || id === "minecraft:glow_item_frame" ||
    id === "minecraft:painting" || id === "minecraft:flint_and_steel" ||
    id === "minecraft:fire_charge" || id === "minecraft:end_crystal"
  ) return "place";

  if (
    id === "minecraft:bone_meal" || id === "minecraft:glass_bottle" ||
    id === "minecraft:ink_sac" || id === "minecraft:glow_ink_sac" ||
    id === "minecraft:ender_eye"
  ) return "use";
  return undefined;
}

/** The block on the clicked face, where a use-on action may land. */
export function adjacentLocation(location, face) {
  const offsets = {
    Up: [0, 1, 0], Down: [0, -1, 0],
    North: [0, 0, -1], South: [0, 0, 1],
    East: [1, 0, 0], West: [-1, 0, 0],
  };
  const [x, y, z] = offsets[String(face)] ?? [0, 0, 0];
  return { x: location.x + x, y: location.y + y, z: location.z + z };
}
