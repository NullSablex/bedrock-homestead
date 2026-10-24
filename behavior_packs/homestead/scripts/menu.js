import { system, world } from "@minecraft/server";
import {
  CustomForm, ObservableBoolean, ObservableNumber, ObservableString,
} from "@minecraft/server-ui";
import { CONFIG } from "./config.js";
import {
  allClaims, claimsOf, claimAt, rectAround, usedBlocks,
  createClaim, removeClaim, updateClaim, applyTrust, mayBuild, mayManage,
  isVisitor, setVisitor, cleanClaimName, claimNameAvailable,
} from "./claims.js";
import {
  clearSelection, clearCorner, cornersOf, hasCorners,
  selectedShape, canClose, closePath,
} from "./selection.js";
import {
  giveWand, hasWand, putWandAway, removeWand, setMarkingScreen,
} from "./wand.js";
import { subscriptionFailures } from "./safe.js";
import { sizeOf, areaOf } from "./shape.js";
import { ACTIONS } from "./actions.js";
import { mobRules, MOB_KINDS } from "./mobs.js";
import {
  guestFlags, explainFlags, overridesOf, memberOf,
} from "./permissions.js";
import {
  groupsOf, createGroup, saveGroup, deleteGroup, rulesOf,
  enabledIn, setEnabledIn, activeGroups, mayJoin, mayEdit, mayEnable,
  cleanGroupName,
} from "./groups.js";
import { t, join, raw } from "./msg.js";
import { protectionLimits, saveProtectionLimits, LIMIT_BOUNDS } from "./settings.js";
import { isOperator } from "./access.js";

/**
 * The menu is built with DDUI CustomForm rather than the old static forms.
 *
 * The important difference is not decoration. Buttons own their callbacks,
 * settings own their values, and a screen can say only what is useful at that
 * moment. That keeps navigation short and removes the explanatory paragraphs
 * that had turned ordinary actions into documentation pages.
 */

const WRITABLE = { clientWritable: true };
const PERMISSION_KEYS = {
  enter: "homestead.ui.perm.enter",
  doors: "homestead.ui.perm.doors",
  containers: "homestead.ui.perm.containers",
  use: "homestead.ui.perm.use",
  place: "homestead.ui.perm.place",
  break: "homestead.ui.perm.break",
};
const MOB_KEYS = {
  hostile: "homestead.ui.mobs.hostile",
  animals: "homestead.ui.mobs.animals",
  villagers: "homestead.ui.mobs.villagers",
};

function close(form) {
  try {
    if (form.isShowing()) form.close();
  } catch { /* already closed by the player */ }
}

/** Close first, then navigate on the next tick so two DDUI screens never race. */
function go(form, action) {
  close(form);
  system.run(action);
}

function addButton(form, label, action) {
  form.button(label, () => go(form, action));
}

/** A failed open is normally the use button still being held; retry briefly. */
function show(form, attempt = 0) {
  form.show().catch(() => {
    if (attempt >= CONFIG.menu.retries) return;
    system.runTimeout(() => show(form, attempt + 1), CONFIG.menu.retryTicks);
  });
}

/** Small navigation screen: one status line, then actions. */
function present(player, title, status, actions, closable = false) {
  const form = new CustomForm(player, title);
  if (status) form.label(status).divider();
  for (const action of actions) addButton(form, action.label, action.run);
  if (closable) form.closeButton();
  show(form);
}

function bool(value) {
  return new ObservableBoolean(Boolean(value), WRITABLE);
}

function number(value = 0) {
  return new ObservableNumber(value, WRITABLE);
}

function text(value = "") {
  return new ObservableString(value, WRITABLE);
}

function choices(labels) {
  return labels.map((label, value) => ({ label, value }));
}

function claimName(claim) {
  const name = cleanClaimName(claim.name);
  const automatic = /^Area ([1-9][0-9]*)$/.exec(name);
  if (automatic) return t("homestead.claim.default", automatic[1]);
  return name ? raw(name) : t("homestead.claim.unnamed", `${claim.x1}, ${claim.z1}`);
}

function dimensionName(dimensionId) {
  const name = {
    "minecraft:overworld": "Overworld",
    "minecraft:nether": "Nether",
    "minecraft:the_end": "The End",
  }[dimensionId] ?? String(dimensionId).replace("minecraft:", "");
  return raw(name);
}

