# Changelog

## 1.1.0-beta.1 - 2026-11-08

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
