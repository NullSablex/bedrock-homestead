import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { allClaims, mayBuild } from "./claims.js";
import { contains, isPolygon } from "./shape.js";
import { subscribeSafe } from "./safe.js";

/** Active projectile id -> entity and its last observed position. */
const active = new Map();

function edgesOf(shape) {
  if (isPolygon(shape)) {
    return shape.points.map((point, index) => ({
      a: { x: point.x + 0.5, z: point.z + 0.5 },
      b: {
        x: shape.points[(index + 1) % shape.points.length].x + 0.5,
        z: shape.points[(index + 1) % shape.points.length].z + 0.5,
      },
    }));
  }

  const x1 = shape.x1;
  const x2 = shape.x2 + 1;
  const z1 = shape.z1;
  const z2 = shape.z2 + 1;
  return [
    { a: { x: x1, z: z1 }, b: { x: x2, z: z1 } },
    { a: { x: x2, z: z1 }, b: { x: x2, z: z2 } },
    { a: { x: x2, z: z2 }, b: { x: x1, z: z2 } },
    { a: { x: x1, z: z2 }, b: { x: x1, z: z1 } },
  ];
}

function cross(a, b) {
  return a.x * b.z - a.z * b.x;
}

/** First wall crossed by the X/Z segment: its unit normal and how far along. */
function crossedWall(shape, from, at) {
  const travel = { x: at.x - from.x, z: at.z - from.z };
  let first;

  for (const edge of edgesOf(shape)) {
    const wall = { x: edge.b.x - edge.a.x, z: edge.b.z - edge.a.z };
    const denominator = cross(travel, wall);
    if (Math.abs(denominator) < 1e-9) continue;
    const offset = { x: edge.a.x - from.x, z: edge.a.z - from.z };
    const alongTravel = cross(offset, wall) / denominator;
    const alongWall = cross(offset, travel) / denominator;
    if (alongTravel <= 1e-6 || alongTravel > 1 || alongWall < 0 || alongWall > 1) continue;
    if (first && first.alongTravel <= alongTravel) continue;

    const length = Math.hypot(wall.x, wall.z);
    first = {
      alongTravel,
      normal: { x: -wall.z / length, z: wall.x / length },
    };
  }
  return first;
}

function mirrored(velocity, normal) {
  const dot = velocity.x * normal.x + velocity.z * normal.z;
  return {
    x: velocity.x - 2 * dot * normal.x,
    y: velocity.y,
    z: velocity.z - 2 * dot * normal.z,
  };
}

/** Where along from->at the segment enters the shape, or nothing. */
function entry(shape, from, at, velocity) {
  if (contains(shape, Math.floor(from.x), Math.floor(from.z))) return undefined;

  const wall = crossedWall(shape, from, at);
  if (wall) return { alongTravel: wall.alongTravel, velocity: mirrored(velocity, wall.normal) };
  if (!contains(shape, Math.floor(at.x), Math.floor(at.z))) return undefined;
  // A thick polygon wall may count as entered before its mathematical centre
  // line is crossed. Reversing the horizontal travel is the safe equivalent.
  return { alongTravel: 1, velocity: { x: -velocity.x, y: velocity.y, z: -velocity.z } };
}

/**
 * Reflect a segment that crosses from outside into a protected shape, even
 * one that passes through it completely. Returns nothing for a projectile
 * born inside or that never touches it.
 */
export function reflectIncoming(shape, from, at, velocity) {
  const hit = entry(shape, from, at, velocity);
  return hit ? { position: { ...from }, velocity: hit.velocity } : undefined;
}

/**
 * Ricochet is on unless the area explicitly turned it off, so records from
 * worlds older than the switch keep the protection they always had.
 */
export function reflectsProjectiles(claim) {
  return claim?.projectiles?.reflect !== false;
}

function inHeight(claim, y) {
  return claim.heightMode === "full" || (y >= claim.y1 && y <= claim.y2);
}

function overlapsBox(claim, from, at) {
  return Math.max(from.x, at.x) >= claim.x1 && Math.min(from.x, at.x) < claim.x2 + 1 &&
    Math.max(from.z, at.z) >= claim.z1 && Math.min(from.z, at.z) < claim.z2 + 1;
}

/**
 * The first reflecting claim the segment enters, among all of them: the end
 * point alone misses a fast projectile that crosses a narrow claim inside one
 * tick, and misses the claim it is about to enter.
 *
 * `exempt(claim)` lets the people who may build there shoot into their own
 * land without the arrow coming back at them.
 */
export function firstEntry(claims, dimensionId, from, at, velocity, exempt = () => false) {
  let first;
  for (const claim of claims) {
    if (claim.dimension !== dimensionId || !reflectsProjectiles(claim)) continue;
    if (!overlapsBox(claim, from, at)) continue;
    const hit = entry(claim, from, at, velocity);
    if (!hit || (first && first.alongTravel <= hit.alongTravel)) continue;
    if (!inHeight(claim, from.y + (at.y - from.y) * hit.alongTravel)) continue;
    if (exempt(claim)) continue;
    first = { ...hit, claim };
  }
  return first;
}

function shooterOf(entity) {
  try {
    const owner = entity.getComponent("minecraft:projectile")?.owner;
    return owner?.typeId === "minecraft:player" ? owner : undefined;
  } catch {
    return undefined;
  }
}

function track(entity) {
  try {
    if (!entity.getComponent("minecraft:projectile")) return;
    active.set(entity.id, {
      entity,
      dimension: entity.dimension.id,
      previous: { ...entity.location },
    });
  } catch { /* entity disappeared before it could be tracked */ }
}

/** Below this a projectile is resting: stuck in a block or on the ground. */
const RESTING = 1e-4;

export function patrolProjectiles() {
  if (!active.size) return;
  const claims = allClaims();
  for (const [id, state] of active) {
    try {
      const { entity } = state;
      if (!entity.isValid) {
        active.delete(id);
        continue;
      }
      const dimension = entity.dimension.id;
      const current = { ...entity.location };
      const velocity = entity.getVelocity();
      const moving = Math.abs(velocity.x) + Math.abs(velocity.y) + Math.abs(velocity.z) > RESTING;
      const shooter = shooterOf(entity);
      const exempt = (claim) => Boolean(shooter && mayBuild(claim, shooter));

      // Look ahead: the game moves and collides the projectile before scripts
      // run, so a check of where it already is lands one tick after the hit.
      const ahead = moving
        ? firstEntry(claims, dimension, current, {
          x: current.x + velocity.x, y: current.y + velocity.y, z: current.z + velocity.z,
        }, velocity, exempt)
        : undefined;
      // Fallback for a projectile that got in anyway (spawned on the tick it
      // crossed, or the server skipped ticks): send it back the way it came.
      const behind = !ahead && moving && state.dimension === dimension
        ? firstEntry(claims, dimension, state.previous, current, velocity, exempt)
        : undefined;

      if (ahead) {
        entity.getComponent("minecraft:projectile")?.shoot(ahead.velocity);
        state.previous = current;
      } else if (behind) {
        entity.teleport(state.previous, { dimension: entity.dimension });
        entity.getComponent("minecraft:projectile")?.shoot(behind.velocity);
      } else {
        state.previous = current;
      }
      state.dimension = dimension;
    } catch {
      active.delete(id);
    }
  }
}

export function registerProjectiles() {
  subscribeSafe(world.afterEvents, "entitySpawn", (event) => track(event.entity));
  subscribeSafe(world.afterEvents, "entityLoad", (event) => track(event.entity));
  system.runInterval(patrolProjectiles, CONFIG.projectiles.everyTicks);
}
