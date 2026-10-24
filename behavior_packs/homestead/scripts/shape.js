/**
 * The geometry of a claim, kept apart from the registry that stores it.
 *
 * A claim is either a rectangle — two opposite corners — or a polygon of any
 * number of points. Both carry a bounding box, and that is not redundancy: it
 * is what keeps the polygon affordable.
 *
 * `contains` runs on every break, place and interact of every player on the
 * server. For a rectangle it is four comparisons. For a polygon it is a ray
 * cast across every edge plus a test against the walls themselves, which is
 * far more work — so the bounding box is tested first and rejects almost every
 * call before any of it is reached. A player standing anywhere outside the
 * box, which is nearly everywhere, costs exactly what a rectangle costs.
 */

/** The smallest rectangle enclosing the points. */
export function boundsOf(points) {
  const xs = points.map((p) => Math.floor(p.x));
  const zs = points.map((p) => Math.floor(p.z));
  return {
    x1: Math.min(...xs),
    x2: Math.max(...xs),
    z1: Math.min(...zs),
    z2: Math.max(...zs),
  };
}

/**
 * A shape from the points marked.
 *
 * Two points describe a rectangle and are stored as one: the other two corners
 * are derived, and keeping them would be storing the same fact twice. Three or
 * more are kept as they are.
 */
export function shapeFrom(points) {
  const bounds = boundsOf(points);
  if (points.length <= 2) return bounds;
  return {
    ...bounds,
    points: points.map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) })),
  };
}

export function isPolygon(shape) {
  return Array.isArray(shape.points) && shape.points.length > 2;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function onSegment(a, b, p) {
  return cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
    p.z >= Math.min(a.z, b.z) && p.z <= Math.max(a.z, b.z);
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b));
}

/** A polygon must enclose one unambiguous region and never cross itself. */
export function isSimplePolygon(shape) {
  if (!isPolygon(shape)) return true;
  const points = shape.points;
  let twiceArea = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.x === b.x && a.z === b.z) return false;
    twiceArea += a.x * b.z - b.x * a.z;
  }
  if (twiceArea === 0) return false;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      const c = points[j];
      const d = points[(j + 1) % points.length];
      const adjacent = j === i + 1 || (i === 0 && j === points.length - 1);
      if (!intersects(a, b, c, d)) continue;
      if (!adjacent) return false;

      // Adjacent edges may meet at their shared endpoint, but may not turn
      // back over one another or repeat part of the same wall.
      const shared = j === i + 1 ? b : a;
      const otherA = j === i + 1 ? a : b;
      const otherB = j === i + 1 ? d : c;
      if (cross(otherA, shared, otherB) === 0) {
        const into = { x: shared.x - otherA.x, z: shared.z - otherA.z };
        const out = { x: otherB.x - shared.x, z: otherB.z - shared.z };
        if (into.x * out.x + into.z * out.z <= 0) return false;
      }
    }
  }
  return true;
}

/** Reject malformed, non-finite or internally inconsistent stored shapes. */
export function isValidShape(shape) {
  if (!shape || typeof shape !== "object") return false;
  const fields = [shape.x1, shape.x2, shape.z1, shape.z2];
  if (!fields.every((value) => Number.isFinite(value) && Number.isInteger(value))) return false;
  if (shape.x1 > shape.x2 || shape.z1 > shape.z2) return false;
  if (!isPolygon(shape)) return shape.points === undefined;
  if (!shape.points.every((point) =>
    Number.isFinite(point?.x) && Number.isInteger(point.x) &&
    Number.isFinite(point?.z) && Number.isInteger(point.z)
  )) return false;
  const bounds = boundsOf(shape.points);
  if (bounds.x1 !== shape.x1 || bounds.x2 !== shape.x2 ||
      bounds.z1 !== shape.z1 || bounds.z2 !== shape.z2) return false;
  return isSimplePolygon(shape);
}

/** Width and depth of the bounding box. Inclusive: one block wide is 1. */
export function sizeOf(shape) {
  return { width: shape.x2 - shape.x1 + 1, depth: shape.z2 - shape.z1 + 1 };
}