function saveButton(form, onSave) {
  addButton(form, t("homestead.ui.rules.save"), onSave);
}

function backButton(form, back) {
  addButton(form, t("homestead.ui.back"), back);
}

function whereAmI(player, here) {
  if (!here) return CONFIG.quickClaim
    ? join(t("homestead.ui.body.free"), raw(" "), t("homestead.ui.body.free.size", CONFIG.quickSize, CONFIG.quickSize))
    : t("homestead.ui.body.free");

  if (here.ownerId === player.id) return t("homestead.ui.body.mine", claimName(here));
  return join(
    t("homestead.ui.body.other", claimName(here), here.ownerName),
    raw(" "),
    mayBuild(here, player) ? t("homestead.ui.build.allowed") : t("homestead.ui.build.blocked")
  );
}

export function showMenu(player) {
  const here = claimAt(player.dimension.id, player.location);
  const shape = selectedShape(player);
  const marked = hasCorners(player);
  const marking = marked || hasWand(player);
  const actions = [];

  actions.push({
    label: marking ? t("homestead.ui.wand.resume") : t("homestead.ui.wand.start"),
    run: () => {
      giveWand(player);
      if (marking) showMarking(player);
    },
  });

  if (!here && !marked && CONFIG.quickClaim) {
    actions.push({ label: t("homestead.ui.claim.here"), run: () => claimHere(player) });
  }

  if (here && mayManage(here, player)) {
    actions.push({ label: t("homestead.ui.manage.here"), run: () => showClaim(player, here) });
  }

  if (shape) {
    actions.push({ label: t("homestead.ui.select.confirm"), run: () => confirmSelection(player, shape) });
  }

  actions.push({ label: t("homestead.ui.mine.title"), run: () => showMyClaims(player) });
  if (isOperator(player)) {
    actions.push({ label: t("homestead.ui.admin.title"), run: () => showAdmin(player) });
  }
  actions.push({ label: t("homestead.ui.status.title"), run: () => showStatus(player) });
  actions.push({ label: t("homestead.credits.title"), run: () => showCredits(player) });

  present(
    player,
    t("homestead.ui.title"),
    marked ? markedStatus(player, shape) : whereAmI(player, here),
    actions,
    true
  );
}

function claimHere(player) {
  const result = createClaim(player, player.dimension.id, rectAround(player.location));
  if (!result.ok) return player.sendMessage(result.message);
  const c = result.claim;
  player.sendMessage(t("homestead.claim.created", claimName(c), `${c.x1}, ${c.z1}`, `${c.x2}, ${c.z2}`));
  player.sendMessage(t("homestead.claim.created.hint"));
}

function markedStatus(player, shape) {
  if (!shape) return t("homestead.ui.select.second");
  const { width, depth } = sizeOf(shape);
  return t("homestead.ui.select.size", `${width}x${depth}`, areaOf(shape));
}

function confirmSelection(player, shape) {
  const result = createClaim(player, player.dimension.id, shape);
  if (!result.ok) return player.sendMessage(result.message);

  clearSelection(player);
  removeWand(player);
  const c = result.claim;
  player.sendMessage(t("homestead.claim.created", claimName(c), `${c.x1}, ${c.z1}`, `${c.x2}, ${c.z2}`));
  player.sendMessage(t("homestead.claim.created.hint"));
}

