import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";

const KEY = "homestead:settings";

export const LIMIT_BOUNDS = Object.freeze({
  maxClaims: { min: 1, max: 256 },
  blockBudget: { min: 25, max: 4194304 },
});

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

/** Effective world-wide limits. Invalid stored values fall back independently. */
export function protectionLimits() {
  let saved = {};
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
    }
  } catch (e) {
    console.warn("[Homestead] settings unreadable, using defaults: " + e);
  }

  const maxClaims = integer(saved.maxClaims);
  const blockBudget = integer(saved.blockBudget);
  return {
    maxClaims: maxClaims >= LIMIT_BOUNDS.maxClaims.min && maxClaims <= LIMIT_BOUNDS.maxClaims.max
      ? maxClaims : CONFIG.selection.maxClaims,
    blockBudget: blockBudget >= LIMIT_BOUNDS.blockBudget.min && blockBudget <= LIMIT_BOUNDS.blockBudget.max
      ? blockBudget : CONFIG.selection.blockBudget,
  };
}

/** Strict update: reject the whole pair if either value is invalid. */
export function saveProtectionLimits(maxClaimsValue, blockBudgetValue) {
  const maxClaims = integer(maxClaimsValue);
  const blockBudget = integer(blockBudgetValue);
  if (
    maxClaims === undefined || blockBudget === undefined ||
    maxClaims < LIMIT_BOUNDS.maxClaims.min || maxClaims > LIMIT_BOUNDS.maxClaims.max ||
    blockBudget < LIMIT_BOUNDS.blockBudget.min || blockBudget > LIMIT_BOUNDS.blockBudget.max
  ) return { ok: false, invalid: true };

  try {
    world.setDynamicProperty(KEY, JSON.stringify({ maxClaims, blockBudget }));
    return { ok: true, limits: { maxClaims, blockBudget } };
  } catch (e) {
    console.warn("[Homestead] could not write settings: " + e);
    return { ok: false, invalid: false };
  }
}
