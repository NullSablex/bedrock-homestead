/**
 * What someone may do inside a claim.
 *
 * Six answers rather than one, because "trusted" was doing too much work. A
 * neighbour you let through the gate is not a neighbour you let into the
 * chests, and the person who feeds your furnaces has no business rebuilding
 * your walls. One flag for all of it forced every decision to the loosest one
 * anybody needed.
 *
 * The split follows what a player can tell apart on sight, not what the API
 * happens to report:
 *
 *   enter       being inside the boundary at all
 *   doors       doors, trapdoors, gates, buttons, levers — things that move
 *   containers  chests, barrels, hoppers — things that hold what is yours
 *   use         furnaces, brewing stands, anvils — things that work for you
 *   place       putting blocks down
 *   break       taking blocks away
 *
 * `use` and `containers` are deliberately not the same permission. A furnace
 * that smelts is a tool; a chest is where belongings live. Letting a builder
 * run the furnaces without handing them the storage is the ordinary case, and
 * a single "interact" flag cannot express it.
 *
 * This list lives in a file of its own, with no imports, because both the
 * permission resolver and the group library need it and importing one from the
 * other would close a cycle — which the Bedrock script engine is a bad place
 * to discover.
 */
export const ACTIONS = ["enter", "doors", "containers", "use", "place", "break"];

/**
 * What a stranger may do. Everything shut but the gate, because a claim that
 * refuses entry by default fences off the world rather than a home.
 */
export const GUEST_DEFAULTS = {
  enter: true,
  doors: false,
  containers: false,
  use: false,
  place: false,
  break: false,
};

/** Everything, for whoever is handed the run of the place. */
export const MEMBER_DEFAULTS = {
  enter: true,
  doors: true,
  containers: true,
  use: true,
  place: true,
  break: true,
};
