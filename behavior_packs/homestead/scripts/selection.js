import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { subscribeSafe } from "./safe.js";
import { allClaims, claimAt, mayDo } from "./claims.js";
import { shapeFrom, isPolygon } from "./shape.js";
import { holdingTool } from "./items.js";

/**
 * Marking out an area, and drawing what is marked.
 *
 * ONE way of marking, and the shape follows from how many points are down.
 *
 * There used to be two modes, chosen before the first click and cleared on
 * every switch, and that was the mistake: the player was asked to name the
 * shape before they had drawn it, in the vocabulary of the code rather than
 * their own. Nobody walks onto a piece of land thinking "polygon". They think
 * "this corner, and that one over there" — and sometimes, halfway through,
 * "except it has to bend around the river".
 *
 * So the count decides, and nothing else:
 *
 *   TWO points are opposite corners of a rectangle. It is the right answer for
 *   a house, a farm, a yard — anything whose outline nobody would miss — and
 *   two points describe it completely, so asking for four would add no
 *   precision and two more chances to fall out of alignment.
 *
 *   A THIRD point turns the same marks into a traced path. Each point
 *   continues the wall from the one before it, and the ground is claimed when
 *   the path comes back to where it started. It is the answer for everything a
 *   rectangle cannot say: land that follows a river, wraps a hill, or steps
 *   around a neighbour.
 *
 * Nothing is lost crossing that line, which is the whole point of removing the
 * modes: the first two posts stay where they are and keep their meaning. Only
 * the second one may shift, because a wall runs straight or exactly diagonal
 * and a rectangle's diagonal obeys no such rule — see `markCorner`.
 *
 * The walls are the boundary, and only the walls. An earlier version closed
 * the path on its own as soon as three points existed, which turned an L of
 * two walls into a triangle — a third wall, on a diagonal, that nobody had
 * drawn. Beyond two points nothing is enclosed until the player says it is, by
 * returning to the first point.
 *
 * A corner is a BLOCK the player can see and walk to, not only a particle.
 * Particles vanish behind terrain, do not survive a relog, and cannot be found
 * again after wandering off — none of which is apparent until you try to square
 * up a plot across a hill.
 */

/**
 * playerId -> { dimension, corners: [...], closed }
 *
 * A corner remembers where it was marked, the blocks that stand for it, and
 * what those blocks replaced, because every one of them has to be put back
 * exactly as it was.
 */
const selections = new Map();
const LABEL_TYPE = "homestead:marker_label";
const LABEL_TAG = "homestead:selection_label";

export function cornersOf(player) {
  return [...(selections.get(player.id)?.corners ?? [])];
}

export function hasCorners(player) {
  return (selections.get(player.id)?.corners.length ?? 0) > 0;
}

/**
 * Is this one of the temporary blocks that represents an active selection?
 *
 * Marker blocks deliberately live outside the claim registry: a selection is
 * not land yet. Protection still needs the canonical selection record rather
 * than a block-type check, or an ordinary lodestone anywhere in the world
 * would become unbreakable.
 */
