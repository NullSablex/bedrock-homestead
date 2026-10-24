import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { subscribeSafe } from "./safe.js";
import { allClaims, claimAt, mayDo } from "./claims.js";
import { mobAllowed, refusesAnyone } from "./mobs.js";
import { contains } from "./shape.js";
import { t } from "./msg.js";

/**
 * Who and what may be inside a claim at all.
 *
 * Everything else in this add-on answers an event: someone swung at a block,
 * someone opened a chest, and the answer is yes or no before it happens.
 * Walking has no such event — for a player or for a creeper. Nothing in the
 * API fires when something crosses a line, so there is no version of this rule
 * that waits to be told.
 *
 * So this watches instead, and that is a worse tool. A watcher is late by
 * definition: it sees the intruder standing inside and puts them back. What it
 * can do is be quick enough that being late does not matter — four times a
 * second, which is inside the distance anything covers in a stride.
 *
 * Players and creatures are the same problem and get the same answer, in the
 * same pass. Waiting for a monster to actually swing at something was tried
 * and is worse than it sounds: by the time a hit is reported the thing is
 * already at the door, and the whole point of a boundary is to be a boundary
 * rather than an alarm.
 *
 * The pass costs nothing where nothing is asked of it. It runs over the
 * players online rather than over the claims in the world, and it looks for
 * creatures only when the player is standing in a claim that refuses some.
 */

/** playerId -> the last position they were entitled to occupy. */
const lastAllowed = new Map();

/** playerId -> the last position outside every claim. Never overwritten inside. */
const lastOutside = new Map();

/** playerId -> tick of the last refusal, so the chat is not a machine gun. */
const lastTold = new Map();

function tell(player, key) {
  const now = system.currentTick;
  if (now - (lastTold.get(player.id) ?? -Infinity) < CONFIG.presence.messageEvery) return;
  lastTold.set(player.id, now);
  player.sendMessage(t(key));
}

/**
 * Whether a stored position is still legal now.
 *
 * Access can change while somebody is standing still. A position that was
 * legal five ticks ago is therefore evidence that the player fits there, but
 * not evidence that they may still be there.
 */
function allowedAt(player, location) {
  const claim = claimAt(player.dimension.id, location);
  return !claim || mayDo(claim, player, "enter");
}

function returnTo(player, home) {
  if (!home || home.dimension !== player.dimension.id || !allowedAt(player, home)) return false;

  try {
    return player.tryTeleport(home, {
      dimension: player.dimension,
      checkForBlocks: true,
    });
  } catch {
    return false;
  }
}

function returnToStoredPlace(player) {
  return returnTo(player, lastAllowed.get(player.id)) ||
    returnTo(player, lastOutside.get(player.id));
}

/** Bounding boxes close enough that one claim can block another's exit. */
function touches(a, b) {
  return !(
    a.x2 + 1 < b.x1 || a.x1 - 1 > b.x2 ||
    a.z2 + 1 < b.z1 || a.z1 - 1 > b.z2
  );
}

/**
 * The connected group of claims the player is currently refused from.
 *
 * A player's own claims may sit flush. Looking only one block beyond the
 * current claim can therefore land them in the next refused claim. Treating
 * touching denied claims as one island gives the island an outside edge.
 */
function deniedIsland(player, start) {
  const denied = allClaims().filter(
    (claim) => claim.dimension === player.dimension.id && !mayDo(claim, player, "enter")
  );
  const island = [start];
  const seen = new Set([start.id]);

  for (let i = 0; i < island.length; i++) {
    for (const claim of denied) {
      if (seen.has(claim.id) || !touches(island[i], claim)) continue;
      seen.add(claim.id);
      island.push(claim);
    }
  }
  return { denied, island };
}