export function showMarking(player) {
  const corners = cornersOf(player);
  const shape = selectedShape(player);
  const walls = Math.max(0, corners.length - 1);
  const status = shape
    ? markedStatus(player, shape)
    : corners.length === 0
      ? t("homestead.ui.wand.body.none")
      : corners.length === 1
        ? t("homestead.ui.wand.body.short", 1)
        : t("homestead.ui.wand.body.open", walls);

  const actions = [];
  if (shape) actions.push({
    label: t("homestead.ui.select.confirm"),
    run: () => confirmSelection(player, shape),
  });

  if (canClose(player)) actions.push({
    label: t("homestead.ui.wand.close"),
    run: () => {
      const { closed, turned } = closePath(player);
      if (!closed) {
        player.sendMessage(t("homestead.select.nomarker"));
        return showMarking(player);
      }
      if (turned) player.sendMessage(t("homestead.select.turned"));
      player.sendMessage(t("homestead.select.closed", cornersOf(player).length));
      showMarking(player);
    },
  });

  corners.forEach((corner, index) => actions.push({
    label: t("homestead.ui.wand.clear.one", index + 1, `${corner.x}, ${corner.z}`),
    run: () => {
      clearCorner(player, index);
      showMarking(player);
    },
  }));

  if (corners.length > 1) actions.push({
    label: t("homestead.ui.wand.clear.all"),
    run: () => {
      clearSelection(player);
      player.sendMessage(t("homestead.select.cleared"));
      showMarking(player);
    },
  });

  actions.push({ label: t("homestead.ui.wand.putaway"), run: () => putWandAway(player) });
  present(player, t("homestead.ui.wand.title"), status, actions, true);
}

function claimButton(claim) {
  return cleanClaimName(claim.name)
    ? claimName(claim)
    : raw(`${claim.x1}, ${claim.z1}`);
}

/** Re-check authority when an administrative screen is entered. */
function canManageNow(player, claim) {
  if (mayManage(claim, player)) return true;
  player.sendMessage(t("homestead.manage.denied"));
  showMenu(player);
  return false;
}

function showMyClaims(player) {
  const mine = claimsOf(player.id);
  const limits = protectionLimits();
  const status = mine.length
    ? t(
      "homestead.ui.mine.summary",
      mine.length,
      limits.maxClaims,
      usedBlocks(player.id),
      limits.blockBudget
    )
    : t("homestead.ui.mine.empty");

  const actions = mine.map((claim) => ({
    label: claimButton(claim),
    run: () => showClaim(player, claim),
  }));
  actions.push({ label: t("homestead.ui.back"), run: () => showMenu(player) });
  present(player, t("homestead.ui.mine.title"), status, actions);
}

function showClaim(player, claim) {
  if (!canManageNow(player, claim)) return;
  const { width, depth } = sizeOf(claim);
  const rules = mobRules(claim);
  const refused = MOB_KINDS.filter((kind) => !rules[kind].spawn || !rules[kind].enter).length;
  const open = ACTIONS.filter((action) => guestFlags(claim)[action]).length;
  const status = join(
    dimensionName(claim.dimension),
    raw("\n"),
    t("homestead.info.bounds", `${claim.x1}, ${claim.z1}`, `${claim.x2}, ${claim.z2}`),
    raw("\n"),
    t("homestead.info.size.short", `${width}x${depth}`)
  );

  present(player, claimName(claim), status, [
    { label: t("homestead.ui.claim.rename"), run: () => showRenameClaim(player, claim) },
    { label: join(t("homestead.ui.people.title"), raw(` (${claim.members.length})`)), run: () => showPeople(player, claim) },
    { label: join(t("homestead.ui.rules.title"), raw(` (${open}/${ACTIONS.length})`)), run: () => showClaimRules(player, claim) },
    {
      label: refused
        ? join(t("homestead.ui.mobs.title"), raw(` (${refused})`))
        : t("homestead.ui.mobs.title"),
      run: () => showMobRules(player, claim),
    },
    { label: join(t("homestead.ui.groups.title"), raw(` (${groupsOf(claim.ownerId).length})`)), run: () => showGroups(player, claim) },
    { label: t("homestead.ui.remove.title"), run: () => confirmRemoval(player, claim) },
    { label: t("homestead.ui.back"), run: () => showMyClaims(player) },
  ]);
}

function showRenameClaim(player, claim) {
  const name = text(cleanClaimName(claim.name));
  const form = new CustomForm(player, t("homestead.ui.claim.rename"));
  form.textField(t("homestead.ui.claim.name"), name, {
    description: t("homestead.ui.claim.name.hint"),
  });
  form.divider();
  saveButton(form, () => {
    if (!canManageNow(player, claim)) return;
    const saved = cleanClaimName(name.getData());
    if (!saved) {
      player.sendMessage(t("homestead.claim.name.empty"));
      return showRenameClaim(player, claim);
    }
    if (!claimNameAvailable(claim.ownerId, saved, claim.id)) {
      player.sendMessage(t("homestead.claim.name.used"));
      return showRenameClaim(player, claim);
    }
    const previous = claim.name;
    claim.name = saved;
    if (!updateClaim(claim)) {
      claim.name = previous;
      player.sendMessage(t("homestead.storage.failed"));
      return showClaim(player, claim);
    }
    player.sendMessage(t("homestead.claim.name.saved", saved));
    showClaim(player, claim);
  });
  backButton(form, () => showClaim(player, claim));
  show(form);
}

