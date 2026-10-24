# Homestead

> Land protection for Minecraft Bedrock - your land, your rules - by [NullSablex](https://github.com/NullSablex)

[![Latest release](https://img.shields.io/github/v/release/NullSablex/bedrock-homestead?label=version)](https://github.com/NullSablex/bedrock-homestead/releases/latest)
![License](https://img.shields.io/badge/license-MPL--2.0-blue)
![Minecraft Bedrock](https://img.shields.io/badge/Bedrock-1.26+-orange)
![Script API](https://img.shields.io/badge/%40minecraft%2Fserver-2.9.0-orange)
[![Check](https://github.com/NullSablex/bedrock-homestead/actions/workflows/check.yml/badge.svg)](https://github.com/NullSablex/bedrock-homestead/actions/workflows/check.yml)
[![Docs](https://github.com/NullSablex/bedrock-homestead/actions/workflows/docs.yml/badge.svg)](https://nullsablex.github.io/bedrock-homestead/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/NullSablex/bedrock-homestead/badge)](https://scorecard.dev/viewer/?uri=github.com/NullSablex/bedrock-homestead)

Homestead lets players name and protect rectangular or custom-shaped areas.
Owners decide who may enter, build, break, use doors, open containers and use
working blocks. Explosions, unauthorized players and unwanted creatures are
kept out by the same claim rules.

Homestead targets Minecraft Bedrock **1.26 or newer**. Both the behavior pack
and resource pack are required. Beta APIs and cheats are not required.

## Install

Download the `.mcaddon` from the [latest release](https://github.com/NullSablex/bedrock-homestead/releases/latest),
open it with Minecraft, and enable both Homestead packs on the world. See the
[installation guide](https://nullsablex.github.io/bedrock-homestead/installation/)
for Realms, dedicated servers and development installs.

> [!NOTE]
> Both the behavior pack and resource pack are required. Cheats and
> experimental features are not required.

Every player receives one **Homestead Deed**. Using it opens the native menu;
there are no commands to remember. The deed and marking wand do not become
death drops, and the add-on does not create another copy when one is stored.

## Mark a rectangular area

> [!IMPORTANT]
> A rectangle needs two points, not four. Mark the starting corner and the
> diagonally opposite corner; Homestead creates the other corners and all four
> sides automatically.

1. Use the deed and choose **Mark an area**.
2. With the Marking Wand, mark the first corner.
3. Walk diagonally to the opposite corner and mark it.
4. Open the wand controls by aiming at empty space, then claim the marked area.

```text
1 +-------------------+
  |                   |
  |   protected area  |
  |                   |
  +-------------------+ 2
```

> [!WARNING]
> Do not walk around a rectangle marking all four corners. Point 3 deliberately
> changes the selection into a custom boundary; an unfinished path may then
> look like a square with one side missing until it is closed.

Each point has a numbered lodestone post, inward-facing glowstone and a floating
`Point N` label. White particles preview the selected border. Flame particles
show land made unavailable by another player's claim and its required gap.

## Mark a custom boundary

Place a third point only when the area should not be rectangular. From that
point onward, every mark continues a wall from the previous one. Return close
to point 1, or use **Close the outline here**, to close the boundary before
claiming it.

Walls must be straight or exactly diagonal. A mark that cannot form such a wall
is moved to the nearest valid position, and the player is told when this happens.

The complete walkthrough is in [Using the deed](https://nullsablex.github.io/bedrock-homestead/tool/).

## Permissions and groups

Each claim has separate rules for:

- entering;
- doors, gates, buttons and levers;
- chests and other containers;
- beds, furnaces and other working blocks;
- placing blocks;
- breaking blocks.

Owners can authorize a player directly or place them in reusable permission
groups. Individual exceptions override group answers. Contradictory groups are
refused instead of producing an order-dependent result.

Creature rules separately decide whether monsters, animals, villagers, traders
and golems may spawn inside or enter from outside. Tamed animals, equipped
mounts, NPCs, items, paintings and item frames are never removed.

## Operator settings

The **Administration** option appears only for a player whose native Bedrock
permission level is **Operator**. Custom player permissions and tags do not
grant access. An operator can change the per-player claim count and total block
budget from the menu; the defaults are 16 claims and 32,768 blocks.

## Compatibility and safety

Homestead uses stable `@minecraft/server` **2.9.0** and
`@minecraft/server-ui` **2.1.0**. If the optional cancellable placement event is
unavailable, refused placements are immediately undone and the item is returned.
The Status screen reports which path is active.

Claim storage is validated before it replaces the last known-good world data.
Player-authored names are bounded and sanitized, invalid or crossed shapes are
rejected, and visitor test mode uses the same enforcement as a real guest.

## Build and verify

Python 3.9+ and Node.js are used by the repository checks; the add-on itself has
no third-party runtime dependencies.

```bash
python tools/check.py
node --experimental-vm-modules tools/stress.mjs
python tools/build.py --all
```

The combined installer and separate server packs are written to `dist/`.

## Documentation and contributing

- [Documentation](https://nullsablex.github.io/bedrock-homestead/)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [AI usage policy](AI-POLICY.md)
- [Changelog](CHANGELOG.md)

Homestead is licensed under the [MPL-2.0](LICENSE).
