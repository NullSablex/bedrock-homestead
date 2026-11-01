import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { claimAt } from "./claims.js";
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

/** First wall crossed by the X/Z segment, with a unit normal. */
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
  return first?.normal;
}

/**
 * Reflect a segment that crossed from outside into a protected shape.
 * Returns nothing for a projectile born inside or still outside.
 */
export function reflectIncoming(shape, from, at, velocity) {
  if (contains(shape, Math.floor(from.x), Math.floor(from.z))) return undefined;

  const wallNormal = crossedWall(shape, from, at);
  if (!wallNormal) {
    if (!contains(shape, Math.floor(at.x), Math.floor(at.z))) return undefined;
    // A thick polygon wall may count as entered before its mathematical centre
    // line is crossed. Reversing the horizontal travel is the safe equivalent.
    return {
      position: { ...from },
      velocity: { x: -velocity.x, y: velocity.y, z: -velocity.z },
    };
  }

  const dot = velocity.x * wallNormal.x + velocity.z * wallNormal.z;
  return {
    position: { ...from },
    velocity: {
      x: velocity.x - 2 * dot * wallNormal.x,
      y: velocity.y,
      z: velocity.z - 2 * dot * wallNormal.z,
    },
  };
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

export function patrolProjectiles() {
  for (const [id, state] of active) {
    try {
      const { entity } = state;
      const dimension = entity.dimension.id;
      const current = { ...entity.location };
      const claim = claimAt(dimension, current);
      const velocity = entity.getVelocity();
      // Incoming projectiles are a protection invariant, not a per-area
      // preference.
      const reflected = state.dimension === dimension && claim
        ? reflectIncoming(claim, state.previous, current, velocity)
        : undefined;

      if (reflected) {
        entity.teleport(reflected.position, { dimension: entity.dimension });
        entity.getComponent("minecraft:projectile")?.shoot(reflected.velocity);
        state.previous = { ...reflected.position };
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