function showPeople(player, claim) {
  const actions = [{ label: t("homestead.ui.trust.title"), run: () => showTrust(player, claim) }];
  for (const member of claim.members) {
    const names = activeGroups(claim, member, claim.ownerId).map((group) => group.name);
    actions.push({
      label: raw(names.length ? `${member.name} (${names.join(", ")})` : member.name),
      run: () => showMemberRules(player, claim, member),
    });
  }
  actions.push({ label: t("homestead.ui.back"), run: () => showClaim(player, claim) });
  present(
    player,
    t("homestead.ui.people.title"),
    claim.members.length ? undefined : t("homestead.ui.people.empty"),
    actions
  );
}

function resolveTarget(member) {
  return world.getPlayers().find((player) => player.id === member.id) ?? {
    id: member.id,
    name: member.name,
    sendMessage: () => {},
  };
}

function showStatus(player) {
  const failures = subscriptionFailures();
  const visiting = isVisitor(player);
  const form = new CustomForm(player, t("homestead.ui.status.title"));
  form.label(failures.length
    ? t("homestead.ui.status.failed", failures.length)
    : t("homestead.ui.status.ok"));
  form.label(t("homestead.ui.status.claims", allClaims().length));
  form.divider();
  form.label(t(visiting ? "homestead.ui.visitor.body.on" : "homestead.ui.visitor.body.off"));
  addButton(form, visiting ? t("homestead.ui.visitor.off") : t("homestead.ui.visitor.on"), () => {
    setVisitor(player, !visiting);
    player.sendMessage(visiting ? t("homestead.visitor.off") : t("homestead.visitor.on"));
    showStatus(player);
  });
  backButton(form, () => showMenu(player));
  show(form);
}

function showClaimRules(player, claim) {
  const flags = guestFlags(claim);
  const values = Object.fromEntries(ACTIONS.map((action) => [action, bool(flags[action])]));
  const form = new CustomForm(player, t("homestead.ui.rules.title"));

  for (const action of ACTIONS) form.toggle(t(PERMISSION_KEYS[action]), values[action]);
  form.divider();
  saveButton(form, () => {
    claim.guests = Object.fromEntries(ACTIONS.map((action) => [action, values[action].getData()]));
    player.sendMessage(updateClaim(claim)
      ? t("homestead.rules.saved")
      : t("homestead.storage.failed"));
    showClaim(player, claim);
  });
  backButton(form, () => showClaim(player, claim));
  show(form);
}

function showMobRules(player, claim) {
  const current = mobRules(claim);
  const spawn = Object.fromEntries(MOB_KINDS.map((kind) => [kind, bool(current[kind].spawn)]));
  const enter = Object.fromEntries(MOB_KINDS.map((kind) => [kind, bool(current[kind].enter)]));
  const everywhere = bool(false);
  const form = new CustomForm(player, t("homestead.ui.mobs.title"));

  form.header(t("homestead.ui.mobs.header.spawn"));
  for (const kind of MOB_KINDS) form.toggle(t(MOB_KEYS[kind]), spawn[kind]);
  form.divider().header(t("homestead.ui.mobs.header.enter"));
  for (const kind of MOB_KINDS) form.toggle(t(MOB_KEYS[kind]), enter[kind]);
  form.divider().toggle(t("homestead.ui.mobs.everywhere"), everywhere);
  saveButton(form, () => {
    const saved = {};
    for (const kind of MOB_KINDS) {
      saved[kind] = { spawn: spawn[kind].getData(), enter: enter[kind].getData() };
    }
    const targets = everywhere.getData() ? claimsOf(claim.ownerId) : [claim];
    let savedAll = true;
    for (const target of targets) {
      target.mobs = JSON.parse(JSON.stringify(saved));
      if (!updateClaim(target)) savedAll = false;
    }
    player.sendMessage(!savedAll
      ? t("homestead.storage.failed")
      : everywhere.getData()
      ? t("homestead.mobs.saved.all", targets.length)
      : t("homestead.mobs.saved"));
    showClaim(player, claim);
  });
  backButton(form, () => showClaim(player, claim));
  show(form);
}

