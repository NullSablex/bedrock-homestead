# Changelog

## 1.1.0-beta.2 - 2026-11-26

- Projectile ricochet can be turned off per area and stays on by default.
- Projectiles are reflected before they reach the boundary, including fast ones
  that would cross a narrow area within one tick.
- Projectiles shot by players who may build in an area are not reflected.
- Visitor test mode removed.
- Area and group data that cannot be read are no longer overwritten; saving is
  locked and the Status screen reports it.
- Area and group data are split across several world properties, removing the
  size cap.
- Each screen saves only the settings it changed, so concurrent edits no longer
  undo each other.
- Creatures are no longer pushed into a neighbouring area that also refuses
  them, and area height limits apply to creature removal.
- Marking blocks left behind by a reload or crash are removed on the next load.
- Documentation site built with Zensical instead of MkDocs.

## 1.1.0-beta.1 - 2026-11-01

- Server-owned public claims jointly managed by native operators.
- Optional no-PvP rules and mandatory reflection of incoming projectiles.
- Safe zone, Arena and Community presets for public claims.
- Transactional boundary editing for existing private and public claims.
- Protection of simulated chunks even when an area's owner is not nearby.
- Isolated visitor testing that cannot change access to another player's area.
- Rust `xtask` for validation, stress tests and reproducible packages.

## 1.0.0 - 2026-10-29

First release of Homestead for Minecraft Bedrock.

- Rectangular and custom-shaped claims made with numbered marking points.
- Player-defined claim names, with dimension and position for identification.
- Protection against breaking, building, explosions, trespassing and unauthorized use.
- Separate permissions for entry, doors, containers, utility blocks, placing and breaking.
- Rules for guests, trusted players and reusable permission groups.
- Per-claim control of monsters, animals, villagers, traders and golems.
- Visitor test mode, with safe evacuation when access is revoked.
- Native menu opened through the deed and a temporary land-marking wand.
- Operator-only settings for claim count and block budget per player.
- One deed and wand per player, without duplicates after death or while stored.
- Persistent storage validated before replacing world data.
- Brazilian Portuguese and English interfaces without experimental APIs.
