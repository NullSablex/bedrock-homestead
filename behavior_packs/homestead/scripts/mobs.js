import { CONFIG } from "./config.js";

/**
 * Telling one kind of creature from another, and what a claim wants of each.
 *
 * TWO questions per kind, not one, and that is the point of this file:
 *
 *   spawn   may the world create one of these inside the claim?
 *   enter   may one that was created elsewhere be in here at all?
 *
 * They are genuinely different wishes and a single switch could not say
 * either of them properly. A farm wants animals to live there and does not
 * want the world breeding more of its own into the pens. A road through
 * somebody's land is meant to have travellers on it, monsters included, but
 * nobody wants them appearing behind the house. A shop wants the wandering
 * trader to walk in and would rather villagers did not multiply in the
 * basement. One answer for both made every one of those unsayable.
 *
 * "Mobs may come inside" was one switch for every living thing on top of that,
 * which is three more questions wearing one hat: a creeper is a hole in the
 * wall waiting to happen, a cow is a cow, and a villager may be the whole
 * point of the build.
 *
 * So: three kinds, two questions each, and one rule that is not a question at
 * all — anything that BELONGS to somebody is never touched. A tamed wolf, a
 * saddled horse, an item on the floor, a painting, a map-maker's NPC. None of
 * those are visitors to the build, they are part of it, and an add-on for
 * protecting property has no business destroying or moving property.
 *
 * Classification is by TYPE FAMILY rather than by a list of type ids. The
 * families are what the game itself sorts mobs by, so a modded zombie and next
 * year's new monster answer correctly without this file being edited — and a
 * list of ids would be wrong from the first update that added one.
 */

/** The three kinds a claim decides for itself. */
export const MOB_KINDS = ["hostile", "animals", "villagers"];

/** The two things it decides about each of them. */
export const MOB_RULES = ["spawn", "enter"];

function hasFamily(entity, family) {
  try {
    return entity.matches({ families: [family] });
  } catch {
    // Older runtimes, or an entity that died between the query and here.
    return false;
  }
}

/**
 * Is this somebody's, rather than something's?
 *
 * Tamed covers the wolf, the cat, the parrot and the tamed horse; the saddle
 * and the chest cover the rest of what people ride and load. Either way the
 * answer is the same: a player put work into this one, so it stays.
 */
function belongsToSomeone(entity) {
  try {
    if (entity.getComponent("minecraft:is_tamed")) return true;
    if (entity.getComponent("minecraft:is_saddled")) return true;
    if (entity.getComponent("minecraft:is_chested")) return true;
  } catch { /* no such component in this version: fall through */ }
  return false;
}

/**
 * Which of the three this creature is, or undefined for "leave it alone".
 *
 * Undefined is not a failure to classify. It is the answer for everything the
 * claim exists to keep — belongings, fixtures, and the player themselves — and
 * it is deliberately the same answer as "this add-on has no opinion", because
 * the safe thing to do with an entity nobody recognises is nothing.
 */
export function kindOf(entity) {
  const typeId = entity?.typeId;
  if (!typeId) return undefined;
  if (CONFIG.presence.mobsAllowed.includes(typeId)) return undefined;
  if (typeId === "minecraft:player") return undefined;
  if (belongsToSomeone(entity)) return undefined;

  if (hasFamily(entity, "monster")) return "hostile";

  /*
   * Villagers, wandering traders and the golems that guard them. Golems are
   * here rather than under animals because they arrive with a village and
   * leave with it: whoever wants the traders wants the guard, and whoever
   * wants neither would have to switch two things off to be rid of one.
   */
  if (
    hasFamily(entity, "villager") ||
    hasFamily(entity, "merchant") ||
    hasFamily(entity, "irongolem") ||
    hasFamily(entity, "npc")
  ) {
    return "villagers";
  }

  if (hasFamily(entity, "animal") || hasFamily(entity, "mob")) return "animals";

  return undefined;
}

/** Both answers for one kind, from whatever shape the record is in. */
function pairFrom(stored, fallback) {
  if (stored === true) return { spawn: true, enter: true };
  if (stored === false) return { spawn: false, enter: false };
  if (!stored || typeof stored !== "object") return { ...fallback };
  return {
    spawn: stored.spawn !== false,
    enter: stored.enter !== false,
  };
}

/**
 * What this claim allows, read from a record of any age.
 *
 * Three shapes have existed and all three still have to mean what their owner
 * meant when they set them:
 *
 *   mobs: true / false          one switch for every creature, both questions
 *   mobs: { hostile: false }    one switch per kind, both questions
 *   mobs: { hostile: { ... } }  what this version writes
 *
 * The middle one is read as the same answer to both questions, because that is
 * what it was: an owner who said "no monsters" was saying no to monsters
 * appearing AND to monsters arriving, since the add-on gave them no way to
 * separate the two. Reading it any other way would quietly open a claim that
 * its owner had closed.
 */
export function mobRules(claim) {
  const stored = claim?.mobs;

  if (stored === true || stored === undefined) {
    return everyKind({ spawn: true, enter: true });
  }
  if (stored === false) return everyKind({ spawn: false, enter: false });

  const rules = {};
  for (const kind of MOB_KINDS) {
    rules[kind] = pairFrom(stored[kind], { spawn: true, enter: true });
  }
  return rules;
}

function everyKind(pair) {
  const rules = {};
  for (const kind of MOB_KINDS) rules[kind] = { ...pair };
  return rules;
}

/** What a newly claimed piece of land starts with. */
export function defaultMobRules() {
  const rules = {};
  for (const kind of MOB_KINDS) {
    rules[kind] = { ...CONFIG.presence.mobDefaults[kind] };
  }
  return rules;
}

/**
 * Is there anything at all for the watch to look for here?
 *
 * Asked before querying the entities around a player, because that query is
 * the expensive half and a claim that lets everything in has no work in it.
 */
export function refusesAnyone(claim) {
  const rules = mobRules(claim);
  return MOB_KINDS.some((kind) => !rules[kind].enter);
}

/**
 * May this creature spawn here — or, with "enter", be here at all?
 *
 * Anything unclassified is allowed, which is the same statement as `kindOf`
 * returning undefined, made from the other side: this add-on refuses what an
 * owner asked it to refuse, and nothing else.
 */
export function mobAllowed(claim, entity, rule) {
  const kind = kindOf(entity);
  if (!kind) return true;
  return mobRules(claim)[kind][rule];
}