function showMemberRules(player, claim, member) {
  const groups = activeGroups(claim, member, claim.ownerId);
  const summary = groups.length
    ? t("homestead.ui.member.groups.in", groups.map((group) => group.name).join(", "))
    : t("homestead.ui.member.groups.none");

  present(player, raw(member.name), summary, [
    { label: t("homestead.ui.member.groups.edit"), run: () => showMemberGroups(player, claim, member) },
    { label: t("homestead.ui.member.edit"), run: () => showMemberOverrides(player, claim, member) },
    {
      label: t("homestead.ui.member.reset"),
      run: () => {
        const stored = memberOf(claim, member.id);
        if (stored) {
          stored.overrides = {};
          delete stored.permissions;
          player.sendMessage(updateClaim(claim)
            ? t("homestead.rules.saved.for", member.name)
            : t("homestead.storage.failed"));
        }
        showMemberRules(player, claim, member);
      },
    },
    {
      label: t("homestead.ui.untrust.title"),
      run: () => {
        applyTrust(player, claim, resolveTarget(member), false);
        showPeople(player, claim);
      },
    },
    { label: t("homestead.ui.back"), run: () => showPeople(player, claim) },
  ]);
}

function showMemberOverrides(player, claim, member) {
  const overrides = overridesOf(member);
  const explained = explainFlags(claim, member);
  const labels = [
    t("homestead.ui.rule.inherit"),
    t("homestead.ui.rule.allow"),
    t("homestead.ui.rule.deny"),
  ];
  const values = {};
  const form = new CustomForm(player, raw(member.name));

  for (const action of ACTIONS) {
    const current = overrides[action];
    values[action] = number(current === true ? 1 : current === false ? 2 : 0);
    const inherited = explained[action].allowed
      ? t("homestead.ui.rule.now.allowed")
      : t("homestead.ui.rule.now.denied");
    form.dropdown(
      join(t(PERMISSION_KEYS[action]), raw(" "), inherited),
      values[action],
      choices(labels)
    );
  }

  form.divider();
  saveButton(form, () => {
    const stored = memberOf(claim, member.id);
    if (!stored) return showClaim(player, claim);
    const saved = {};
    for (const action of ACTIONS) {
      if (values[action].getData() === 1) saved[action] = true;
      if (values[action].getData() === 2) saved[action] = false;
    }
    stored.overrides = saved;
    delete stored.permissions;
    player.sendMessage(updateClaim(claim)
      ? t("homestead.rules.saved.for", member.name)
      : t("homestead.storage.failed"));
    showMemberRules(player, claim, member);
  });
  backButton(form, () => showMemberRules(player, claim, member));
  show(form);
}

function showMemberGroups(player, claim, member) {
  const library = groupsOf(claim.ownerId);
  const stored = memberOf(claim, member.id);
  if (!stored) return showClaim(player, claim);
  const membership = new Set(stored.groups ?? []);
  const actions = library.map((group) => ({
    label: raw(`${membership.has(group.id) ? "+" : "-"} ${group.name}`),
    run: () => {
      if (membership.has(group.id)) {
        stored.groups = (stored.groups ?? []).filter((id) => id !== group.id);
        player.sendMessage(updateClaim(claim)
          ? t("homestead.group.left", member.name, group.name)
          : t("homestead.storage.failed"));
        return showMemberGroups(player, claim, member);
      }

      const verdict = mayJoin(claim, stored, claim.ownerId, group);
      if (!verdict.ok) {
        player.sendMessage(t("homestead.group.clash", group.name, verdict.group.name, verdict.actions.join(", ")));
        return showMemberGroups(player, claim, member);
      }
      stored.groups = [...(stored.groups ?? []), group.id];
      player.sendMessage(updateClaim(claim)
        ? t("homestead.group.joined", member.name, group.name)
        : t("homestead.storage.failed"));
      showMemberGroups(player, claim, member);
    },
  }));
  actions.push({ label: t("homestead.ui.back"), run: () => showMemberRules(player, claim, member) });
  present(player, raw(member.name), library.length ? undefined : t("homestead.ui.groups.empty"), actions);
}