/** Add the perimeter at `distance`, without filling the whole rectangle. */
function addPerimeter(columns, seen, claim, distance) {
  const x1 = claim.x1 - distance;
  const x2 = claim.x2 + distance;
  const z1 = claim.z1 - distance;
  const z2 = claim.z2 + distance;
  const add = (x, z) => {
    const key = `${x},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    columns.push({ x, z });
  };

  for (let x = x1; x <= x2; x++) {
    add(x, z1);
    add(x, z2);
  }
  for (let z = z1 + 1; z < z2; z++) {
    add(x1, z);
    add(x2, z);
  }
}

/** True when this X/Z column remains inside any claim that refuses entry. */
function deniedColumn(denied, x, z) {
  return denied.some((claim) => contains(claim, x, z));
}

const UNSAFE_FLOORS = new Set([
  "minecraft:cactus",
  "minecraft:campfire",
  "minecraft:fire",
  "minecraft:lava",
  "minecraft:magma",
  "minecraft:powder_snow",
  "minecraft:soul_campfire",
  "minecraft:soul_fire",
]);

/**
 * Try one outside column from the highest reasonable footing downward.
 * `tryTeleport` performs the final collision check; the block checks prevent
 * water, lava and known damaging floors from being selected as an exit.
 */
function tryColumn(player, denied, column) {
  const centerY = Math.floor(player.location.y);
  const top = centerY + CONFIG.presence.exitRise;
  const bottom = centerY - CONFIG.presence.exitDrop;

  for (let y = top; y >= bottom; y--) {
    try {
      const floor = player.dimension.getBlock({ x: column.x, y, z: column.z });
      if (!floor || floor.isAir || UNSAFE_FLOORS.has(floor.typeId)) continue;
      // The air immediately above a water surface is a safe last resort. Lava
      // and submerged positions remain excluded below.
      if (floor.isLiquid && floor.typeId !== "minecraft:water") continue;

      const feet = player.dimension.getBlock({ x: column.x, y: y + 1, z: column.z });
      const head = player.dimension.getBlock({ x: column.x, y: y + 2, z: column.z });
      if (!feet || !head || feet.isLiquid || head.isLiquid) continue;

      const destination = { x: column.x + 0.5, y: y + 1, z: column.z + 0.5 };
      if (deniedColumn(denied, column.x, column.z)) continue;
      if (!player.tryTeleport(destination, {
        dimension: player.dimension,
        checkForBlocks: true,
      })) continue;

      lastAllowed.set(player.id, { ...destination, dimension: player.dimension.id });
      return true;
    } catch {
      // Unloaded column, outside the dimension, or a block changed mid-check.
    }
  }
  return false;
}

/** Find the nearest usable footing outside the whole denied claim island. */
function moveOutside(player, claim) {
  const { denied, island } = deniedIsland(player, claim);
  const columns = [];
  const seen = new Set();

  for (let distance = 1; distance <= CONFIG.presence.exitSearch; distance++) {
    for (const part of island) addPerimeter(columns, seen, part, distance);
  }

  const { x, z } = player.location;
  columns.sort((a, b) =>
    ((a.x + 0.5 - x) ** 2 + (a.z + 0.5 - z) ** 2) -
    ((b.x + 0.5 - x) ** 2 + (b.z + 0.5 - z) ** 2)
  );

  for (const column of columns) {
    if (tryColumn(player, denied, column)) return true;
  }
  return false;
}

/** Return where they came from, or evacuate them if that place was revoked. */
function sendBack(player, claim) {
  return returnToStoredPlace(player) || moveOutside(player, claim);
}

function watchPresence() {
  for (const player of world.getPlayers()) {
    let here;
    try {
      here = claimAt(player.dimension.id, player.location);
    } catch {
      continue;
    }

    if (!here || mayDo(here, player, "enter")) {
      // Remembered only while they are somewhere they are allowed to be, so it
      // can never be a position inside the claim they were just refused.
      const position = {
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
        dimension: player.dimension.id,
      };
      lastAllowed.set(player.id, position);
      if (!here) lastOutside.set(player.id, position);
    } else if (sendBack(player, here)) {
      tell(player, "homestead.deny.enter");
    }

    if (here) sweepCreatures(player, here);
  }
}

/**
 * The creatures around one player, in the claim they are standing in.
 *
 * Around the PLAYER and not over the claim, because that is where the cost is
 * worth paying: a monster nobody is present for is bothering nobody, and a
 * claim with nobody in it barely simulates. A world of a hundred claims with
 * one player awake costs one query, and none at all while that player is on
 * land that welcomes everything.
 */
function sweepCreatures(player, claim) {
  const cfg = CONFIG.presence;
  if (!cfg.pushOutCreatures) return;

  // Nothing refused here means nothing to look for, and looking is the
  // expensive half of this.
  if (!refusesAnyone(claim)) return;

  let entities;
  try {
    entities = player.dimension.getEntities({
      location: player.location,
      maxDistance: cfg.creatureRadius,
      excludeTypes: ["minecraft:player", ...cfg.mobsAllowed],
    });
  } catch {
    return;
  }

  for (const entity of entities) pushOut(claim, entity);
}

/**
 * Puts one creature outside the claim, through the nearest side.
 *
 * The nearest side because it is the shortest way to somewhere it is allowed
 * to stand: throwing it across the plot would drop it on the far boundary,
 * which is the same problem one claim-width away.
 */
function pushOut(claim, entity) {
  // "enter" and not "spawn": this one is already alive and came from
  // somewhere else, which is exactly the case the two rules separate.
  if (mobAllowed(claim, entity, "enter")) return false;

  const x = Math.floor(entity.location.x);
  const z = Math.floor(entity.location.z);
  if (!contains(claim, x, z)) return false;

  const west = x - claim.x1;
  const east = claim.x2 - x;
  const north = z - claim.z1;
  const south = claim.z2 - z;
  const nearest = Math.min(west, east, north, south);

  const to = { x: entity.location.x, y: entity.location.y, z: entity.location.z };
  if (nearest === west) to.x = claim.x1 - 1.5;
  else if (nearest === east) to.x = claim.x2 + 1.5;
  else if (nearest === north) to.z = claim.z1 - 1.5;
  else to.z = claim.z2 + 1.5;

  try {
    entity.teleport(to, { dimension: entity.dimension });
    return true;
  } catch {
    // Despawned, or the chunk went away underneath it.
    return false;
  }
}

/**
 * A creature refused at the moment the world creates it.
 *
 * This is the whole of the mob rule, and it is a rule about SPAWNING rather
 * than about being inside. That distinction is the design, not a shortcut:
 * Bedrock has no way to suppress spawning in a region — there is no cancelable
 * spawn event, spawn rules filter by biome and light for a whole entity type,
 * and `doMobSpawning` is the entire world — so the only honest thing an
 * add-on can offer for one rectangle of land is to undo the spawn where it
 * happens, one tick old, before the creature has been anywhere or done
 * anything.
 *
 * There used to be a patrol as well, sweeping every claim twice a second and
 * pushing out whatever it found. It was there because this handler was not,
 * and it never worked: a dark corner refills faster than a sweep can empty it,
 * so what an owner saw was a crowd pressed against their fence. With the spawn
 * refused at the source there is nothing for a patrol to find, and a sweep of
 * every claim forever is not a cost worth paying for the rare mob that walked
 * in from outside — that one is a visitor, and the block protections already
 * refuse it everything it might break.
 *
 * Only what the WORLD made. Anything bred, hatched, released from an egg, or
 * already alive when the chunk loaded was put there by somebody, and this is
 * the one place the add-on destroys anything at all — so it is kept to the
 * case where there is provably nothing to destroy.
 */
function refuseSpawn(entity) {
  let claim;
  try {
    claim = claimAt(entity.dimension.id, entity.location);
  } catch {
    return;
  }
  if (!claim || mobAllowed(claim, entity, "spawn")) return;

  try {
    entity.remove();
  } catch { /* already gone, or the chunk unloaded under it */ }
}

export function registerPresence() {
  /*
   * One watch for both, because they are one question: who is inside that
   * should not be. The claim rules decide the rest.
   */
  if (CONFIG.presence.enforceEntry) {
    system.runInterval(watchPresence, CONFIG.presence.everyTicks);
  }

  /*
   * An event, not a timer. Every other rule in this add-on answers something
   * that happened; this one does too, which is why it costs nothing on a world
   * where nothing is spawning.
   */
  if (CONFIG.presence.refuseSpawns) {
    subscribeSafe(world.afterEvents, "entitySpawn", (ev) => {
      /*
       * Spawned is the world filling a dark corner; Transformed is a zombie
       * drowning into a drowned, which is the same creature arriving twice.
       * Born, Loaded and Event are somebody's doing, or somebody's mob that
       * was already there, and none of those are this rule's business.
       */
      if (ev.cause !== "Spawned" && ev.cause !== "Transformed") return;
      system.run(() => refuseSpawn(ev.entity));
    });
  }

  subscribeSafe(world.afterEvents, "playerLeave", (ev) => {
    lastAllowed.delete(ev.playerId);
    lastOutside.delete(ev.playerId);
    lastTold.delete(ev.playerId);
  });
}
