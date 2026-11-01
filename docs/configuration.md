# Configuration

Most worlds need no file edits. A player whose native Bedrock permission level
is **Operator** sees **Administration** in the Homestead menu. Custom permission
profiles and tags do not grant this access.

## Operator settings

The Administration screen changes two world-wide limits and saves them with
the world:

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Areas per player | 16 | 1-256 |
| Total protected blocks per player | 32,768 | 25-4,194,304 |

The block budget is the combined horizontal area of a player's claims, not the
number of boundary blocks or the full vertical volume. Raising either limit can
increase the amount of stored data and work performed while players move.
Existing claims are not deleted when a limit is lowered; the player simply
cannot create more until usage is back within the limit.

Public claims do not consume a player's count or block budget. They belong to
the server identity, are listed separately from player claims and can be
created, edited or removed by any native operator. Their management screen can
disable PvP. Incoming projectiles are always reflected by every protected area
and do not have a configurable switch.

## Advanced defaults

Source installations can adjust `behavior_packs/homestead/scripts/config.js`
before packaging. These values are code-level defaults, not live operator
settings:

| Key | Default | Meaning |
| --- | ---: | --- |
| `selection.minSide` | 5 | Minimum rectangle width or depth |
| `selection.maxSide` | 128 | Maximum rectangle width or depth |
| `minGapBetweenOwners` | 8 | Required horizontal gap between unrelated claims |
| `heightMode` | `full` | Protect the full dimension height |
| `selection.maxPoints` | 64 | Maximum points in a custom boundary |
| `selection.closeWithin` | 2 | Distance accepted when closing near point 1 |
| `presence.everyTicks` | 5 | Ticks between player-presence checks |
| `presence.creatureEveryTicks` | 10 | Ticks between checks of creatures in loaded chunks |
| `projectiles.everyTicks` | 1 | Ticks between checks of tracked projectiles |
| `quickClaim` | `false` | Whether the optional fixed-size quick claim is enabled |
| `quickSize` | 33 | Side length used only when quick claim is enabled |

Changing source defaults does not overwrite operator settings already saved in
a world. Test geometry and performance after increasing structural limits.
