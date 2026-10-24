# Using the deed

Use the **Homestead Deed** to open Homestead. Choose **Mark an area** to receive
the Marking Wand and begin a selection. Aim at empty space and use the wand at
any time to open its controls.

## Rectangular areas

!!! important "Mark two diagonally opposite corners"

    A rectangle needs exactly two points. Mark the starting corner and then the
    opposite corner across the desired area. Homestead derives the complete
    rectangle, including the two sides that were never walked or marked.

```text
Point 1 +-------------------+
        |                   |
        |   claimed area    |
        |                   |
        +-------------------+ Point 2
```

After point 2, aim at empty space, use the wand and select the option to claim
the marked area. Do **not** walk around and mark all four corners: placing point
3 intentionally switches to custom-boundary mode. An unfinished custom path
can resemble a square with one missing wall because it has not yet been closed.

## Custom boundaries

Use three or more points only for a non-rectangular area:

1. Mark each turn of the boundary in order.
2. Keep every wall straight or exactly diagonal.
3. Return close to point 1, or choose **Close the outline here**.
4. Open the controls and claim the completed outline.

If a point would create an unsupported wall angle, Homestead moves it to the
nearest valid position and tells the player. Crossed, open or invalid shapes
cannot be claimed. A custom outline supports up to 64 points.

## Markers and previews

Each point is shown by a lodestone post, inward-facing glowstone and a floating
`Point N` label. White particles preview the selected boundary. Flame particles
identify land blocked by another claim and the required separation around it.

Removing a point renumbers the remaining markers. Cancelling or completing the
selection removes its temporary blocks, labels and particles.

## Naming and managing an area

The claim flow asks for a short name. The name is shown first in **My areas**;
the management screen also identifies its dimension and coordinates. From that
screen the owner can rename it, manage people, public permissions, groups and
creatures, or remove it.
