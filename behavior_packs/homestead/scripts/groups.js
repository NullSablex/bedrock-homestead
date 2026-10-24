import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { ACTIONS } from "./actions.js";

/**
 * Named sets of permissions, kept by the owner and used across their claims.
 *
 * The problem this solves is repetition. "What may this person do here" was
 * answered one person at a time, six switches each, on every claim — so the
 * builder you trust on four plots was six decisions times four, and changing
 * your mind about builders meant finding all of them again. A group is that
 * answer written once and pointed at.
 *
 * A group is stored on the OWNER, not on the claim, because that is where the
 * intent lives: "my builders" is a fact about the person's arrangements, not
 * about a rectangle of dirt. A claim then decides whether a group applies to
 * it — see `enabledIn` — and which of its members are in it. The membership is
 * per claim on purpose: the same group means the same permissions everywhere,
 * but who you let into the workshop is not who you let into the house.
 *
 * A rule is three-valued, and this is the part that makes groups combine:
 *
 *   true       the group grants this
 *   false      the group refuses this
 *   undefined  the group has no opinion; some other group may decide
 *
 * Without the third value there is no way to write a group that is about one
 * thing. "Doorkeeper" is a statement about doors and about nothing else, and a
 * two-valued rule set would force it to also say no to breaking blocks — which
 * would then fight with every other group the person is in.
 */

const KEY = "homestead:groups";

function readAll() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw !== "string" || !raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Same trade as the claim registry: an unreadable file loses the groups,
    // refusing to load loses the add-on.
    console.warn("[Homestead] group library unreadable, starting empty");
    return {};
  }
}