function showGroups(player, claim) {
  const library = groupsOf(claim.ownerId);
  const actions = library.map((group) => ({
    label: raw(`${enabledIn(claim, group.id) ? "+" : "-"} ${group.name}`),
    run: () => showGroup(player, claim, group),
  }));
  actions.push({ label: t("homestead.ui.groups.new"), run: () => showGroupEditor(player, claim) });
  actions.push({ label: t("homestead.ui.groups.copy"), run: () => showCopyGroup(player, claim) });
  actions.push({ label: t("homestead.ui.back"), run: () => showClaim(player, claim) });
  present(player, t("homestead.ui.groups.title"), library.length ? undefined : t("homestead.ui.groups.empty"), actions);
}

function showGroup(player, claim, group) {
  const here = groupMembers(claim, group.id);
  const active = enabledIn(claim, group.id);
  const status = join(
    active ? t("homestead.ui.group.on") : t("homestead.ui.group.off"),
    raw("\n"),
    here.length
      ? t("homestead.ui.group.here", here.map((member) => member.name).join(", "))
      : t("homestead.ui.group.here.none")
  );
  present(player, raw(group.name), status, [
    { label: t("homestead.ui.group.edit"), run: () => showGroupEditor(player, claim, group) },
    {
      label: active ? t("homestead.ui.group.turn.off") : t("homestead.ui.group.turn.on"),
      run: () => {
        if (!active) {
          const verdict = mayEnable(claim, claim.ownerId, group);
          if (!verdict.ok) {
            player.sendMessage(t(
              "homestead.group.clash.enable",
              verdict.member.name,
              verdict.group.name,
              verdict.actions.join(", ")
            ));
            return showGroup(player, claim, group);
          }
        }
        setEnabledIn(claim, group.id, !active);
        player.sendMessage(updateClaim(claim)
          ? t(active ? "homestead.group.disabled" : "homestead.group.enabled", group.name)
          : t("homestead.storage.failed"));
        showGroups(player, claim);
      },
    },
    {
      label: t("homestead.ui.group.delete"),
      run: () => confirmGroupRemoval(player, claim, group),
    },
    { label: t("homestead.ui.back"), run: () => showGroups(player, claim) },
  ]);
}

function groupMembers(claim, groupId) {
  return (claim.members ?? []).filter((member) => member.groups?.includes(groupId));
}

function showGroupEditor(player, claim, group) {
  const existing = group ? rulesOf(group) : {};
  const name = text(group?.name ?? "");
  const labels = [
    t("homestead.ui.rule.silent"),
    t("homestead.ui.rule.allow"),
    t("homestead.ui.rule.deny"),
  ];
  const values = {};
  const form = new CustomForm(player, group ? raw(group.name) : t("homestead.ui.groups.new"));
  form.textField(t("homestead.ui.group.name"), name, {
    description: t("homestead.ui.group.name.hint"),
  });
  form.divider();

  for (const action of ACTIONS) {
    const value = existing[action];
    values[action] = number(value === true ? 1 : value === false ? 2 : 0);
    form.dropdown(t(PERMISSION_KEYS[action]), values[action], choices(labels));
  }

  form.divider();
  saveButton(form, () => {
    const savedName = cleanGroupName(name.getData());
    if (!savedName) {
      player.sendMessage(t("homestead.group.unnamed"));
      return showGroups(player, claim);
    }
    const rules = {};
    for (const action of ACTIONS) {
      if (values[action].getData() === 1) rules[action] = true;
      if (values[action].getData() === 2) rules[action] = false;
    }
    if (!group) {
      const made = createGroup(claim.ownerId, savedName, rules);
      if (!made) {
        player.sendMessage(groupsOf(claim.ownerId).length >= CONFIG.groups.maxPerOwner
          ? t("homestead.group.limit", CONFIG.groups.maxPerOwner)
          : t("homestead.storage.failed"));
        return showGroups(player, claim);
      }
      player.sendMessage(t("homestead.group.created", made.name));
      return showGroups(player, claim);
    }

    const edited = { ...group, name: savedName, rules };
    const verdict = mayEdit(claimsOf(claim.ownerId), claim.ownerId, edited);
    if (!verdict.ok) {
      player.sendMessage(t(
        "homestead.group.clash.edit",
        verdict.member.name,
        verdict.group.name,
        verdict.actions.join(", ")
      ));
      return showGroups(player, claim);
    }
    if (!saveGroup(claim.ownerId, edited)) {
      player.sendMessage(t("homestead.storage.failed"));
      return showGroups(player, claim);
    }
    player.sendMessage(t("homestead.group.saved", edited.name));
    showGroups(player, claim);
  });
  backButton(form, () => showGroups(player, claim));
  show(form);
}

