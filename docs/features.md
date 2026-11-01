# What it does

Homestead applies the same stored rules to every protected area, whether the
area is a two-point rectangle or a custom boundary.

## Land protection

An owner can separately allow or deny:

- entering the area;
- placing and breaking blocks;
- opening containers;
- using doors, gates, buttons and levers;
- using beds, furnaces and other working blocks.

Explosions cannot damage protected blocks. A visitor who loses access while
inside a claim is moved to a safe position outside it instead of becoming
trapped at the border. Every claim always reflects arrows and throwable
projectiles that cross its boundary from outside; this protection cannot be
disabled per area.

## People and groups

Players may be authorized individually or through reusable groups. A direct
player rule overrides their group rule. Homestead rejects contradictory group
answers instead of depending on an unpredictable evaluation order.

## Creatures

Each claim controls monsters, animals, villagers, wandering traders and golems
independently. The rules cover both spawning inside and entering from outside.
Entry is enforced throughout chunks Bedrock is currently simulating, even when
the owner is not nearby; unloaded chunks remain frozen and are checked when the
game loads them again. Tamed animals, ridden or equipped mounts, NPCs, dropped
items, paintings and item frames are preserved.

## Area management

Claims can be named and are listed with their dimension and position when that
extra context is needed. Owners can rename an area, manage people and groups,
change public permissions, configure creatures, or redraw its boundary. A
redraw is transactional: invalid geometry leaves the stored area untouched.

Operators can create server-owned **public claims** from the same marking flow.
They are listed separately from player claims and any native operator can
manage them. A public claim can disable PvP, including melee and attacks whose
projectile belongs to another player, which makes it suitable for spawn areas,
lobbies and multiplayer maps. Safe zone, Arena and Community area presets
configure common combinations of visitor and PvP rules after an operator
confirms the replacement.

The **Test as visitor** option temporarily applies each owner's own public
visitor permissions to them. It does not change their real access to areas
owned by other players. The Status screen reports whether protection is active
and which block-placement enforcement path the current game provides.

## Player tools

The Homestead Deed opens the menu and the Marking Wand creates selections.
These tools do not become death drops. After respawn, Homestead supplies only
what is missing, so a copy stored in a chest does not cause another copy to be
issued.
