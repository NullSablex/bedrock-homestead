#!/usr/bin/env node
/** Exhaustive and deterministic stress tests for Homestead's pure logic. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_ROOT = path.join(ROOT, "behavior_packs", "homestead", "scripts");
const properties = new Map();
const world = {
  getDynamicProperty(key) { return properties.get(key); },
  setDynamicProperty(key, value) {
    if (value === undefined) properties.delete(key);
    else properties.set(key, value);
  },
};

const context = vm.createContext({
  console,
  Date,
  JSON,
  Math,
  Map,
  Set,
  String,
  Object,
  Array,
  Boolean,
  Number,
  Infinity,
  globalThis: undefined,
  __world: world,
});
context.globalThis = context;

const modules = new Map();
async function moduleFor(identifier) {
  if (modules.has(identifier)) return modules.get(identifier);

  let source;
  if (identifier === "@minecraft/server") {
    source = `
      export const world = globalThis.__world;
      export const PlayerPermissionLevel = {
        Visitor: 0, Member: 1, Operator: 2, Custom: 3
      };
      export const CommandPermissionLevel = {
        Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4
      };
      export const system = {
        currentTick: 0,
        run(callback) { callback(); },
        runTimeout(callback) { callback(); },
        runInterval() { return 0; }
      };
    `;
  } else {
    source = fs.readFileSync(fileURLToPath(identifier), "utf8");
  }

  const mod = new vm.SourceTextModule(source, { context, identifier });
  modules.set(identifier, mod);
  await mod.link(async (specifier, referencing) => {
    if (specifier === "@minecraft/server") return moduleFor(specifier);
    if (specifier.startsWith("@minecraft/")) {
      throw new Error(`unexpected external module in logic test: ${specifier}`);
    }
    return moduleFor(new URL(specifier, referencing.identifier).href);
  });
  return mod;
}

async function load(name) {
  const identifier = pathToFileURL(path.join(SCRIPT_ROOT, name)).href;
  const mod = await moduleFor(identifier);
  if (mod.status !== "evaluated") await mod.evaluate();
  return mod.namespace;
}

const shape = await load("shape.js");
const actionsModule = await load("actions.js");
const groups = await load("groups.js");
const permissions = await load("permissions.js");
const claims = await load("claims.js");
const blocks = await load("blocks.js");
const config = await load("config.js");
const settings = await load("settings.js");
const selection = await load("selection.js");
const presence = await load("presence.js");
const projectiles = await load("projectiles.js");
const combat = await load("combat.js");
const publicPresets = await load("public_presets.js");
const ACTIONS = [...actionsModule.ACTIONS];
let checks = 0;
const check = (condition, message) => {
  checks++;
  assert.ok(condition, message);
};

function rectangles(min, max) {
  const result = [];
  for (let x1 = min; x1 <= max; x1++) for (let x2 = x1; x2 <= max; x2++) {
    for (let z1 = min; z1 <= max; z1++) for (let z2 = z1; z2 <= max; z2++) {
      result.push({ x1, x2, z1, z2 });
    }
  }
  return result;
}

// Every point near every small rectangle, including negative coordinates.
for (const rect of rectangles(-4, 4)) {
  const expectedArea = (rect.x2 - rect.x1 + 1) * (rect.z2 - rect.z1 + 1);
  check(shape.areaOf(rect) === expectedArea, "rectangle area mismatch");
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const expected = x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2;
    check(shape.contains(rect, x, z) === expected, "rectangle containment mismatch");
  }
}

// Pair every small rectangle at four configured gap sizes.
const small = rectangles(-2, 2);
for (const a of small) for (const b of small) for (let gap = 0; gap <= 3; gap++) {
  const expected = !(
    a.x2 + gap < b.x1 || a.x1 - gap > b.x2 ||
    a.z2 + gap < b.z1 || a.z1 - gap > b.z2
  );
  check(shape.conflicts(a, b, gap) === expected, "claim conflict mismatch");
  check(shape.conflicts(a, b, gap) === shape.conflicts(b, a, gap), "conflict is not symmetric");
}

// Polygon rectangles must agree block-for-block with their compact form.
for (const rect of rectangles(-3, 3)) {
  const polygon = {
    ...rect,
    points: [
      { x: rect.x1, z: rect.z1 }, { x: rect.x2, z: rect.z1 },
      { x: rect.x2, z: rect.z2 }, { x: rect.x1, z: rect.z2 },
    ],
  };
  check(shape.areaOf(polygon) === shape.areaOf(rect), "polygon rectangle area mismatch");
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    check(shape.contains(polygon, x, z) === shape.contains(rect, x, z), "polygon boundary mismatch");
  }
}

// Every ordering of four corners: crossed and degenerate rings are rejected.
function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest])
  );
}
const corners = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
for (const points of permutations(corners)) {
  const polygon = { x1: 0, x2: 4, z1: 0, z2: 4, points };
  const expected = Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0)) === 32;
  check(shape.isSimplePolygon(polygon) === expected, "crossed polygon validation mismatch");
}
check(!shape.isValidShape({ x1: 0, x2: NaN, z1: 0, z2: 4 }), "NaN shape accepted");
check(!shape.isValidShape({ x1: 5, x2: 0, z1: 0, z2: 4 }), "reversed shape accepted");
check(!shape.isValidShape({ x1: 0, x2: 5, z1: 0, z2: 4, points: corners }), "false polygon bounds accepted");

function maskFlags(mask) {
  return Object.fromEntries(ACTIONS.map((action, index) => [action, Boolean(mask & (1 << index))]));
}
function player(id, admin = false) {
  return {
    id,
    name: id,
    playerPermissionLevel: admin ? 2 : 1,
    commandPermissionLevel: admin ? 2 : 0,
    sendMessage() {},
  };
}

// Guest, owner, admin and visitor precedence for all 64 flag sets.
for (let mask = 0; mask < 1 << ACTIONS.length; mask++) {
  const claim = { ownerId: "owner", guests: maskFlags(mask), members: [] };
  for (let index = 0; index < ACTIONS.length; index++) {
    const action = ACTIONS[index];
    check(permissions.may(claim, player("guest"), action, false) === Boolean(mask & (1 << index)), "guest flag mismatch");
    check(permissions.may(claim, player("owner"), action, false), "owner denied");
    check(permissions.may(claim, player("admin", true), action, false), "admin denied");
    check(
      permissions.may(claim, player("owner", true), action, true) === Boolean(mask & (1 << index)),
      "visitor preview did not match public permissions"
    );
  }
}

// Visitor preview is scoped to the tester's own claims. It must not erase a
// real membership or operator access in somebody else's claim.
const previewingOwner = player("owner", true);
claims.setVisitor(previewingOwner, true);
const ownClosedClaim = { ownerId: "owner", guests: maskFlags(0), members: [] };
const otherClaim = {
  ownerId: "other",
  guests: maskFlags(0),
  members: [{ id: "owner", overrides: { enter: true } }],
};
check(!claims.mayDo(ownClosedClaim, previewingOwner, "enter"), "visitor preview retained owner bypass");
check(claims.mayDo(otherClaim, previewingOwner, "enter"), "visitor preview erased access to another claim");
claims.setVisitor(previewingOwner, false);
check(!permissions.may(undefined, player("admin", true), "unknown", false), "unknown action was allowed");
check(!permissions.may(
  { ownerId: "owner", guests: maskFlags(0), members: [] },
  { ...player("custom"), playerPermissionLevel: 3, commandPermissionLevel: 4 },
  "place",
  false
), "custom permissions were treated as operator");
check(permissions.may(
  { ownerId: "owner", guests: maskFlags(0), members: [] },
  { ...player("command-op"), commandPermissionLevel: 1 },
  "place",
  false
), "operator command permission fallback was ignored");
const throwingOperator = {
  ...player("throwing-op"),
  commandPermissionLevel: 2,
};
Object.defineProperty(throwingOperator, "playerPermissionLevel", {
  get() { throw new Error("player unavailable during permission read"); },
});
check(permissions.may(
  { ownerId: "owner", guests: maskFlags(0), members: [] },
  throwingOperator,
  "place",
  false
), "throwing player permission blocked a native operator");

// All 3^6 override combinations: inherit, allow, deny.
for (let encoded = 0; encoded < 3 ** ACTIONS.length; encoded++) {
  let value = encoded;
  const overrides = {};
  const expected = {};
  for (const action of ACTIONS) {
    const state = value % 3;
    value = Math.floor(value / 3);
    expected[action] = state === 0 ? false : state === 1;
    if (state > 0) overrides[action] = state === 1;
  }
  const member = { id: "member", groups: [], overrides };
  const claim = { ownerId: "owner", guests: maskFlags(0), members: [member] };
  for (const action of ACTIONS) {
    check(permissions.may(claim, player("member"), action, false) === expected[action], "override precedence mismatch");
  }
}

// Every pair of three-state group rule sets (over half a million pairs).
const ruleSets = [];
for (let encoded = 0; encoded < 3 ** ACTIONS.length; encoded++) {
  let value = encoded;
  const rules = {};
  for (const action of ACTIONS) {
    const state = value % 3;
    value = Math.floor(value / 3);
    if (state > 0) rules[action] = state === 1;
  }
  ruleSets.push(rules);
}
for (const left of ruleSets) for (const right of ruleSets) {
  const expected = ACTIONS.filter((action) =>
    typeof left[action] === "boolean" &&
    typeof right[action] === "boolean" &&
    left[action] !== right[action]
  );
  check(JSON.stringify([...groups.clashes({ rules: left }, { rules: right })]) === JSON.stringify(expected), "group clash mismatch");
}

// A disabled group cannot be enabled behind the conflict checker.
properties.clear();
properties.set("homestead:groups", JSON.stringify({ owner: [
  { id: "allow", name: "Allow", rules: { break: true } },
  { id: "deny", name: "Deny", rules: { break: false } },
] }));
const member = { id: "member", name: "Member", groups: ["allow", "deny"], overrides: {} };
const groupedClaim = { ownerId: "owner", members: [member], disabledGroups: ["deny"] };
const enableVerdict = groups.mayEnable(groupedClaim, "owner", groups.groupById("owner", "deny"));
check(!enableVerdict.ok && enableVerdict.actions.includes("break"), "conflicting group was enabled");

// Labels are bounded ASCII and format/control injection is removed.
check(groups.cleanGroupName("  Construção\n§cADMIN 😀  ") === "Construção cADMIN", "group label was not sanitized");
check(groups.cleanGroupName("x".repeat(100)).length === config.CONFIG.groups.maxNameLength, "group label limit failed");
properties.clear();
for (let i = 0; i < config.CONFIG.groups.maxPerOwner; i++) {
  check(Boolean(groups.createGroup("owner", `g${i}`, {})), "group rejected before limit");
}
check(groups.createGroup("owner", "one too many", {}) === undefined, "group limit bypassed");

// Administrative limits are atomic, bounded and persisted world-wide.
properties.clear();
check(settings.protectionLimits().maxClaims === config.CONFIG.selection.maxClaims, "default claim limit drifted");
check(!settings.saveProtectionLimits(0, 100).ok, "zero claim limit accepted");
check(!settings.saveProtectionLimits(10.5, 100).ok, "fractional claim limit accepted");
check(!settings.saveProtectionLimits(10, 24).ok, "undersized block budget accepted");
check(settings.saveProtectionLimits(3, 4096).ok, "valid administrative limits rejected");
check(settings.protectionLimits().maxClaims === 3, "claim limit was not persisted");
check(settings.protectionLimits().blockBudget === 4096, "block budget was not persisted");

// Claim size, budget, same-owner adjacency and other-owner gap boundaries.
properties.clear();
const owner = player("owner");
const other = player("other");
check(!claims.createClaim(owner, "minecraft:overworld", { x1: 0, x2: 3, z1: 0, z2: 4 }).ok, "undersized claim accepted");
check(!claims.createClaim(owner, "minecraft:overworld", { x1: 0, x2: 128, z1: 0, z2: 4 }).ok, "oversized claim accepted");
const firstClaim = claims.createClaim(owner, "minecraft:overworld", { x1: 0, x2: 4, z1: 0, z2: 4 });
check(firstClaim.ok && firstClaim.claim.name === "Area 1", "valid named claim rejected");
check(claims.cleanClaimName("  Casa da Vovó\n§cADMIN 😀  ") === "Casa da Vovó cADMIN", "claim name was not sanitized");
check(!claims.claimNameAvailable(owner.id, "area 1"), "duplicate claim name was accepted");
check(!claims.createClaim(owner, "minecraft:overworld", { x1: 30, x2: 34, z1: 0, z2: 4 }, "AREA 1").ok, "duplicate name bypassed creation");
check(claims.createClaim(owner, "minecraft:overworld", { x1: 5, x2: 9, z1: 0, z2: 4 }).ok, "adjacent own claim rejected");
check(!claims.createClaim(other, "minecraft:overworld", { x1: 12, x2: 16, z1: 0, z2: 4 }).ok, "other owner bypassed gap");
check(claims.createClaim(other, "minecraft:overworld", { x1: 18, x2: 22, z1: 0, z2: 4 }).ok, "valid separated claim rejected");

// Boundary edits obey the same contract as creation and commit only after the
// complete replacement is valid.
const editedFirst = claims.reshapeClaim(owner, firstClaim.claim.id, "minecraft:overworld", {
  x1: 0, x2: 4, z1: 0, z2: 5,
});
check(editedFirst.ok, "valid boundary edit was rejected");
check(editedFirst.claim.name === firstClaim.claim.name, "boundary edit changed claim metadata");
const beforeRejectedEdit = properties.get("homestead:areas");
check(!claims.reshapeClaim(owner, firstClaim.claim.id, "minecraft:overworld", {
  x1: 0, x2: 5, z1: 0, z2: 4,
}).ok, "boundary edit overlapped an adjacent own claim");
check(properties.get("homestead:areas") === beforeRejectedEdit, "rejected overlap changed the registry");
check(!claims.reshapeClaim(other, firstClaim.claim.id, "minecraft:overworld", {
  x1: 0, x2: 4, z1: 0, z2: 4,
}).ok, "non-owner reshaped another player's claim");
check(properties.get("homestead:areas") === beforeRejectedEdit, "denied edit changed the registry");
check(settings.saveProtectionLimits(3, 55).ok, "edit budget test limit was rejected");
check(!claims.reshapeClaim(owner, firstClaim.claim.id, "minecraft:overworld", {
  x1: 0, x2: 4, z1: 0, z2: 6,
}).ok, "boundary edit bypassed the owner's block budget");
check(properties.get("homestead:areas") === beforeRejectedEdit, "over-budget edit changed the registry");
check(settings.saveProtectionLimits(3, 40).ok, "lowered edit budget test limit was rejected");
check(claims.reshapeClaim(owner, firstClaim.claim.id, "minecraft:overworld", {
  x1: 0, x2: 4, z1: 0, z2: 4,
}).ok, "over-budget owner could not shrink an existing claim");

// Use-on mutations that bypass ordinary block placement, plus every face.
const mutationCases = new Map([
  ["minecraft:bucket", "break"], ["minecraft:shears", "break"],
  ["minecraft:water_bucket", "place"], ["minecraft:lava_bucket", "place"],
  ["minecraft:milk_bucket", undefined], ["minecraft:end_crystal", "place"],
  ["minecraft:zombie_spawn_egg", "place"], ["minecraft:oak_boat", "place"],
  ["minecraft:bamboo_raft", "place"], ["minecraft:chest_minecart", "place"],
  ["minecraft:item_frame", "place"], ["minecraft:flint_and_steel", "place"],
  ["minecraft:diamond_axe", "break"], ["minecraft:wooden_shovel", "break"],
  ["minecraft:netherite_hoe", "break"], ["minecraft:brush", "break"],
  ["minecraft:honeycomb", "break"], ["minecraft:bone_meal", "use"],
  ["minecraft:glass_bottle", "use"], ["minecraft:glow_ink_sac", "use"],
  ["minecraft:ender_eye", "use"], ["minecraft:diamond", undefined],
]);
for (const [id, expected] of mutationCases) {
  check(blocks.itemMutationAction({ typeId: id }) === expected, `wrong mutation action for ${id}`);
}
const origin = { x: 10, y: 20, z: 30 };
const faces = { Up: [10, 21, 30], Down: [10, 19, 30], North: [10, 20, 29], South: [10, 20, 31], East: [11, 20, 30], West: [9, 20, 30] };
for (const [face, expected] of Object.entries(faces)) {
  const actual = blocks.adjacentLocation(origin, face);
  check(actual.x === expected[0] && actual.y === expected[1] && actual.z === expected[2], `wrong ${face} face`);
}

// Markers never replace real blocks and failed placement creates no phantom
// corner. A valid air placement is still reversible.
function fakeDimension(defaultType = "minecraft:stone") {
  const types = new Map();
  const entities = [];
  const key = ({ x, y, z }) => `${x},${y},${z}`;
  const dimension = {
    id: "minecraft:overworld",
    getBlock(location) {
      const at = { x: location.x, y: location.y, z: location.z };
      const blockKey = key(at);
      return {
        get typeId() { return types.get(blockKey) ?? defaultType; },
        get isAir() { return this.typeId === "minecraft:air"; },
        get permutation() { return { typeId: this.typeId }; },
        setType(typeId) { types.set(blockKey, typeId); },
        setPermutation(permutation) { types.set(blockKey, permutation.typeId); },
      };
    },
    spawnEntity(typeId, location) {
      const entity = {
        typeId, location, nameTag: "", tags: [], isValid: true,
        addTag(tag) { this.tags.push(tag); },
        remove() { this.isValid = false; },
      };
      entities.push(entity);
      return entity;
    },
    getEntities() { return entities.filter((entity) => entity.isValid !== false); },
    types,
    entities,
  };
  return dimension;
}
const blockedDimension = fakeDimension();
world.getDimension = () => blockedDimension;
properties.clear();
const blockedPlayer = { id: "blocked", dimension: blockedDimension, hasTag: () => false };
const blockedMark = selection.markCorner(blockedPlayer, { x: 0, y: 10, z: 0 });
check(!blockedMark.marked && selection.cornersOf(blockedPlayer).length === 0, "blocked marker created a phantom corner");
check(blockedDimension.getBlock({ x: 0, y: 10, z: 0 }).typeId === "minecraft:stone", "marker replaced the clicked block");

const openDimension = fakeDimension();
openDimension.types.set("0,11,0", "minecraft:air");
world.getDimension = () => openDimension;
const openPlayer = { id: "open", dimension: openDimension, hasTag: () => false };
check(selection.markCorner(openPlayer, { x: 0, y: 10, z: 0 }).marked, "marker refused free air");
check(openDimension.getBlock({ x: 0, y: 11, z: 0 }).typeId === config.CONFIG.selection.marker.postBlock, "marker block missing");
check(openDimension.entities[0]?.nameTag === "§ePonto 1", "marker label missing or misnumbered");
check(openDimension.entities[0]?.nameplateRenderDistance === 96, "marker label render distance missing");
check(openDimension.entities[0]?.nameplateDepthTested === false, "marker label is hidden by depth testing");
selection.clearSelection(openPlayer);
check(openDimension.getBlock({ x: 0, y: 11, z: 0 }).typeId === "minecraft:air", "marker cleanup did not restore air");
check(!openDimension.entities[0]?.isValid, "marker label was not removed");

// Existing boundaries load into a reversible edit session. Clearing every
// point keeps the target attached so it can be redrawn rather than recreated.
properties.clear();
const editDimension = fakeDimension("minecraft:air");
editDimension.types.set("0,10,0", "minecraft:stone");
editDimension.types.set("4,10,4", "minecraft:stone");
const editPlayer = {
  id: "editor", name: "editor", dimension: editDimension,
  hasTag: () => false,
};
const editable = {
  id: "editable", ownerId: editPlayer.id, ownerName: editPlayer.name,
  dimension: editDimension.id, x1: 0, x2: 4, z1: 0, z2: 4,
  heightMode: "full", members: [], guests: maskFlags(0),
};
properties.set("homestead:areas", JSON.stringify([editable]));
world.getDimension = () => editDimension;
check(selection.loadClaimSelection(editPlayer, editable), "existing boundary did not load for editing");
check(selection.editingClaimId(editPlayer) === editable.id, "edit target was not attached to selection");
check(selection.cornersOf(editPlayer).length === 2, "existing rectangle did not load both corners");
selection.clearMarkedCorners(editPlayer);
check(selection.cornersOf(editPlayer).length === 0, "edit markers were not cleared");
check(selection.editingClaimId(editPlayer) === editable.id, "clearing edit markers lost the target claim");
selection.clearSelection(editPlayer);

// Replacing vertices of an edited polygon preserves their original order;
// appending them would silently reconnect different walls.
const polygonPoints = [
  { x: 0, z: 0 }, { x: 0, z: 4 },
  { x: 4, z: 4 }, { x: 4, z: 0 },
];
for (const point of polygonPoints) {
  editDimension.types.set(`${point.x},10,${point.z}`, "minecraft:stone");
}
const editablePolygon = {
  ...editable,
  id: "editable-polygon",
  points: polygonPoints,
};
properties.set("homestead:areas", JSON.stringify([editablePolygon]));
check(selection.loadClaimSelection(editPlayer, editablePolygon), "polygon boundary did not load for editing");
selection.clearCorner(editPlayer, 1);
const invalidVertex = selection.markCorner(editPlayer, { x: 1, y: 10, z: 4 });
check(invalidVertex.invalidReplacement === true, "invalid replacement walls were accepted");
check(selection.cornersOf(editPlayer).length === 3, "invalid replacement changed polygon points");
selection.clearCorner(editPlayer, 2);
check(selection.markCorner(editPlayer, { x: 0, y: 10, z: 4 }).marked, "first polygon vertex was not replaced");
check(selection.markCorner(editPlayer, { x: 4, y: 10, z: 0 }).marked, "second polygon vertex was not replaced");
check(
  JSON.stringify(selection.cornersOf(editPlayer).map(({ x, z }) => ({ x, z }))) === JSON.stringify(polygonPoints),
  "polygon replacements changed vertex order"
);
selection.clearSelection(editPlayer);

properties.set("homestead:areas", JSON.stringify([{
  id: "protected", ownerId: "owner", ownerName: "Owner",
  dimension: "minecraft:overworld", x1: 0, x2: 4, z1: 0, z2: 4,
  heightMode: "full", members: [], guests: maskFlags(0),
}]));
const deniedDimension = fakeDimension();
deniedDimension.types.set("0,11,0", "minecraft:air");
world.getDimension = () => deniedDimension;
const deniedPlayer = { id: "intruder", dimension: deniedDimension, hasTag: () => false };
const deniedMark = selection.markCorner(deniedPlayer, { x: 0, y: 10, z: 0 });
check(deniedMark.denied?.id === "protected", "marker bypassed claim placement permission");
check(selection.cornersOf(deniedPlayer).length === 0, "denied marker changed selection state");
check(deniedDimension.getBlock({ x: 0, y: 11, z: 0 }).typeId === "minecraft:air", "denied marker changed the world");

// Creature enforcement follows loaded entities, not the owner's proximity.
// Negative coordinates also exercise floor-based Bedrock chunk indexing.
properties.set("homestead:areas", JSON.stringify([{
  id: "remote", ownerId: "owner", ownerName: "Owner",
  dimension: "minecraft:overworld", x1: -20, x2: -16, z1: -20, z2: -16,
  heightMode: "full", members: [], guests: maskFlags(0),
  mobs: { hostile: { spawn: false, enter: false } },
}]));
const remoteDimension = fakeDimension();
const remoteMonster = {
  typeId: "minecraft:zombie",
  location: { x: -18, y: 64, z: -18 },
  isValid: true,
  matches(query) { return query.families?.includes("monster"); },
  getComponent() { return undefined; },
  teleport(location) { this.location = { ...location }; this.teleported = true; },
};
remoteMonster.dimension = remoteDimension;
remoteDimension.entities.push(remoteMonster);
world.getDimension = (id) => {
  check(id === "minecraft:overworld", "creature patrol queried the wrong dimension");
  return remoteDimension;
};
presence.patrolCreatures();
check(remoteMonster.teleported === true, "loaded creature was ignored without a nearby owner");
check(remoteMonster.location.x === -21.5, "loaded creature was not moved through the nearest boundary");

// Public claims belong to the server identity, require a native operator and
// do not consume any individual player's count or block budget.
properties.clear();
check(!claims.createClaim(
  player("member"), "minecraft:overworld",
  { x1: 0, x2: 4, z1: 0, z2: 4 }, undefined, { public: true }
).ok, "non-operator created a public claim");
const publicOperator = player("operator", true);
const publicResult = claims.createClaim(
  publicOperator, "minecraft:overworld",
  { x1: 0, x2: 4, z1: 0, z2: 4 }, "Spawn", { public: true }
);
check(publicResult.ok, "operator could not create a public claim");
check(claims.isPublicClaim(publicResult.claim), "public claim lost its server ownership marker");
check(claims.claimsOf(publicOperator.id).length === 0, "public claim consumed the operator's personal limit");
check(claims.mayManage(publicResult.claim, player("second-operator", true)), "second operator cannot manage public claim");

for (const id of publicPresets.PUBLIC_PRESET_IDS) {
  const configured = publicPresets.withPublicPreset(publicResult.claim, id);
  check(configured !== publicResult.claim, `public preset ${id} mutated its input`);
  check(configured.guests.place === false && configured.guests.break === false, `public preset ${id} opened construction`);
}
const safePreset = publicPresets.withPublicPreset(publicResult.claim, "safe");
check(safePreset.combat.allowPvp === false, "safe preset enabled PvP");
const arenaPreset = publicPresets.withPublicPreset(publicResult.claim, "arena");
check(arenaPreset.combat.allowPvp === true, "arena preset did not enable PvP");
check(publicPresets.withPublicPreset(publicResult.claim, "missing") === undefined, "unknown public preset was accepted");

// Public land may touch the creating operator's private land, but may neither
// overlap it nor bypass the safety gap around another player's claim.
properties.clear();
check(claims.createClaim(
  publicOperator, "minecraft:overworld", { x1: 0, x2: 4, z1: 0, z2: 4 }, "Private"
).ok, "operator private setup claim failed");
check(claims.createClaim(
  publicOperator, "minecraft:overworld", { x1: 5, x2: 9, z1: 0, z2: 4 }, "Public", { public: true }
).ok, "public claim could not touch its creator's private claim");
check(!claims.createClaim(
  publicOperator, "minecraft:overworld", { x1: 4, x2: 8, z1: 0, z2: 4 }, "Overlap", { public: true }
).ok, "public claim overlapped its creator's private claim");
properties.clear();
check(claims.createClaim(
  player("neighbor"), "minecraft:overworld", { x1: 0, x2: 4, z1: 0, z2: 4 }, "Neighbor"
).ok, "neighbor setup claim failed");
check(!claims.createClaim(
  publicOperator, "minecraft:overworld", { x1: 5, x2: 9, z1: 0, z2: 4 }, "Too close", { public: true }
).ok, "public claim bypassed another player's safety gap");

// Incoming projectiles preserve speed and vertical motion while reflecting
// the horizontal component at the crossed wall.
const reflected = projectiles.reflectIncoming(
  { x1: 0, x2: 4, z1: 0, z2: 4 },
  { x: -0.25, y: 65, z: 2.5 },
  { x: 0.25, y: 65, z: 2.5 },
  { x: 1.5, y: -0.1, z: 0.25 }
);
check(reflected?.velocity.x === -1.5, "projectile did not reflect from the west boundary");
check(reflected?.velocity.y === -0.1, "projectile reflection changed vertical speed");
check(reflected?.velocity.z === 0.25, "projectile reflection changed tangential speed");
const fastReflected = projectiles.reflectIncoming(
  { x1: 0, x2: 4, z1: 0, z2: 4 },
  { x: -1, y: 65, z: 2 }, { x: 6, y: 65, z: 2 }, { x: 7, y: 0, z: 0 }
);
check(fastReflected?.velocity.x === -7, "fast projectile tunneled through the whole claim");
check(projectiles.reflectIncoming(
  { x1: 0, x2: 4, z1: 0, z2: 4 },
  { x: 1, y: 65, z: 1 }, { x: 2, y: 65, z: 2 }, { x: 1, y: 0, z: 1 }
) === undefined, "projectile born inside was reflected");

// No-PvP is exclusive to public claims and recognizes both direct attacks and
// the player who owns a damaging projectile.
const victim = { typeId: "minecraft:player" };
const attacker = { typeId: "minecraft:player" };
check(combat.isBlockedPublicPvp(publicResult.claim, victim, { damagingEntity: attacker }), "public melee PvP was allowed");
const arrow = {
  typeId: "minecraft:arrow",
  getComponent(id) { return id === "minecraft:projectile" ? { owner: attacker } : undefined; },
};
check(combat.isBlockedPublicPvp(publicResult.claim, victim, { damagingProjectile: arrow }), "public projectile PvP was allowed");
check(!combat.isBlockedPublicPvp(
  { ...publicResult.claim, public: false, ownerId: "owner" }, victim, { damagingEntity: attacker }
), "private claim unexpectedly disabled PvP");
check(!combat.isBlockedPublicPvp(
  { ...publicResult.claim, combat: { allowPvp: true } }, victim, { damagingEntity: attacker }
), "enabled public PvP was still blocked");

console.log(`stress: ${checks.toLocaleString("en-US")} checks passed`);