function showCopyGroup(player, claim) {
  const others = claimsOf(claim.ownerId).filter((other) => other.id !== claim.id);
  const library = groupsOf(claim.ownerId);
  if (!others.length) {
    player.sendMessage(t("homestead.group.copy.nowhere"));
    return showGroups(player, claim);
  }
  if (!library.length) {
    player.sendMessage(t("homestead.ui.groups.empty"));
    return showGroups(player, claim);
  }

  const from = number(0);
  const which = number(0);
  const withMembers = bool(true);
  const form = new CustomForm(player, t("homestead.ui.groups.copy"));
  form.dropdown(
    t("homestead.ui.group.copy.from"),
    from,
    others.map((other, value) => ({ label: claimButton(other), value }))
  );
  form.dropdown(
    t("homestead.ui.group.copy.which"),
    which,
    library.map((group, value) => ({ label: raw(group.name), value }))
  );
  form.toggle(t("homestead.ui.group.copy.members"), withMembers).divider();
  saveButton(form, () => {
    const source = others[from.getData()];
    const group = library[which.getData()];
    if (!source || !group) return showGroups(player, claim);
    const enabling = mayEnable(claim, claim.ownerId, group);
    if (!enabling.ok) {
      player.sendMessage(t(
        "homestead.group.clash.enable",
        enabling.member.name,
        enabling.group.name,
        enabling.actions.join(", ")
      ));
      return showGroups(player, claim);
    }
    setEnabledIn(claim, group.id, true);

    let added = 0;
    let refused = 0;
    if (withMembers.getData()) {
      for (const member of groupMembers(source, group.id)) {
        let stored = memberOf(claim, member.id);
        if (!stored) {
          stored = { id: member.id, name: member.name, groups: [], overrides: {} };
          claim.members.push(stored);
        }
        if (stored.groups?.includes(group.id)) continue;
        if (!mayJoin(claim, stored, claim.ownerId, group).ok) {
          refused++;
          continue;
        }
        stored.groups = [...(stored.groups ?? []), group.id];
        added++;
      }
    }
    if (!updateClaim(claim)) {
      player.sendMessage(t("homestead.storage.failed"));
      return showGroups(player, claim);
    }
    player.sendMessage(t("homestead.group.copied", group.name, added));
    if (refused) player.sendMessage(t("homestead.group.copied.refused", refused));
    showGroups(player, claim);
  });
  backButton(form, () => showGroups(player, claim));
  show(form);
}

function showTrust(player, claim) {
  const candidates = world.getPlayers()
    .filter((candidate) => candidate.id !== player.id && !claim.members.some((member) => member.id === candidate.id));
  if (!candidates.length) {
    player.sendMessage(t("homestead.ui.nobody.online"));
    return showPeople(player, claim);
  }

  const library = groupsOf(claim.ownerId);
  const grants = [
    ...library.map((group) => ({ label: raw(group.name), grant: { groupId: group.id } })),
    { label: t("homestead.ui.trust.everything"), grant: { full: true } },
  ];
  const who = number(0);
  const as = number(0);
  const form = new CustomForm(player, t("homestead.ui.trust.title"));
  form.dropdown(
    t("homestead.ui.player"),
    who,
    candidates.map((candidate, value) => ({ label: raw(candidate.name), value }))
  );
  form.dropdown(
    t("homestead.ui.trust.as"),
    as,
    grants.map((grant, value) => ({ label: grant.label, value }))
  );
  form.divider();
  saveButton(form, () => {
    const target = candidates[who.getData()];
    const grant = grants[as.getData()];
    if (target && grant) applyTrust(player, claim, target, true, grant.grant);
    showPeople(player, claim);
  });
  backButton(form, () => showPeople(player, claim));
  show(form);
}