/**
 * Even-odd ray casting: a ray east from the point crosses the outline an odd
 * number of times when the point is inside.
 *
 * Block centres rather than corners, which keeps a point off the corner of an
 * edge but does NOT settle the boundary. This comment used to claim it did,
 * and that assumption is why the walls of every traced claim shipped
 * unprotected: a centre sitting exactly on a horizontal edge crosses nothing,
 * so the edge decides nothing, and the block falls out of the shape. The wall
 * is handled separately, by `onWall`.
 */
function insidePolygon(points, x, z) {
  const px = x + 0.5;
  const pz = z + 0.5;
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const ax = points[i].x + 0.5;
    const az = points[i].z + 0.5;
    const bx = points[j].x + 0.5;
    const bz = points[j].z + 0.5;

    const straddles = az > pz !== bz > pz;
    if (straddles && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Is this block one of the walls?
 *
 * Ray casting decides what is INSIDE an outline, and by convention it leaves
 * the outline's far edges out — for a square drawn with four marks, the east
 * wall and the north wall came back unprotected while everything between them
 * was fine. That is not an edge case in the mathematics; it is the boundary
 * the player walked and built, reported as somebody else's ground.
 *
 * The test is cheap because a wall is straight or exactly diagonal and can be
 * nothing else, so each edge is three comparisons rather than a rasterisation.
 */
function onWall(points, x, z) {
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];

    const withinX = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x);
    const withinZ = z >= Math.min(a.z, b.z) && z <= Math.max(a.z, b.z);
    if (!withinX || !withinZ) continue;

    const dx = b.x - a.x;
    const dz = b.z - a.z;

    if (dx === 0) return true;                      // runs north to south
    if (dz === 0) return true;                      // runs east to west
    if (Math.abs(x - a.x) === Math.abs(z - a.z)) {  // the staircase itself
      return true;
    }
  }
  return false;
}

/**
 * Is this block position inside the shape?
 *
 * The wall counts as inside. A claim whose own boundary is not part of it
 * cannot be fenced: the blocks the owner marked out are the first ones a
 * stranger would take.
 */
export function contains(shape, x, z) {
  // The cheap test first, and it is the one that answers almost every call.
  if (x < shape.x1 || x > shape.x2 || z < shape.z1 || z > shape.z2) return false;
  if (!isPolygon(shape)) return true;
  return insidePolygon(shape.points, x, z) || onWall(shape.points, x, z);
}

/** Greatest common divisor, for counting the blocks an edge passes through. */
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * Surface in blocks, counting the walls.
 *
 * Pick's theorem: for a shape whose corners sit on a grid, the enclosed area
 * equals the blocks strictly inside plus half the blocks on the boundary,
 * minus one. Turned around, the blocks a claim actually occupies are the
 * enclosed area plus half the boundary plus one.
 *
 * The shoelace area alone was what this returned before, and it undercounts by
 * the whole perimeter — a seven by seven square reported 36 blocks instead of
 * 49. That is the budget being spent wrong, in the player's favour, which is
 * the direction nobody notices until the land runs out later than it should.
 */
export function areaOf(shape) {
  if (!isPolygon(shape)) {
    const { width, depth } = sizeOf(shape);
    return width * depth;
  }

  const points = shape.points;
  let twiceArea = 0;
  let boundary = 0;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    twiceArea += points[j].x * points[i].z - points[i].x * points[j].z;
    boundary += gcd(points[i].x - points[j].x, points[i].z - points[j].z);
  }

  const enclosed = Math.abs(twiceArea) / 2;
  return Math.round(enclosed + boundary / 2 + 1);
}

/**
 * Do two shapes conflict, allowing for a gap between different owners?
 *
 * Bounding boxes only, and deliberately so. Two interlocking polygons whose
 * boxes overlap but whose outlines never touch are refused, which is stricter
 * than necessary — but the alternative is edge-by-edge intersection plus a
 * containment test for one shape sitting entirely inside another, run against
 * every existing claim each time someone claims land. Being too careful costs
 * a player one awkward shape. Being wrong costs them their base.
 */
export function conflicts(a, b, gap) {
  return !(
    a.x2 + gap < b.x1 ||
    a.x1 - gap > b.x2 ||
    a.z2 + gap < b.z1 ||
    a.z1 - gap > b.z2
  );
}
