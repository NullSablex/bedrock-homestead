# Architecture

API constraints that shaped this add-on, written down so nobody pays to learn them twice.

## Block interaction and placement

`beforeEvents.playerInteractWithBlock` also fires for the click on a supporting
block that places a new block beside it. Cancelling every reported interaction
there makes a denied `use` permission override an allowed `place` permission.
The interaction handler must therefore act only when the targeted block is
actually interactive; placement is governed separately by
`playerPlaceBlock`.

The stable API exposes only the after-event for placement. When the
pre-release before-event is unavailable, Homestead removes a refused placement
on the following tick and returns the item. Each subscription is isolated so
the missing experimental event cannot prevent the rest of the protection from
loading.

## Player-scoped previews

`Player.spawnParticle` is stable and only shows the particle to that player.
Selection outlines and proximity limits use it instead of
`Dimension.spawnParticle`, because surveying guidance is private UI state and
must not become particle noise for nearby players.

## Temporary selection blocks

Marker posts and lights exist before a claim does, so claim lookup cannot
protect them. Break and explosion handlers consult the live selection registry
by exact dimension and block position. Testing only the marker block type would
also protect ordinary lodestones and glowstone, which is incorrect.

Markers are placed only in air. If no free position exists above the chosen
corner, marking fails without recording a corner and without replacing a real
block. A moved corner is transactional: its old marker is removed only after
the new marker was placed successfully.

Each post owns a custom, invisible entity whose always-visible nameplate holds
the point number. Its Script API render distance is set explicitly; the custom
entity's `always_show` component alone does not define that distance. The
entity is removed transactionally with its post and orphan nameplates are
cleared after a script reload.

## Permission boundaries

World-changing use-on items do not all emit `playerPlaceBlock`. Buckets, fire
starters, spawn eggs, frames, boats and similar items are therefore checked in
the block interaction event against both the clicked block and the adjacent
face. Entity-backed containers and fixtures are checked through
`playerInteractWithEntity`.

Group combinations are kept contradiction-free when a member joins, when a
group is edited, and when a disabled group is enabled again. Player-authored
group names are normalized to bounded printable ASCII before persistence.

Self-intersecting polygons are refused. Pick's theorem only describes the area
of a simple lattice polygon; accepting a crossed outline would let a large
bounding box report almost no area and bypass the land budget.

## Menus

The interface uses `CustomForm` from stable `@minecraft/server-ui` 2.1.0.
Each screen keeps a single short status line and exposes the available actions
directly; settings use bound observables instead of opening a separate modal.

A `CustomForm` button callback does not dismiss its form. Navigation must close
the current form first and open the destination on the next system tick. This
also prevents two forms from racing for the same player. Controls introduced
after server-ui 2.1.0, such as images and multi-button rows, are intentionally
not used.

World-wide settings use `Player.playerPermissionLevel` and accept exactly
`PlayerPermissionLevel.Operator`. `Custom` is a separate native value and must
not inherit operator access.

## Tool lifecycle

The deed and marking wand set `ItemStack.keepOnDeath`, are deduplicated on
inventory changes, and record that each tool has already been issued. The
record is necessary because the stable API cannot search every container in a
world: absence from the player's inventory may mean the tool is safely stored,
not lost. A respawn therefore never manufactures a second stored copy.

## Revoked entry

The last position outside every claim is retained separately and never
overwritten while the player is inside. Every stored destination is rechecked
before use because permissions and claims may have changed. If neither stored
position remains valid, touching denied claims are treated as one island and
the nearest collision-free, non-hazardous footing beyond the island is used.
This prevents both teleporting back into the revoked claim and bouncing from
one flush claim into another.
