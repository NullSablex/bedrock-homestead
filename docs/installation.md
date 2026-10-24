# Installation

Homestead requires Minecraft Bedrock 1.26 or newer. The behavior pack and
resource pack must both be active. Cheats and experimental features are not
required.

## Normal installation

1. Download the `.mcaddon` from the [latest GitHub release](https://github.com/NullSablex/bedrock-homestead/releases/latest).
2. Open the file with Minecraft and wait for both imports to finish.
3. Edit or create a world.
4. Enable **Homestead** under both Behavior Packs and Resource Packs.
5. Enter the world and use the Homestead Deed.

When updating, close Minecraft before importing the new package. Keep a world
backup, replace both packs together and do not delete the world's dynamic
properties: that is where claims and settings are stored.

## Dedicated servers and Realms

Server owners may use the separate behavior-pack and resource-pack `.mcpack`
files from the latest release. Install both halves and attach both UUIDs to the
world. For a Realm, import a world with both packs enabled or manage its packs
through the Realm world settings.

## Development installation

The repository keeps the unpacked sources in `behavior_packs/homestead` and
`resource_packs/homestead`. Copy or link both directories into Minecraft's
development pack folders. Re-enter the world after changing manifests or
resources; scripts can also require a world reload.

If menus show raw keys such as `homestead.menu.title`, the resource pack is
missing, disabled or at a different version from the behavior pack.
