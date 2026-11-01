import { world } from "@minecraft/server";
import { claimAt, isPublicClaim } from "./claims.js";
import { subscribeSafe } from "./safe.js";

export function combatRules(claim) {
  return {
    // Public safe zones default to no PvP, including records from older worlds.
    allowPvp: claim?.combat?.allowPvp === true,
  };
}

function playerBehind(source) {
  try {
    if (source.damagingEntity?.typeId === "minecraft:player") return source.damagingEntity;
    const projectile = source.damagingProjectile ?? source.damagingEntity;
    const owner = projectile?.getComponent("minecraft:projectile")?.owner;
    return owner?.typeId === "minecraft:player" ? owner : undefined;
  } catch {
    return undefined;
  }
}

export function isBlockedPublicPvp(claim, hurtEntity, damageSource) {
  return Boolean(
    isPublicClaim(claim) &&
    !combatRules(claim).allowPvp &&
    hurtEntity?.typeId === "minecraft:player" &&
    playerBehind(damageSource)
  );
}

export function registerCombat() {
  subscribeSafe(world.beforeEvents, "entityHurt", (event) => {
    let claim;
    try {
      claim = claimAt(event.hurtEntity.dimension.id, event.hurtEntity.location);
    } catch {
      return;
    }
    if (isBlockedPublicPvp(claim, event.hurtEntity, event.damageSource)) event.cancel = true;
  });
}
