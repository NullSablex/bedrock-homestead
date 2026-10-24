import { PlayerPermissionLevel } from "@minecraft/server";

/** True only for Bedrock's native Operator role; Custom is deliberately out. */
export function isOperator(player) {
  try {
    return player.playerPermissionLevel === PlayerPermissionLevel.Operator;
  } catch {
    return false;
  }
}
