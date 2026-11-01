import { CommandPermissionLevel, PlayerPermissionLevel } from "@minecraft/server";

/**
 * True only for Bedrock's native operator authority.
 *
 * `playerPermissionLevel` is the clearest signal, but Bedrock documents that
 * reading it may throw and some hosts briefly expose a stale Member value when
 * the player joins. `commandPermissionLevel` independently reports whether the
 * player has Operator Commands, so it is a safe fallback for that case.
 *
 * Custom is rejected before the fallback. A player with individually adjusted
 * permissions must never acquire Homestead administration by accident.
 */
export function isOperator(player) {
  let playerLevel;
  try {
    playerLevel = player.playerPermissionLevel;
  } catch { /* use the independent command-permission signal below */ }

  if (playerLevel === PlayerPermissionLevel.Custom) return false;
  if (playerLevel === PlayerPermissionLevel.Operator) return true;

  try {
    return player.commandPermissionLevel >= CommandPermissionLevel.GameDirectors;
  } catch { return false; }
}
