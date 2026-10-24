import { ACTIONS, GUEST_DEFAULTS } from "./actions.js";
import { activeGroups, rulesOf } from "./groups.js";
import { isOperator } from "./access.js";

/**
 * Turning what an owner arranged into a yes or a no at the gate.
 *
 * Three layers, in this order, and the order is the design:
 *
 *   1. what the claim allows anyone      (the guest rules)
 *   2. what this member's groups say     (the owner's arrangements)
 *   3. what was set for this person here (their own overrides)
 *
 * The guest rules are the FLOOR rather than a fallback for members: a person
 * you trusted should never be able to do less than a stranger by accident,
 * which is what a bare "everything off unless a group says otherwise" produces
 * the first time someone is added to no group at all.
 *
 * Groups may still refuse something the guest rules allow, and that is not a
 * contradiction — it is how you shut one particular person out of the doors
 * while the road through your land stays open to everybody else.
 *
 * Overrides come last and win outright. They are the answer to "this one
 * person, this one time", and the whole reason they exist is that no group
 * should have to be invented to describe one exception.
 */

/**
 * Reads a flag set that may be missing or half-written.
 *
 * Claims made before permissions existed carry no flags at all, and a member
 * added by an older version carries none either. Falling back to the defaults
 * rather than to `false` matters: the alternative is an update that silently
 * locks every trusted player out of every claim in the world.
 */
function flagsOf(source, defaults) {
  const flags = source ?? {};
  const answer = {};
  for (const action of ACTIONS) {
    answer[action] = typeof flags[action] === "boolean" ? flags[action] : defaults[action];
  }
  return answer;
}

export function guestFlags(claim) {
  return flagsOf(claim.guests, GUEST_DEFAULTS);
}

/**
 * The exceptions written for one person on one claim.
 *
 * `permissions` is what members carried before groups existed, and it is read
 * here as an override because that is exactly what it was: a full set of
 * yes-and-no for that person alone. Reading it rather than migrating it means
 * an existing world keeps working with nothing to run, and nobody's access
 * changes the moment the add-on updates.
 */
export function overridesOf(member) {
  const source = member?.overrides ?? member?.permissions ?? {};
  const overrides = {};
  for (const action of ACTIONS) {
    if (typeof source[action] === "boolean") overrides[action] = source[action];
  }
  return overrides;
}

/**
 * Everything that decides for this member, and what decided it.
 *
 * The reason it reports the SOURCE and not just the answer is the screen that
 * shows it. "May break blocks" is not useful on its own when the owner is
 * trying to work out why — the useful sentence is "because Builders says so",
 * and it can only be written by whoever resolved it.
 */
export function explainFlags(claim, member) {
  const guests = guestFlags(claim);
  const groups = activeGroups(claim, member, claim.ownerId);
  const overrides = overridesOf(member);

  const answer = {};
  for (const action of ACTIONS) {
    answer[action] = { allowed: guests[action], source: "guests", group: undefined };
  }

  /*
   * Groups cannot disagree with each other: joining is refused when they would
   * — see groups.js. So they are applied in whatever order they were added,
   * and the result does not depend on it. That property is worth more than it
   * looks; it is why there is no precedence rule to remember.
   */
  for (const group of groups) {
    const rules = rulesOf(group);
    for (const action of ACTIONS) {
      if (typeof rules[action] !== "boolean") continue;
      answer[action] = { allowed: rules[action], source: "group", group };
    }
  }

  for (const action of ACTIONS) {
    if (typeof overrides[action] !== "boolean") continue;
    answer[action] = { allowed: overrides[action], source: "override", group: undefined };
  }

  return answer;
}

/** The same resolution, as plain true/false per action. */
function memberFlags(claim, member) {
  const explained = explainFlags(claim, member);
  const flags = {};
  for (const action of ACTIONS) flags[action] = explained[action].allowed;
  return flags;
}

export function memberOf(claim, playerId) {
  return claim.members?.find((m) => m.id === playerId);
}

/**
 * May this player take this action here?
 *
 * The order is the interesting part. Visitor mode comes before everything,
 * including native operator access, because it exists to let one person be told no by
 * the same code that would tell a stranger no. Ownership comes before the
 * flags, because a claim that could lock out its own owner is a trap.
 */
export function may(claim, player, action, isVisitor) {
  if (!ACTIONS.includes(action)) return false;
  if (!claim) return true;
  if (isVisitor) return false;
  if (isOperator(player)) return true;
  if (claim.ownerId === player.id) return true;

  const member = memberOf(claim, player.id);
  if (member) return memberFlags(claim, member)[action];

  return guestFlags(claim)[action];
}
