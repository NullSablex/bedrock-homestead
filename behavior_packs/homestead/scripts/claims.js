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
 * Validates and creates. Returns { ok: true, claim } or { ok: false, message },
 * where `message` is already a RawMessage ready to be sent.
 *
 * Every rejection says the number that was exceeded and the number allowed. A
 * refusal that only says no leaves the player guessing how much smaller to try.
 */
export function createClaim(player, dimensionId, shape, requestedName) {
  const list = readAll();
  const cfg = CONFIG.selection;
  const limits = protectionLimits();

  if (!isValidShape(shape)) {
    return { ok: false, message: t("homestead.limit.invalid") };
  }

  const mine = list.filter((c) => c.ownerId === player.id);
  if (mine.length >= limits.maxClaims) {
    return { ok: false, message: t("homestead.limit.count", mine.length, limits.maxClaims) };
  }

  const name = cleanClaimName(requestedName) || nextClaimName(mine);
  if (!claimNameAvailable(player.id, name)) {
    return { ok: false, message: t("homestead.claim.name.used") };
  }

  const { width, depth } = sizeOf(shape);
  if (width < cfg.minSide || depth < cfg.minSide) {
    return { ok: false, message: t("homestead.limit.small", `${width}x${depth}`, cfg.minSide) };
  }
  if (width > cfg.maxSide || depth > cfg.maxSide) {
    return { ok: false, message: t("homestead.limit.large", `${width}x${depth}`, cfg.maxSide) };
  }

  const wanted = areaOf(shape);
  const used = usedBlocks(player.id);
  if (used + wanted > limits.blockBudget) {
    return {
      ok: false,
      message: t("homestead.limit.budget", wanted, limits.blockBudget - used, limits.blockBudget),
    };
  }

  for (const c of list) {
    if (c.dimension !== dimensionId) continue;
    /*
     * Against your own claims the gap does not apply, and that is deliberate:
     * several small claims sitting flush are how a player fences an awkward
     * shape — a farm, a village, anything a single rectangle would not cover.
     * Only real overlap is refused.
     */
    const gap = c.ownerId === player.id ? 0 : CONFIG.minGapBetweenOwners;
    if (conflicts(shape, c, gap)) {
      return {
        ok: false,
        message: c.ownerId === player.id
          ? t("homestead.overlap.own")
          : t("homestead.overlap.other", c.ownerName),
      };
    }
  }

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
    ownerId: player.id,
    ownerName: player.name,
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
    time: Date.now(),
  };
  list.push(claim);
  if (!writeAll(list)) return { ok: false, message: t("homestead.storage.failed") };
  return { ok: true, claim };
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
 * Players who have asked to be treated as strangers in every claim.
 *
 * A single player cannot otherwise test their own protection: they own the
 * land, so every rule says yes, and the only way to see a refusal is to find a
 * second person. This flips the answer for one player who asked for it, which
 * turns "does the protection work" into something answerable alone.
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
  return may(claim, player, action, visitors.has(player.id));
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