function writeAll(all) {
  try {
    world.setDynamicProperty(KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    console.warn("[Homestead] could not write the group library: " + e);
    return false;
  }
}

/** Every group this owner has defined. */
export function groupsOf(ownerId) {
  const list = readAll()[ownerId];
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const valid = [];
  for (const group of list) {
    if (!group || typeof group.id !== "string" || seen.has(group.id)) continue;
    const name = cleanGroupName(group.name);
    if (!name) continue;
    seen.add(group.id);
    valid.push({ ...group, name, rules: rulesOf(group) });
  }
  return valid;
}

export function groupById(ownerId, groupId) {
  return groupsOf(ownerId).find((g) => g.id === groupId);
}

/**
 * Only the rules the group actually states.
 *
 * Anything absent stays absent: a missing key is "no opinion", and filling it
 * in with a default would turn every group into an opinion about everything,
 * which is exactly what makes groups collide.
 */
export function rulesOf(group) {
  const rules = {};
  for (const action of ACTIONS) {
    const value = group?.rules?.[action];
    if (typeof value === "boolean") rules[action] = value;
  }
  return rules;
}

export function saveGroup(ownerId, group) {
  if (typeof ownerId !== "string" || !ownerId || typeof group?.id !== "string" || !group.id) {
    return false;
  }
  const name = cleanGroupName(group.name);
  if (!name) return false;
  const stored = { ...group, name, rules: rulesOf(group) };
  const all = readAll();
  const list = Array.isArray(all[ownerId]) ? all[ownerId] : [];
  const index = list.findIndex((g) => g.id === stored.id);
  if (index < 0) list.push(stored);
  else list[index] = stored;
  all[ownerId] = list;
  return writeAll(all);
}

/** Plain, bounded labels cannot inject formatting or exhaust world storage. */
export function cleanGroupName(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[^\x20-\x7eáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONFIG.groups.maxNameLength);
}

/**
 * A new group, with an id nothing else has.
 *
 * The clock alone is not enough. Two groups created in the same millisecond —
 * which is one screen and two taps, or a claim being set up from another one —
 * would share an id, and everything downstream reads the FIRST match: the
 * second group would be invisible, and taking someone out of one would take
 * them out of the other. The existing ids are right here to be checked
 * against, so they are.
 */
export function createGroup(ownerId, name, rules) {
  const existing = groupsOf(ownerId);
  if (existing.length >= CONFIG.groups.maxPerOwner) return undefined;
  const cleanName = cleanGroupName(name);
  if (!cleanName) return undefined;
  const taken = new Set(existing.map((g) => g.id));

  let id = "g" + Date.now().toString(36);
  let suffix = 0;
  while (taken.has(id)) id = "g" + Date.now().toString(36) + "-" + ++suffix;

  const group = { id, name: cleanName, rules: rulesOf({ rules }) };
  return saveGroup(ownerId, group) ? group : undefined;
}

/**
 * Deletes a group, and takes it off everyone who was in it.
 *
 * The membership has to go with it. A member left pointing at a group that no
 * longer exists loses whatever it granted without anything saying so, and the
 * owner would be reading a name on a screen that means nothing.
 */
export function deleteGroup(ownerId, groupId, claims, save) {
  const all = readAll();
  const list = Array.isArray(all[ownerId]) ? all[ownerId] : [];
  if (!list.some((group) => group?.id === groupId)) return false;
  all[ownerId] = list.filter((g) => g.id !== groupId);
  if (!writeAll(all)) return false;

  let savedAll = true;
  for (const claim of claims) {
    let touched = false;
    for (const member of claim.members ?? []) {
      if (member.groups?.includes(groupId)) {
        member.groups = member.groups.filter((id) => id !== groupId);
        touched = true;
      }
    }
    if (claim.disabledGroups?.includes(groupId)) {
      claim.disabledGroups = claim.disabledGroups.filter((id) => id !== groupId);
      touched = true;
    }
    if (touched && !save(claim)) savedAll = false;
  }
  return savedAll;
}

/**
 * Does this group apply on this claim?
 *
 * Groups belong to the owner, so by default they apply everywhere the owner
 * has land — that is what makes them worth defining. A claim may switch one
 * off, and the switch is stored as the exception rather than as a list of what
 * is on: a new claim then inherits the arrangement the owner already has,
 * which is the answer that needs no work.
 */
export function enabledIn(claim, groupId) {
  return !(claim.disabledGroups ?? []).includes(groupId);
}

export function setEnabledIn(claim, groupId, on) {
  const off = new Set(claim.disabledGroups ?? []);
  if (on) off.delete(groupId);
  else off.add(groupId);
  claim.disabledGroups = [...off];
}

/**
 * The groups that decide anything for this member here.
 *
 * A group switched off on this claim is skipped, and so is one that has been
 * deleted since the member was added. Both are the same case to whoever is
 * standing at the gate: nothing granted it, so nothing grants it.
 */
export function activeGroups(claim, member, ownerId) {
  const groups = [];
  for (const groupId of member?.groups ?? []) {
    if (!enabledIn(claim, groupId)) continue;
    const group = groupById(ownerId, groupId);
    if (group) groups.push(group);
  }
  return groups;
}

/**
 * Where two sets of rules disagree.
 *
 * Returns the actions one grants and the other refuses. Anything either of
 * them is silent about cannot disagree — that is the whole reason the third
 * value exists.
 */
export function clashes(a, b) {
  const left = rulesOf(a);
  const right = rulesOf(b);
  return ACTIONS.filter(
    (action) =>
      typeof left[action] === "boolean" &&
      typeof right[action] === "boolean" &&
      left[action] !== right[action]
  );
}

/**
 * May this member join this group here, and if not, why not?
 *
 * The rule the owner asked for: a person may be in several groups, as long as
 * the groups do not contradict each other. This is checked when joining rather
 * than resolved when the gate is tested, and that is the important choice.
 *
 * The alternative is a precedence rule — deny wins, or the last group wins, or
 * the most specific wins — and every one of them is a rule the owner has to
 * hold in their head to predict what their own claim will do. Refusing the
 * combination puts the contradiction in front of them at the moment they
 * created it, named: "Builders lets them break blocks, Guests does not."
 *
 * Returns { ok: true } or { ok: false, group, actions }.
 */
export function mayJoin(claim, member, ownerId, group) {
  for (const existing of activeGroups(claim, member, ownerId)) {
    if (existing.id === group.id) continue;
    const actions = clashes(existing, group);
    if (actions.length) return { ok: false, group: existing, actions };
  }
  return { ok: true };
}

/** Enabling a dormant group must preserve the no-contradiction invariant. */
export function mayEnable(claim, ownerId, group) {
  for (const member of claim.members ?? []) {
    if (!member.groups?.includes(group.id)) continue;
    const verdict = mayJoin(claim, member, ownerId, group);
    if (!verdict.ok) return { ...verdict, member };
  }
  return { ok: true };
}

/**
 * The same test, run over an edited group against everyone already in it.
 *
 * Editing is how a contradiction gets in through the back door: two groups
 * that agreed when someone joined them can be made to disagree afterwards, and
 * the person is then in a combination that would have been refused. So the
 * edit is what gets refused, naming the member and the group it would fight
 * with.
 *
 * Returns { ok: true } or { ok: false, member, group, actions }.
 */
export function mayEdit(claims, ownerId, edited) {
  for (const claim of claims) {
    if (!enabledIn(claim, edited.id)) continue;
    for (const member of claim.members ?? []) {
      if (!member.groups?.includes(edited.id)) continue;
      for (const other of activeGroups(claim, member, ownerId)) {
        if (other.id === edited.id) continue;
        const actions = clashes(other, edited);
        if (actions.length) return { ok: false, member, group: other, actions };
      }
    }
  }
  return { ok: true };
}