function confirmRemoval(player, claim) {
  present(player, t("homestead.ui.remove.title"), join(
    t("homestead.ui.remove.body", claimName(claim)),
    raw(" "),
    t("homestead.ui.remove.warn")
  ), [
    {
      label: t("homestead.ui.remove.yes"),
      run: () => {
        player.sendMessage(removeClaim(claim.id)
          ? t("homestead.remove.done")
          : t("homestead.storage.failed"));
      },
    },
    { label: t("homestead.ui.cancel"), run: () => showClaim(player, claim) },
  ]);
}

function confirmGroupRemoval(player, claim, group) {
  present(player, t("homestead.ui.group.delete"), raw(group.name), [
    {
      label: t("homestead.ui.group.delete"),
      run: () => {
        player.sendMessage(deleteGroup(claim.ownerId, group.id, claimsOf(claim.ownerId), updateClaim)
          ? t("homestead.group.deleted", group.name)
          : t("homestead.storage.failed"));
        showMyClaims(player);
      },
    },
    { label: t("homestead.ui.cancel"), run: () => showGroup(player, claim, group) },
  ]);
}

function showAdmin(player) {
  if (!isOperator(player)) {
    player.sendMessage(t("homestead.manage.denied"));
    return showMenu(player);
  }
  const list = allClaims();
  const actions = [{
    label: t("homestead.ui.admin.settings"),
    run: () => showAdminSettings(player),
  }, ...list.map((claim) => ({
    label: join(claimName(claim), raw(` | ${claim.ownerName}`)),
    run: () => showClaim(player, claim),
  }))];
  actions.push({ label: t("homestead.ui.back"), run: () => showMenu(player) });
  present(
    player,
    t("homestead.ui.admin.title"),
    list.length ? t("homestead.admin.all", list.length) : t("homestead.ui.admin.empty"),
    actions
  );
}

function showAdminSettings(player) {
  if (!isOperator(player)) return showMenu(player);
  const current = protectionLimits();
  const maxClaims = text(String(current.maxClaims));
  const blockBudget = text(String(current.blockBudget));
  const form = new CustomForm(player, t("homestead.ui.admin.settings"));
  form.textField(t(
    "homestead.ui.admin.maxclaims",
    LIMIT_BOUNDS.maxClaims.min,
    LIMIT_BOUNDS.maxClaims.max
  ), maxClaims);
  form.textField(t(
    "homestead.ui.admin.blockbudget",
    LIMIT_BOUNDS.blockBudget.min,
    LIMIT_BOUNDS.blockBudget.max
  ), blockBudget);
  form.divider();
  saveButton(form, () => {
    if (!isOperator(player)) return showMenu(player);
    const result = saveProtectionLimits(maxClaims.getData(), blockBudget.getData());
    if (!result.ok) {
      player.sendMessage(t(result.invalid
        ? "homestead.admin.settings.invalid"
        : "homestead.storage.failed"));
      return showAdminSettings(player);
    }
    player.sendMessage(t(
      "homestead.admin.settings.saved",
      result.limits.maxClaims,
      result.limits.blockBudget
    ));
    showAdmin(player);
  });
  backButton(form, () => showAdmin(player));
  show(form);
}

function showCredits(player) {
  const c = CONFIG.credits;
  const form = new CustomForm(player, t("homestead.credits.title"));
  form.label(join(
    raw(`${c.name} ${c.version}\n`),
    t("homestead.credits.tagline"),
    raw(`\n${c.author} | ${c.license}`)
  ));
  addButton(form, t("homestead.credits.link"), () => sendLink(player));
  backButton(form, () => showMenu(player));
  show(form);
}

function sendLink(player) {
  player.sendMessage(join(t("homestead.credits.source"), raw(`\n§a${CONFIG.credits.url}`)));
}

setMarkingScreen(showMarking);
