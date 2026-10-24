import { world } from "@minecraft/server";
import { subscribeSafe } from "./safe.js";
import { registerProtection } from "./protect.js";
import { registerDeed } from "./deed.js";
import { registerSelection } from "./selection.js";
import { registerWand } from "./wand.js";
import { registerPresence } from "./presence.js";

/*
 * Three pieces: the protection, which runs whether anyone is looking; the deed,
 * which is the only way a player reaches any of it; and the outline, which is
 * the only way a player sees where a claim actually ends.
 *
 * There is no command surface on purpose. `/scriptevent` needs cheats, and a
 * world with cheats on earns no achievements — asking for that in exchange for
 * a claim menu is a trade most players would not make, and on a Realm it is
 * not offered at all.
 */
registerProtection();
registerDeed();
registerSelection();
registerWand();
registerPresence();

subscribeSafe(world.afterEvents, "worldLoad", () => {
  console.warn("[Homestead] active");
});