export function isSelectionMarker(dimensionId, location) {
  for (const selection of selections.values()) {
    if (selection.dimension !== dimensionId) continue;
    for (const corner of selection.corners) {
      const placed = [corner.post, ...(corner.lights ?? [])];
      if (placed.some((marker) =>
        marker?.at.x === location.x &&
        marker.at.y === location.y &&
        marker.at.z === location.z
      )) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Is this marking a traced path rather than a rectangle?
 *
 * Not a setting: a count. Anything past two points is a path, because two
 * points are the only case a rectangle can be read out of.
 */
export function isTraced(player) {
  return (selections.get(player.id)?.corners.length ?? 0) > 2;
}

/**
 * Can the path be closed where it stands?
 *
 * Three walls at least. Two points need no closing — they are already a
 * rectangle, and offering to close them would be offering to do what has been
 * done.
 */
export function canClose(player) {
  const selection = selections.get(player.id);
  if (!selection || selection.closed) return false;
  return selection.corners.length >= 3;
}

/**
 * Closes the traced path, making the last wall run back to the first point.
 *
 * That final wall is a wall like the others: it is drawn, it is part of the
 * boundary, and it exists because the player asked for it — not because the
 * geometry could be completed without them.
 */
export function closePath(player) {
  const selection = selections.get(player.id);
  if (!canClose(player)) return { closed: false, turned: false };

  // The way home has to be a wall too, and the first point cannot move.
  const last = selection.corners[selection.corners.length - 1];
  const first = selection.corners[0];
  let turned = false;

  if (!isWall(last, first) && selection.corners.length < CONFIG.selection.maxPoints) {
    const dimension = world.getDimension(selection.dimension);
    if (!addPoint(dimension, selection, closingTurn(last, first), player)) {
      return { closed: false, turned: false };
    }
    lightsFor(dimension, selection, player);
    turned = true;
  }

  selection.closed = true;
  return { closed: true, turned };
}

/**
 * The shape marked, or undefined while nothing is enclosed yet.
 *
 * Two points are a finished shape the moment the second one lands: the
 * rectangle they describe is closed by construction, and there is nothing for
 * the player to confirm that they have not already said. Three or more have to
 * have been closed, because an open run of walls, however long, still has
 * ground leaking out of one end.
 */
export function selectedShape(player) {
  const selection = selections.get(player.id);
  if (!selection) return undefined;

  if (selection.corners.length < 2) return undefined;
  if (selection.corners.length === 2) return shapeFrom(selection.corners);
  return selection.closed ? shapeFrom(selection.corners) : undefined;
}

function blockAt(dimension, location) {
  try {
    return dimension.getBlock(location);
  } catch {
    // Not loaded. Nothing to read and nothing to write.
    return undefined;
  }
}

/** Writes a block and proves it landed, remembering what it replaced. */
function put(dimension, at, typeId) {
  const block = blockAt(dimension, at);
  if (!block) return undefined;

  const wasAir = block.isAir;
  let original;
  try {
    original = block.permutation;
  } catch { /* unreadable; the marker is still worth placing */ }

  try {
    block.setType(typeId);
  } catch {
    return undefined;
  }

  // Read back rather than trust the write: setType does not always report a
  // refusal as an error, and silence was the worst property of this code.
  if (blockAt(dimension, at)?.typeId !== typeId) return undefined;

  return { at, typeId, original: wasAir ? undefined : original };
}

/** Takes one placed block away, but only while it is still the one we wrote. */
function undo(dimension, placed) {
  if (!placed) return;
  const block = blockAt(dimension, placed.at);
  if (!block || block.typeId !== placed.typeId) return;

  try {
    if (placed.original) block.setPermutation(placed.original);
    else block.setType("minecraft:air");
  } catch { /* chunk unloaded; not worth chasing */ }
}

/**
 * The post that stands for one point.
 *
 * A different block from the lights, because the question was which corner is
 * which and the answer has to be visible on the ground rather than read off a
 * coordinate. The post is what the player clicked; the lights beside it belong
 * to the outline and say which way the land runs.
 *
 * It uses only free air above the block clicked. A marker is temporary UI and
 * is never entitled to replace a real block, even when the space is cramped.
 */
function placePost(dimension, location, player) {
  const cfg = CONFIG.selection.marker;

  for (let up = 1; up <= cfg.searchUp; up++) {
    const at = { x: location.x, y: location.y + up, z: location.z };
    const claim = claimAt(dimension.id, at);
    if (claim && !mayDo(claim, player, "place")) continue;
    const candidate = blockAt(dimension, at);
    if (!candidate) break;
    if (!candidate.isAir) continue;

    const placed = put(dimension, at, cfg.postBlock);
    if (placed) return placed;
  }

  return undefined;
}

/**
 * The two lights beside a post, on the sides facing into the area.
 *
 * They are what turns a lone block into a corner: standing at one, you can see
 * which two directions the boundary leaves in, which is the thing a single
 * block cannot tell you. Which sides those are depends on the shape, so they
 * are redrawn whenever a point is added or taken away.
 */
function lightsFor(dimension, selection, player) {
  const cfg = CONFIG.selection.marker;
  if (!cfg.lightBlock || selection.corners.length < 2) return;

  const shape = shapeFrom(selection.corners);
  const midX = (shape.x1 + shape.x2) / 2;
  const midZ = (shape.z1 + shape.z2) / 2;

  for (const corner of selection.corners) {
    for (const placed of corner.lights ?? []) undo(dimension, placed);
    corner.lights = [];

    const post = corner.post?.at;
    if (!post) continue;

    // One step along each axis, towards the middle of the shape.
    const inward = [
      { x: post.x + (Math.sign(midX - corner.x) || 1), y: post.y, z: post.z },
      { x: post.x, y: post.y, z: post.z + (Math.sign(midZ - corner.z) || 1) },
    ];

    for (const at of inward) {
      const claim = claimAt(dimension.id, at);
      if (claim && !mayDo(claim, player, "place")) continue;
      const block = blockAt(dimension, at);
      // Into free air only: a light is a hint, and no hint is worth taking a
      // block out of somebody's wall for.
      if (!block?.isAir) continue;
      const placed = put(dimension, at, cfg.lightBlock);
      if (placed) corner.lights.push(placed);
    }
  }
}

function forget(dimension, corner) {
  undo(dimension, corner.post);
  for (const placed of corner.lights ?? []) undo(dimension, placed);
  removeLabel(corner.label);
}

/** Clears one point and leaves the rest standing. */
export function clearCorner(player, index) {
  const selection = selections.get(player.id);
  const corner = selection?.corners[index];
  if (!corner) return;

  const dimension = world.getDimension(selection.dimension);
  forget(dimension, corner);
  selection.corners.splice(index, 1);
  renumberLabels(selection);

  // Removing a wall opens the path again: what is left no longer encloses what
  // the player agreed to.
  selection.closed = false;

  if (selection.corners.length === 0) selections.delete(player.id);
  else lightsFor(dimension, selection, player);
}

/** Clears every marker and forgets the selection. */
export function clearSelection(player) {
  const selection = selections.get(player.id);
  if (!selection) return;

  const dimension = world.getDimension(selection.dimension);
  for (const corner of selection.corners) forget(dimension, corner);
  selections.delete(player.id);
}

function freshSelection(player) {
  const selection = { dimension: player.dimension.id, corners: [], closed: false };
  selections.set(player.id, selection);
  return selection;
}

/**
 * A wall is straight or it is a true diagonal. There is nothing in between.
 *
 * Any other slope draws as a long run of blocks with a jog somewhere in the
 * middle — one part in line, one part stepping aside, and no rule a player can
 * see. It is not a diagonal and it is not a wall; it is the shape of an
 * unrounded number, and standing on it there is no way to tell where the
 * boundary was meant to be.
 *
 * So a mark that would make one is moved to the nearest position that would
 * not. The player is choosing a direction, not a slope, and this keeps the two
 * from being confused.
 */
function isWall(from, to) {
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  return dx === 0 || dz === 0 || dx === dz;
}

/** The legal position nearest to where the player actually marked. */
function snapToWall(from, to) {
  if (isWall(from, to)) return to;

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const diagonal = Math.round((Math.abs(dx) + Math.abs(dz)) / 2);

  const candidates = [
    { x: from.x, y: to.y, z: to.z },                                    // due north or south
    { x: to.x, y: to.y, z: from.z },                                    // due east or west
    {                                                                    // exactly 45 degrees
      x: from.x + Math.sign(dx) * diagonal,
      y: to.y,
      z: from.z + Math.sign(dz) * diagonal,
    },
  ];

  let best;
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const cost = Math.abs(candidate.x - to.x) + Math.abs(candidate.z - to.z);
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

/**
 * The corner a closing wall needs, when the way home is neither straight nor
 * diagonal.
 *
 * Closing is the one place a corner has to be invented: the first point is
 * where it is, and the player cannot move it. The diagonal leg is walked as
 * far as it goes and the rest is straight, which is the path anyone would take
 * building it by hand — and the player is told it happened.
 */
function closingTurn(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const legs = Math.min(Math.abs(dx), Math.abs(dz));
  return {
    x: from.x + Math.sign(dx) * legs,
    y: to.y,
    z: from.z + Math.sign(dz) * legs,
  };
}

/**
 * Moves a point that is already down, markers and all.
 *
 * Used in exactly one place, and only ever on the second point: a rectangle's
 * two corners lie on its diagonal, which is a slope no wall may take, so the
 * moment a third point turns those corners into walls the second one may have
 * to shift to the nearest position a wall can reach. The player is told, and
 * the point can still be cleared like any other.
 */
function movePoint(dimension, selection, index, location, player) {
  const corner = selection.corners[index];
  if (!corner) return false;

  const post = placePost(dimension, location, player);
  if (!post) return false;
  forget(dimension, corner);
  selection.corners[index] = {
    x: location.x, y: location.y, z: location.z, post, lights: [],
    label: placeLabel(dimension, post, index + 1),
  };
  return true;
}

/** Puts one point down: the post, and the lights that follow from it. */
function addPoint(dimension, selection, location, player) {
  const post = placePost(dimension, location, player);
  if (!post) return false;
  const number = selection.corners.length + 1;
  selection.corners.push({
    x: location.x,
    y: location.y,
    z: location.z,
    post,
    lights: [],
    label: placeLabel(dimension, post, number),
  });
  return true;
}

/**
 * The run of blocks a wall covers between two marks.
 *
 * A wall that is not along an axis is a staircase — the same staircase anyone
 * building it by hand would lay, one block per step. Walking it here means the
 * outline drawn is the outline claimed, block for block.
 *
 * An earlier version inserted an elbow instead, turning one wall into two at a
 * corner the player never marked. It was the triangle mistake in miniature:
 * inventing geometry rather than following what was traced.
 */
function wallBlocks(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dz));
  if (steps === 0) return [{ x: from.x, z: from.z }];

  const blocks = [];
  for (let i = 0; i <= steps; i++) {
    blocks.push({
      x: Math.round(from.x + (dx * i) / steps),
      z: Math.round(from.z + (dz * i) / steps),
    });
  }
  return blocks;
}

/**
 * Records a clicked block as a point.
 *
 * The third click is where the shape changes meaning, and it is the only place
 * this file has to be careful. Up to then the marks are two opposite corners
 * of a rectangle, free to sit anywhere relative to each other. From the third
 * on they are a run of walls, and a wall runs straight or exactly diagonal —
 * so the second point is pulled onto the nearest position that satisfies that,
 * and the player is told it moved.
 *
 * This is the one thing the old two-mode design bought, and it costs a
 * sentence of explanation once instead of a decision before every marking:
 * nobody has to know which mode they want before they know what the land looks
 * like.
 *
 * Clicking on a shape that is already finished starts a new one. Someone
 * marking again has changed their mind, and making them find a "clear" button
 * first would be ceremony.
 */
export function markCorner(player, location) {
  let selection = selections.get(player.id);

  // A shape spanning two dimensions is not a shape.
  if (selection && selection.dimension !== player.dimension.id) {
    clearSelection(player);
    selection = undefined;
  }

  if (selection?.closed) {
    clearSelection(player);
    selection = undefined;
  }

  const claimed = claimAt(player.dimension.id, location);
  if (claimed && !mayDo(claimed, player, "place")) {
    return { corners: selection?.corners.length ?? 0, marked: false, denied: claimed };
  }

  // Do not create even transient selection state until the click is allowed.
  if (!selection) selection = freshSelection(player);

  /*
   * Clicking near where the path began closes it. Marking the exact block is
   * asking for a precision the player has no way to confirm from six blocks
   * away, so anything within reach of the first post counts as returning to
   * it.
   */
  if (!selection.closed && selection.corners.length >= 3) {
    const first = selection.corners[0];
    const near = CONFIG.selection.closeWithin;
    if (Math.abs(location.x - first.x) <= near && Math.abs(location.z - first.z) <= near) {
      const result = closePath(player);
      return {
        corners: selection.corners.length,
        marked: result.closed,
        closed: result.closed,
        turned: result.turned,
      };
    }
  }

  if (selection.corners.length >= CONFIG.selection.maxPoints) {
    return { corners: selection.corners.length, marked: false, full: true };
  }

  const dimension = player.dimension;

  /*
   * The point that turns a rectangle into a path. The first wall only comes
   * into existence now, so this is the first moment the second point can be
   * asked to lie on one.
   */
  let straightened = false;
  if (selection.corners.length === 2) {
    const [first, second] = selection.corners;
    const onWall = snapToWall(first, second);
    if (onWall !== second) {
      straightened = movePoint(dimension, selection, 1, onWall, player);
      if (!straightened) {
        return { corners: selection.corners.length, marked: false };
      }
    }
  }

  const last = selection.corners[selection.corners.length - 1];

  // Only a wall has a direction to obey. The second point does not: at that
  // stage the marks are opposite corners, and the sides follow from them.
  const target = selection.corners.length >= 2 ? snapToWall(last, location) : location;

  // Snapping onto the point before it would be a wall of no length.
  if (last && target.x === last.x && target.z === last.z) {
    return { corners: selection.corners.length, marked: false, tooClose: true, straightened };
  }

  const targetClaim = claimAt(player.dimension.id, target);
  if (targetClaim && !mayDo(targetClaim, player, "place")) {
    return { corners: selection.corners.length, marked: false, denied: targetClaim };
  }

  const marked = addPoint(dimension, selection, target, player);
  if (!marked) {
    return { corners: selection.corners.length, marked: false };
  }
  lightsFor(dimension, selection, player);

  return {
    corners: selection.corners.length,
    marked,
    full: false,
    snapped: target !== location,
    // Worth saying out loud: from here on the marks are walls, not corners.
    becamePath: selection.corners.length === 3,
    straightened,
  };
}

function spawn(player, particle, x, y, z) {
  try {
    // Player.spawnParticle is intentionally scoped to one client. Selection
    // guidance belongs to the person drawing it, not to every nearby player.
    player.spawnParticle(particle, { x, y, z });
    return 1;
  } catch {
    // Missing particle, or an unloaded chunk. Neither deserves a log line on a
    // loop that runs several times a second.
    return 0;
  }
}

/**
 * The height of the ground at a column, near a height already known.
 *
 * This is what puts the preview ON the ground instead of at one fixed height.
 * A single height draws straight through a hillside: buried where the land
 * rises, floating where it falls, readable only from directly above. The
 * search is deliberately short — a few blocks either way from the point that
 * anchors it — so the cost stays bounded however large the claim is.
 */
function groundY(dimension, x, z, near) {
  const cfg = CONFIG.selection.outline;
  for (let y = near + cfg.groundSearch; y >= near - cfg.groundSearch; y--) {
    const block = blockAt(dimension, { x, y, z });
    if (!block) return near;
    if (!block.isAir) return y + 1;
  }
  return near - cfg.groundSearch;
}

/**
 * Draws an outline that follows the ground, rising into a wall along the way.
 *
 * The spacing adapts rather than the drawing being cut short. With a fixed
 * step, a large shape exhausted the particle budget partway round and the
 * remaining edges were never drawn — a border missing two sides, which reads
 * as a bug rather than as a big claim.
 */
function drawEdges(player, points, anchorY, closed = true, style = {}) {
  const cfg = CONFIG.selection.outline;
  const dimension = player.dimension;
  const particle = style.particle ?? cfg.particle;
  const wallHeight = style.wallHeight ?? cfg.wallHeight;
  const cornerHeight = style.cornerHeight ?? cfg.cornerHeight;
  const maxParticles = style.maxParticles ?? cfg.maxParticles;

  // An open path has one fewer edge than it has points: nothing runs from the
  // last back to the first while the shape is still being drawn.
  const edges = [];
  for (let i = 1; i < points.length; i++) edges.push([points[i - 1], points[i]]);
  if (closed && points.length > 2) edges.push([points[points.length - 1], points[0]]);

  let perimeter = 0;
  for (const [from, to] of edges) {
    perimeter += Math.abs(to.x - from.x) + Math.abs(to.z - from.z);
  }

  const step = Math.max(
    cfg.spacing,
    Math.ceil((perimeter * Math.max(1, wallHeight)) / Math.max(1, maxParticles))
  );

  let budget = maxParticles;

  const column = (x, z, height) => {
    const base = cfg.followGround ? groundY(dimension, x, z, anchorY) : anchorY;
    for (let i = 0; i < height && budget > 0; i++) {
      budget -= spawn(player, particle, x + 0.5, base + i, z + 0.5);
    }
  };

  // The vertices first: if the budget runs short, these are what still says
  // where the shape is.
  for (const point of points) column(point.x, point.z, cornerHeight);

  /*
   * Every block of the wall, not a sample of the line through it. On an axis
   * these are the same thing; off it, the difference is whether the player is
   * shown the staircase the claim will actually follow or a row of dots
   * hovering along a diagonal that no block sits on.
   */
  for (const [from, to] of edges) {
    const blocks = wallBlocks(from, to);
    for (let i = 1; i < blocks.length - 1 && budget > 0; i += step) {
      column(blocks[i].x, blocks[i].z, wallHeight);
    }
  }
}

/** Creates an invisible, non-interactive nameplate over a marker post. */
function placeLabel(dimension, post, number) {
  if (!post) return undefined;
  let label;
  try {
    label = dimension.spawnEntity(LABEL_TYPE, {
      x: post.at.x + 0.5,
      y: post.at.y + 1.45,
      z: post.at.z + 0.5,
    });
    label.nameTag = `§ePonto ${number}`;
    label.nameplateRenderDistance = 96;
    label.nameplateDepthTested = false;
    label.addTag(LABEL_TAG);
    return label;
  } catch (e) {
    try { if (label?.isValid) label.remove(); } catch { /* incomplete spawn */ }
    console.warn(`[Homestead] marker label could not be created: ${e}`);
    return undefined;
  }
}

function removeLabel(label) {
  try {
    if (label?.isValid) label.remove();
  } catch { /* already gone or its chunk unloaded */ }
}

/** Keeps numbers consecutive after deleting a point. */
function renumberLabels(selection) {
  selection.corners.forEach((corner, index) => {
    try {
      if (corner.label?.isValid) corner.label.nameTag = `§ePonto ${index + 1}`;
    } catch { /* label unavailable */ }
  });
}

/**
 * What to draw for a marking still in progress.
 *
 * From the very first point, and that is the correction: the preview used to
 * wait for the shape to be valid, so a player placing points saw nothing at all
 * during the one part of the job where seeing matters. One point draws a
 * column; two or more draw the path between them, open, because that is what
 * has been marked so far and pretending otherwise would show a shape the
 * player has not made yet.
 */
function drawProgress(player, selection) {
  const points = selection.corners;
  if (points.length === 0) return;

  const anchorY = points[0].y;

  if (points.length === 2) {
    // Two corners of a rectangle already describe all four.
    drawEdges(player, ringOf(shapeFrom(points)), anchorY, true);
    return;
  }

  // Open until the player closes it: the wall back to the first point is not
  // drawn, because it has not been drawn.
  drawEdges(player, points, anchorY, Boolean(selection.closed));
}

/** The outline of a shape, as a ring of points to walk. */
function ringOf(shape) {
  if (isPolygon(shape)) return shape.points;
  return [
    { x: shape.x1, z: shape.z1 },
    { x: shape.x2, z: shape.z1 },
    { x: shape.x2, z: shape.z2 },
    { x: shape.x1, z: shape.z2 },
  ];
}

/** Is any part of the shape close enough to be worth drawing? */
function withinSight(player, shape) {
  const cfg = CONFIG.selection.outline;
  const x = Math.max(shape.x1, Math.min(player.location.x, shape.x2));
  const z = Math.max(shape.z1, Math.min(player.location.z, shape.z2));
  const dx = x - player.location.x;
  const dz = z - player.location.z;
  return dx * dx + dz * dz <= cfg.visibleWithin * cfg.visibleWithin;
}

/**
 * Draws the ground that a different owner has made unavailable to this player.
 *
 * Claim validation compares bounding boxes with a mandatory gap. Expanding an
 * existing box by that exact gap therefore visualises the same cells the
 * validator will reject, rather than an approximation that can disagree at
 * the edge. Nearest regions are drawn first and capped so a crowded server
 * cannot turn one marking wand into an unbounded particle loop.
 */
function drawOtherOwnersLimits(player, claims) {
  const cfg = CONFIG.selection.outline;
  const gap = CONFIG.minGapBetweenOwners;

  const forbidden = claims
    .filter((claim) =>
      claim.dimension === player.dimension.id &&
      claim.ownerId !== player.id
    )
    .map((claim) => ({
      x1: claim.x1 - gap,
      x2: claim.x2 + gap,
      z1: claim.z1 - gap,
      z2: claim.z2 + gap,
    }))
    .filter((shape) => withinSight(player, shape))
    .sort((a, b) => distanceSquared(player, a) - distanceSquared(player, b))
    .slice(0, cfg.maxConflictOutlines);

  const budgetPerOutline = Math.max(
    1,
    Math.floor(cfg.conflictMaxParticles / Math.max(1, forbidden.length))
  );

  for (const shape of forbidden) {
    drawEdges(
      player,
      ringOf(shape),
      Math.floor(player.location.y),
      true,
      {
        particle: cfg.conflictParticle,
        wallHeight: cfg.conflictWallHeight,
        cornerHeight: cfg.conflictCornerHeight,
        maxParticles: budgetPerOutline,
      }
    );
  }
}

function distanceSquared(player, shape) {
  const x = Math.max(shape.x1, Math.min(player.location.x, shape.x2));
  const z = Math.max(shape.z1, Math.min(player.location.z, shape.z2));
  const dx = x - player.location.x;
  const dz = z - player.location.z;
  return dx * dx + dz * dz;
}

export function registerSelection() {
  const cfg = CONFIG.selection.outline;

  // A script reload forgets its in-memory selections. Remove any nameplates
  // left by the previous instance instead of letting them become permanent.
  subscribeSafe(world.afterEvents, "worldLoad", () => {
    for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
      try {
        for (const label of world.getDimension(id).getEntities({ type: LABEL_TYPE })) label.remove();
      } catch { /* dimension or chunk unavailable */ }
    }
  });

  system.runInterval(() => {
    // One registry read per redraw. Reading it once per selecting player would
    // repeatedly parse the same world property on a busy server.
    let claims;
    for (const player of world.getPlayers()) {
      /*
       * The boundary is shown to whoever is asking about boundaries, and to
       * nobody else. Drawn to everyone all the time it stops being information
       * and becomes weather: a fence of particles across the landscape that
       * players learn to see past, and that costs the server to draw for
       * people who are only walking home.
       */
      if (CONFIG.selection.outline.onlyWhenHolding && !holdingTool(player)) continue;

      const selection = selections.get(player.id);

      if (selection) {
        if (selection.dimension !== player.dimension.id) continue;
        if (selection.corners.length > 0) {
          // Bounds of what is marked so far, which is what decides whether it
          // is close enough to bother drawing.
          if (withinSight(player, shapeFrom(selection.corners))) {
            drawProgress(player, selection);
          }
          if (!claims) claims = allClaims();
          drawOtherOwnersLimits(player, claims);
        }
        continue;
      }

      /*
       * Not marking: the claim underfoot is outlined instead. This is the
       * answer to "where does my land actually end", which coordinates in chat
       * never really gave — and it costs nothing on free land, which is where
       * players spend most of their time.
       */
      const here = claimAt(player.dimension.id, player.location);
      if (here && withinSight(player, here)) {
        drawEdges(player, ringOf(here), Math.floor(player.location.y));
      }
    }
  }, cfg.everyTicks);

  // Markers are world blocks: leaving them behind would litter the map with
  // stone nobody can explain.
  subscribeSafe(world.afterEvents, "playerLeave", (ev) => {
    const selection = selections.get(ev.playerId);
    if (!selection) return;
    const dimension = world.getDimension(selection.dimension);
    for (const corner of selection.corners) forget(dimension, corner);
    selections.delete(ev.playerId);
  });
}
