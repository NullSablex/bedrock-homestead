import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { t } from "./msg.js";
import { contains, areaOf, sizeOf, conflicts, shapeFrom, isValidShape } from "./shape.js";
import { may } from "./permissions.js";
import { MEMBER_DEFAULTS, GUEST_DEFAULTS } from "./actions.js";
import { defaultMobRules } from "./mobs.js";
import { protectionLimits } from "./settings.js";
import { isOperator } from "./access.js";

/**
 * The claim registry, persisted in a world dynamic property.
 *
 * A claim is a shape in X/Z — a rectangle, or a polygon of any number of
 * points. The geometry lives in shape.js; this file only stores and validates.
 *
 * Lookup is a linear scan, which is right for dozens of claims; if this ever
 * holds thousands, the next step is an index by chunk rather than a faster
 * scan.
 */
const KEY = "homestead:areas";
export const PUBLIC_OWNER_ID = "homestead:public";

function readAll() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw !== "string" || !raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Starting empty loses claims, but refusing to load loses the whole
    // add-on. The log line is the only trace either way.
    console.warn("[Homestead] registry unreadable, starting empty");
    return [];
  }
}

function writeAll(list) {
  try {
    world.setDynamicProperty(KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn("[Homestead] could not write the registry: " + e);
    return false;
  }
}

export function allClaims() {
  return readAll();
}

export function claimsOf(ownerId) {
  return readAll().filter((c) => c.ownerId === ownerId);
}

export function isPublicClaim(claim) {
  return claim?.public === true || claim?.ownerId === PUBLIC_OWNER_ID;
}

export function publicClaims() {
  return readAll().filter(isPublicClaim);
}

export function playerClaims() {
  return readAll().filter((claim) => !isPublicClaim(claim));
}

/** RawMessage-safe owner label for chat and forms. */
export function claimOwnerName(claim) {
  return isPublicClaim(claim) ? t("homestead.owner.public") : String(claim?.ownerName ?? "");
}

/** Plain, bounded labels cannot inject formatting into forms or world data. */
export function cleanClaimName(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[^\x20-\x7eáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONFIG.claims.maxNameLength);
}

/** Names are identifiers for people, so one owner cannot reuse one twice. */
export function claimNameAvailable(ownerId, name, exceptId) {
  const wanted = cleanClaimName(name).toLowerCase();
  if (!wanted) return false;
  return !claimsOf(ownerId).some(
    (claim) => claim.id !== exceptId && cleanClaimName(claim.name).toLowerCase() === wanted
  );
}

function nextClaimName(mine) {
  const used = new Set(mine.map((claim) => cleanClaimName(claim.name).toLowerCase()));
  for (let number = 1; ; number++) {
    const candidate = `Area ${number}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The claim containing the point, or undefined. */
export function claimAt(dimensionId, loc) {
  const x = Math.floor(loc.x);
  const z = Math.floor(loc.z);
  return readAll().find(
    (c) =>
      c.dimension === dimensionId &&
      contains(c, x, z) &&
      (c.heightMode === "full" || (loc.y >= c.y1 && loc.y <= c.y2))
  );
}

/** Square of the configured size, centred on the player. */
export function rectAround(loc) {
  const half = Math.floor(CONFIG.quickSize / 2);
  const x = Math.floor(loc.x);
  const z = Math.floor(loc.z);
  return { x1: x - half, x2: x + half, z1: z - half, z2: z + half };
}

/** A rectangle from any two opposite corners, in any order. */
export function rectBetween(a, b) {
  return {
    x1: Math.min(Math.floor(a.x), Math.floor(b.x)),
    x2: Math.max(Math.floor(a.x), Math.floor(b.x)),
    z1: Math.min(Math.floor(a.z), Math.floor(b.z)),
    z2: Math.max(Math.floor(a.z), Math.floor(b.z)),
  };
}

/** Surface already claimed by this player, across every claim. */
export function usedBlocks(ownerId) {
  return claimsOf(ownerId).reduce((total, c) => total + areaOf(c), 0);
}

/**
 * Checks geometry without changing the registry.
 *
 * Creation and reshaping deliberately share this contract. That keeps an edit
 * from becoming a quieter way around the side, budget, overlap or safety-gap
 * limits enforced when the area was first created.
 */
function geometryProblem(list, dimensionId, shape, options) {
  const cfg = CONFIG.selection;
  const limits = protectionLimits();
  const {
    ownerId, publicArea, exceptId,
    budgetCredit = 0, relatedOwnerId,
  } = options;

  if (!isValidShape(shape)) return t("homestead.limit.invalid");

  const { width, depth } = sizeOf(shape);
  if (width < cfg.minSide || depth < cfg.minSide) {
    return t("homestead.limit.small", `${width}x${depth}`, cfg.minSide);
  }
  if (width > cfg.maxSide || depth > cfg.maxSide) {
    return t("homestead.limit.large", `${width}x${depth}`, cfg.maxSide);
  }

  if (!publicArea) {
    const used = list
      .filter((claim) => claim.ownerId === ownerId)
      .reduce((total, claim) => total + areaOf(claim), 0);
    const wanted = areaOf(shape);
    const usedWithoutEditedClaim = used - budgetCredit;
    const available = Math.max(0, limits.blockBudget - usedWithoutEditedClaim);
    // If an administrator lowered the limit below existing use, players must
    // still be able to shrink or move an area of the same size. Only an edit
    // that worsens the overage is refused.
    const exceedsBudget = usedWithoutEditedClaim + wanted > limits.blockBudget;
    if (exceedsBudget && wanted > budgetCredit) {
      return t("homestead.limit.budget", wanted, available, limits.blockBudget);
    }
  }

  for (const claim of list) {
    if (claim.id === exceptId || claim.dimension !== dimensionId) continue;

    // Related land may touch but never overlap. Public land remains related to
    // the operator who created it even when another operator later reshapes it.
    const related = claim.ownerId === ownerId ||
      (publicArea && relatedOwnerId && claim.ownerId === relatedOwnerId);
    const gap = related ? 0 : CONFIG.minGapBetweenOwners;
    if (!conflicts(shape, claim, gap)) continue;

    if (claim.ownerId === ownerId) {
      return t(publicArea ? "homestead.overlap.public" : "homestead.overlap.own");
    }
    if (claim.ownerId === relatedOwnerId) return t("homestead.overlap.own");
    return t("homestead.overlap.other", claimOwnerName(claim));
  }

  return undefined;
}

/**
 * Validates and creates. Returns { ok: true, claim } or { ok: false, message },
 * where `message` is already a RawMessage ready to be sent.
 *
 * Every rejection says the number that was exceeded and the number allowed. A
 * refusal that only says no leaves the player guessing how much smaller to try.
 */
export function createClaim(player, dimensionId, shape, requestedName, options = {}) {
  const list = readAll();
  const limits = protectionLimits();
  const publicArea = options.public === true;
  if (publicArea && !isOperator(player)) {
    return { ok: false, message: t("homestead.manage.denied") };
  }
  const ownerId = publicArea ? PUBLIC_OWNER_ID : player.id;

  const mine = list.filter((c) => c.ownerId === ownerId);
  if (!publicArea && mine.length >= limits.maxClaims) {
    return { ok: false, message: t("homestead.limit.count", mine.length, limits.maxClaims) };
  }

  const name = cleanClaimName(requestedName) || nextClaimName(mine);
  if (!claimNameAvailable(ownerId, name)) {
    return { ok: false, message: t("homestead.claim.name.used") };
  }

  const problem = geometryProblem(list, dimensionId, shape, {
    ownerId, publicArea, relatedOwnerId: publicArea ? player.id : undefined,
  });
  if (problem) return { ok: false, message: problem };

  // The clock alone can repeat: two claims made in the same millisecond would
  // share an id, and every lookup reads the first match. The list is already
  // in hand, so the collision is cheap to rule out.
  const taken = new Set(list.map((c) => c.id));
  let id = "c" + Date.now().toString(36);
  for (let suffix = 1; taken.has(id); suffix++) {
    id = "c" + Date.now().toString(36) + "-" + suffix;
  }

  const claim = {
    id,
    name,
    ownerId,
    ownerName: publicArea ? "Server" : player.name,
    ...(publicArea ? { public: true, createdBy: player.id } : {}),
    dimension: dimensionId,
    x1: shape.x1, x2: shape.x2, z1: shape.z1, z2: shape.z2,
    // Present only for a polygon; a rectangle is fully described by its box.
    ...(shape.points ? { points: shape.points } : {}),
    heightMode: CONFIG.heightMode,
    y1: -64, y2: 320,
    members: [],
    // What a stranger may do here, stored on the claim so a change follows the
    // land rather than the session.
    guests: { ...GUEST_DEFAULTS },
    // Monsters refused, everything else welcome: the arrangement almost every
    // owner ends up at by hand. Existing claims keep whatever they already say.
    mobs: defaultMobRules(),
    ...(publicArea ? { combat: { allowPvp: false } } : {}),
    time: Date.now(),
  };
  list.push(claim);
  if (!writeAll(list)) return { ok: false, message: t("homestead.storage.failed") };
  return { ok: true, claim };
}

/**
 * Atomically replaces only an area's geometry.
 *
 * The stored record is read again at save time, authority is checked again,
 * and every creation constraint is re-applied with the old surface credited
 * back to its owner. A rejected edit leaves the original record untouched.
 */
export function reshapeClaim(player, id, dimensionId, shape) {
  const list = readAll();
  const index = list.findIndex((claim) => claim.id === id);
  if (index < 0) return { ok: false, message: t("homestead.claim.missing") };

  const current = list[index];
  if (!mayManage(current, player)) {
    return { ok: false, message: t("homestead.manage.denied") };
  }
  if (current.dimension !== dimensionId) {
    return { ok: false, message: t("homestead.claim.edit.dimension") };
  }

  const publicArea = isPublicClaim(current);
  // Public records created before creator attribution existed are adopted by
  // the first operator who successfully reshapes them. This preserves the
  // original rule that server land may touch that operator's private land.
  const relatedOwnerId = publicArea ? (current.createdBy ?? player.id) : undefined;
  const problem = geometryProblem(list, dimensionId, shape, {
    ownerId: current.ownerId,
    publicArea,
    exceptId: current.id,
    budgetCredit: publicArea ? 0 : areaOf(current),
    relatedOwnerId,
  });
  if (problem) return { ok: false, message: problem };

  const changed = {
    ...current,
    ...(publicArea && !current.createdBy ? { createdBy: relatedOwnerId } : {}),
    x1: shape.x1, x2: shape.x2, z1: shape.z1, z2: shape.z2,
  };
  delete changed.points;
  if (shape.points) changed.points = shape.points.map((point) => ({ ...point }));

  list[index] = changed;
  if (!writeAll(list)) return { ok: false, message: t("homestead.storage.failed") };
  return { ok: true, claim: changed };
}

export function removeClaim(id) {
  const list = readAll();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return writeAll(list);
}

export function updateClaim(claim) {
  const list = readAll();
  const i = list.findIndex((c) => c.id === claim.id);
  if (i < 0) return false;
  list[i] = claim;
  return writeAll(list);
}

/**
 * Players who have asked to preview stranger permissions in their own claims.
 *
 * A single player cannot otherwise test their own protection: they own the
 * land, so every rule says yes, and the only way to see a refusal is to find a
 * second person. The preview applies the public flags of only their own land;
 * real access to anybody else's claim remains unchanged.
 *
 * Deliberately not persisted. Left on by accident it locks someone out of
 * their own base, and a flag that survives a relog is a flag nobody remembers
 * turning on.
 */
const visitors = new Set();

export function isVisitor(player) {
  return visitors.has(player.id);
}

export function setVisitor(player, on) {
  if (on) visitors.add(player.id);
  else visitors.delete(player.id);
}

export function forgetVisitor(playerId) {
  visitors.delete(playerId);
}

/**
 * May this player take this action here?
 *
 * The rules themselves live in permissions.js; this is where the visitor test
 * is folded in, because that state belongs to the session and not to the land.
 */
export function mayDo(claim, player, action) {
  // The test previews the public rules of the player's own land. Applying it
  // to every claim would change their real memberships elsewhere and could
  // turn a harmless preview into an actual entry lockout.
  const testingOwnClaim = visitors.has(player.id) && claim?.ownerId === player.id;
  return may(claim, player, action, testingOwnClaim);
}

/** Shorthand for the commonest question: may they change the blocks here? */
export function mayBuild(claim, player) {
  return mayDo(claim, player, "place") && mayDo(claim, player, "break");
}

/**
 * Trusting and revoking, in one place because the two are the same operation
 * with the outcome flipped, and because both the claim screen and the owner's
 * own menu reach for them.
 */
export function applyTrust(player, claim, target, add, grant = { full: true }) {
  if (!mayManage(claim, player)) {
    return player.sendMessage(t("homestead.manage.denied"));
  }
  const has = claim.members.some((m) => m.id === target.id);

  if (add) {
    if (has) return player.sendMessage(t("homestead.trust.already", target.name));
    /*
     * What they are trusted WITH is decided here, at the moment of trusting,
     * and not left for a second screen. Trusting someone into a claim they
     * cannot then do anything in reads as the add-on being broken; handing
     * every newcomer the run of the place, which is what this used to do, is
     * the opposite mistake and a quieter one.
     *
     * A group, or the run of the place written as this person's own
     * exceptions. Both are explicit, and the owner has already said which.
     */
    claim.members.push({
      id: target.id,
      name: target.name,
      groups: grant.groupId ? [grant.groupId] : [],
      overrides: grant.groupId ? {} : { ...MEMBER_DEFAULTS },
    });
  } else {
    if (!has) return player.sendMessage(t("homestead.untrust.absent", target.name));
    claim.members = claim.members.filter((m) => m.id !== target.id);
  }
  if (!updateClaim(claim)) return player.sendMessage(t("homestead.storage.failed"));
  if (add) {
    player.sendMessage(t("homestead.trust.added", target.name));
    target.sendMessage(t("homestead.trust.notified", player.name));
  } else {
    player.sendMessage(t("homestead.untrust.done", target.name));
  }
}

/** Owner or admin. Trusted members build, but do not hand out access. */
export function mayManage(claim, player) {
  return claim.ownerId === player.id || isOperator(player);
}
