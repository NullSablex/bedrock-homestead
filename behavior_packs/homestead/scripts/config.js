export const CONFIG = {
  /**
   * The deed: the book every player is handed, and the only way into the
   * add-on.
   *
   * There are no commands. `/scriptevent` needs cheats enabled, which turns off
   * achievements and is off by default on most worlds and every Realm — an
   * add-on reachable only that way is an add-on most players cannot use. The
   * script hands the item over directly, which the API allows regardless of the
   * cheat setting, and everything else happens in the form the item opens.
   *
   * Identification is by NAME, not by type: an ordinary book stays ordinary.
   * The name and lore cannot be translated per player — item text takes plain
   * strings only, never RawMessage — so they use the language set here, and
   * that sameness is exactly what makes the name check reliable.
   */
  deed: {
    /** Tried in order: the first one that exists in this version wins. */
    itemIds: [
      "minecraft:book",
      "minecraft:paper",
    ],
    itemName: "§aHomestead Deed",
    loreHeader: "§7Your claims:",
    loreHint: "§8Use it to open the claim menu",
    loreFooter: "§8Mark an area from there",
    loreBlank: "§8No claims yet. Use it to make one.",

    /**
     * Checked on every spawn. The item is kept through death, and its issued
     * flag prevents another copy when the original was deliberately stored.
     */
    giveOnSpawn: true,

    /** Ticks to wait after spawn. The inventory is not ready on the same tick. */
    giveDelay: 20,

    /** Ticks to ignore a second use. A held right-click repeats. */
    openCooldown: 10,

    /**
     * How far the aim reaches when marking a corner, in blocks.
     *
     * Slightly beyond survival reach on purpose: the corner lands where the
     * player is looking, not where the click landed, so aiming across a ditch
     * should work rather than being a near miss.
     */
    reach: 8,

    /**
     * Blocks whose own right-click wins over the menu.
     *
     * Right-clicking a chest opens the chest and does not use what is in hand,
     * but the game reports the interaction all the same — so without this the
     * menu opened over every container, door and workbench the player touched
     * while carrying the deed.
     */
    interactiveStates: [
      "open_bit",
      "button_pressed_bit",
      "toggle_bit",
      "occupied_bit",
      "door_hinge_bit",
      "upper_block_bit",
      "lever_direction",
      "in_wall_bit",
    ],

    /**
     * The exceptions, and there are few. Workstations are operable and say so
     * nowhere: to every test above, a crafting table is a solid cube.
     */
    interactiveBlocks: [
      "minecraft:crafting_table", "minecraft:cartography_table",
      "minecraft:smithing_table", "minecraft:loom", "minecraft:stonecutter",
      "minecraft:grindstone", "minecraft:enchanting_table", "minecraft:beacon",
      "minecraft:lectern", "minecraft:bell", "minecraft:jukebox",
      "minecraft:composter", "minecraft:respawn_anchor", "minecraft:flower_pot",
      "minecraft:cake", "minecraft:crafter", "minecraft:chiseled_bookshelf",
      "minecraft:decorated_pot", "minecraft:noteblock",
    ],
  },

  /**
   * The marking wand, handed out only while an area is being marked.
   *
   * The deed used to mark corners as well, and that made every stray click on
   * a block into a corner — someone reaching for the menu, or tapping a wall
   * on the way past, kept ending up halfway through a selection they never
   * started. A separate item makes the gesture unambiguous, and a temporary
   * one avoids adding something permanent to carry, lose and explain.
   *
   * A stick, because the very first version of this add-on used one and it
   * reads as a tool rather than as treasure. Identified by NAME: an ordinary
   * stick stays ordinary.
   */
  wand: {
    itemIds: [
      "minecraft:stick",
      "minecraft:blaze_rod",
    ],
    itemName: "§aMarking Wand",

    /*
     * There is no mode setting here any more, and that is deliberate.
     *
     * The wand used to start in "rectangle" or "polygon" and switch between
     * them, which asked the player to name the shape before they had drawn it.
     * Now the count of points decides: two are opposite corners, a third turns
     * them into a traced path. Nothing to configure, and nothing to explain
     * before the first click.
     */
    loreHint: "§8Aim at a block: mark a corner",
    loreFooter: "§8Aim at nothing: marking controls",
  },

  /** The menu the deed opens. */
  menu: {
    /**
     * Button icons, as texture paths.
     *
     * Vanilla paths on purpose: the add-on ships no art, and a path that comes
     * with the game needs no resource pack of its own. A path the game does not
     * have renders as a blank square rather than failing, so a wrong guess
     * costs an icon and nothing else. Set any to undefined for no icon.
     */
    icons: {
      claim: "textures/items/wood_hoe",
      mine: "textures/ui/icon_map",
      trust: "textures/ui/friend_glyph",
      untrust: "textures/ui/cancel",
      remove: "textures/ui/trash",
      admin: "textures/ui/op",
      status: "textures/ui/debug_glyph_color",
      visitor: "textures/ui/permissions_visitor_hand",
      wand: "textures/items/stick",
      mode: "textures/ui/gear",
      rules: "textures/ui/permissions_op_crown",
      mobs: "textures/ui/hanging_bat",
      group: "textures/ui/FriendsIcon",
      credits: "textures/ui/infobulb",
      link: "textures/ui/copy",
      back: "textures/ui/arrow_left",
    },

    /**
     * A form refuses to open while the player is holding a key, and reports it
     * as a cancellation rather than an error. Right-click is the gesture that
     * asks for the menu, so it waits for the button to come up instead of
     * failing silently.
     */
    retries: 10,
    retryTicks: 5,
  },

  /**
   * Shown on the credits screen. Plain values, not translation keys: a name is
   * a name in every language, and a version number is a version number.
   */
  credits: {
    name: "Homestead",
    author: "NullSablex",
    version: "1.0.0",
    license: "MPL-2.0",
    /**
     * Two forms of the same address, because two surfaces have two widths. A
     * form body wraps mid-word and inserts a hyphen doing it, turning a real
     * address into one that reads as real and is not. `repo` fits the width;
     * chat is wider and can be copied from, so it gets the whole thing.
     */
    repo: "NullSablex/bedrock-homestead",
    url: "https://github.com/NullSablex/bedrock-homestead",
  },

  /** Limits for player-authored labels and persisted permission groups. */
  groups: {
    maxPerOwner: 32,
    maxNameLength: 32,
  },

  /** Short player-authored names shown in claim lists and headings. */
  claims: {
    maxNameLength: 32,
  },

  /**
   * The one-click claim: a square of this side, centred on the player.
   *
   * OFF by default, and that is a correction rather than a preference. While
   * marking was broken this was the only button that worked, so every attempt
   * to mark out an area ended in a fixed square around the player instead —
   * the opposite of what the menu was being asked for. Marking is the way in;
   * turn this on if a server wants the shortcut back.
   */
  quickClaim: false,

  /** Side of that square. Must be odd, so it can be centred. */
  quickSize: 33,

  /**
   * Manual selection: two opposite corners, clicked on the ground.
   *
   * Two and not four. An axis-aligned rectangle is completely determined by two
   * opposite corners — the other two are derived, not chosen. Asking for four
   * would add no precision and three ways to contradict yourself, and the only
   * thing the code could do with corners that disagree is take the box that
   * encloses them, which is the two-corner answer again.
   */
  selection: {
    /** Smallest side. Below this a claim is a nuisance, not a home. */
    minSide: 5,

    /**
     * Largest side, in blocks. 128 is eight chunks — the order of a woodland
     * mansion, and more than a personal base needs. This is the number to
     * change if a server wants tighter or looser plots.
     */
    maxSide: 128,

    /**
     * Total claimed surface one player may hold, across every claim.
     *
     * The count limit alone does not stop anyone: three claims of the maximum
     * size is a small country. This is what actually caps how much of the world
     * one player can take, and it leaves the shape free — one big square, or
     * several small ones side by side that together fence a village.
     */
    blockBudget: 32768,

    /**
     * A cap on the NUMBER of claims as well, for a reason that has nothing to
     * do with fairness: `claimAt` scans the list on every break, place and
     * interact of every player. Hundreds of tiny claims would be a performance
     * problem long before they were a land-grab.
     */
    maxClaims: 16,

    /**
     * The block dropped where a corner is marked.
     *
     * A corner has to be something the player can see and walk to. Particles
     * vanish behind terrain, do not survive a relog, and cannot be found again
     * after wandering off — none of which is apparent until you try to square
     * up a plot across a hill.
     *
     * It goes only into free AIR ABOVE the clicked block, so nothing belonging
     * to the player is destroyed to place temporary interface blocks. If none
     * of the candidate positions is available, the mark is refused.
     *
     * Glowstone on purpose: unmistakable, and visible at night, which is when
     * people give up looking for a corner they placed.
     */
    marker: {
      /**
       * Two blocks, and the difference is the point.
       *
       * The POST stands exactly where the player clicked, and it is not a
       * light: asked which corner was which, the answer has to be a block that
       * looks unlike everything else around it. Lodestone reads as surveying
       * equipment and occurs nowhere naturally, so one on a hillside is
       * unambiguous.
       *
       * The LIGHTS sit either side of a post, on the two faces turned inward.
       * They are what turns a lone block into a corner — standing at one, you
       * can see which way the boundary leaves — and being light they answer at
       * night, which is when people give up looking for a corner they placed.
       */
      postBlock: "minecraft:lodestone",
      lightBlock: "minecraft:glowstone",

      /**
       * How many positions above the corner to try before refusing the mark.
       *
       * One was not enough: a slab, a plant, snow or the next block of a wall
       * sitting on top of the corner should not make a valid open position one
       * block higher go unnoticed.
       */
      searchUp: 3,
    },

    /**
     * A ceiling on the points of one shape.
     *
     * `contains` walks every edge for a polygon, on every break, place and
     * interact of every player, so the number of edges is a cost paid forever
     * by everyone on the server — not just by whoever drew the shape.
     *
     * High enough that nobody meets it while tracing a river bank or stepping
     * around a neighbour, and low enough that one elaborate outline cannot
     * make every block event on the server slower.
     */
    maxPoints: 64,

    /**
     * How close to the first point counts as coming back to it, in blocks.
     *
     * Hitting the exact block would be a precision the player cannot confirm
     * from a few blocks away, and missing it silently adds another wall
     * instead of closing the shape.
     */
    closeWithin: 2,

    /**
     * The outline drawn around a selection, and around the claim underfoot.
     *
     * Particles are the only way Bedrock lets an add-on draw without changing
     * the world. Which particle matters more than it sounds: the first choice
     * here was `villager_happy`, which is small, dim and short-lived, and the
     * border was invisible from more than a few blocks away.
     *
     * End rod is the opposite of all three — bright white, large, and it
     * lingers and drifts upward, so a line of them reads as a fence rather
     * than as a scatter of dots.
     */
    outline: {
      particle: "minecraft:endrod",

      /**
       * A different owner's claim plus the required gap, shown while marking.
       * Flame is a stable vanilla particle and reads as unavailable ground next
       * to the white outline of the shape the player is drawing.
       */
      conflictParticle: "minecraft:basic_flame_particle",
      conflictWallHeight: 2,
      conflictCornerHeight: 6,
      /** Shared by every nearby exclusion outline in one redraw. */
      conflictMaxParticles: 480,
      maxConflictOutlines: 8,

      /**
       * Draw only for a player holding the deed or the wand.
       *
       * Shown to everyone always, the outline stops being information and
       * becomes weather — a fence of particles across the landscape that people
       * learn to look past, drawn at a cost for players who are only walking
       * home.
       */
      onlyWhenHolding: true,

      /** Ticks between redraws. Low enough that the line looks continuous. */
      everyTicks: 5,

      /** One particle every N blocks along the border. */
      spacing: 2,

      /**
       * Whether the outline follows the ground.
       *
       * A single height draws straight through a hillside — buried where the
       * land rises, floating where it falls — and that is what made the first
       * preview visible only from directly above it.
       */
      followGround: true,

      /** How far up and down to look for the surface at each column. */
      groundSearch: 6,

      /**
       * How tall the wall stands, and how tall the four corner columns stand.
       *
       * The wall is what makes the shape readable from outside it: a line on
       * the ground is drawn at a single height, so on any slope it ends up
       * inside the hill and the player sees nothing until standing on top of
       * it. Verticals rise out of the ground even where the line does not.
       */
      wallHeight: 4,
      cornerHeight: 10,

      /** Beyond this, in blocks, nothing is drawn: it would not be visible. */
      visibleWithin: 96,

      /** Hard ceiling per redraw, so a huge selection cannot stall a tick. */
      maxParticles: 700,
    },
  },

  /**
   * Protected height. "full" covers world floor to build limit, which is what
   * most people expect: otherwise someone tunnels underneath and walks in
   * through the cellar.
   */
  heightMode: "full",

  /**
   * Minimum gap between claims of DIFFERENT owners, in blocks. Your own claims
   * may sit flush against each other, so several small ones can be fenced
   * together into one larger area.
   */
  minGapBetweenOwners: 8,

  /**
   * Being inside a claim at all: players who were not let in, and mobs.
   *
   * This is the only rule with no event behind it. Walking asks no permission,
   * so it cannot be refused before it happens — it can only be noticed and
   * undone, which is why these are watches on a timer rather than handlers.
   */
  presence: {
    /** The watch: send uninvited players, and refused creatures, back out. */
    enforceEntry: true,

    /**
     * Ticks between checks, for both. Four times a second: a boundary, not a
     * tripwire.
     *
     * Ticks and not seconds, deliberately. Twenty to the second while the
     * server keeps up and fewer when it does not, which is the right way round
     * — a server already struggling should not spend its budget looking for
     * stray cows.
     */
    everyTicks: 5,

    /** Ticks between telling the same player again, so chat is not a siren. */
    messageEvery: 40,

    /** Horizontal blocks beyond a denied claim island to inspect for an exit. */
    exitSearch: 8,

    /** Vertical terrain range inspected around the player's current height. */
    exitRise: 12,
    exitDrop: 24,

    /**
     * Refuse a creature at the moment the world spawns it inside a claim that
     * does not want it.
     *
     * This is the whole mob rule. Bedrock cannot suppress spawning in a
     * region — no cancelable spawn event, spawn rules that filter a whole
     * entity type by biome and light, and a `doMobSpawning` that is the entire
     * world — so undoing the spawn one tick old is the only thing an add-on
     * can honestly offer for one rectangle of land.
     *
     * It costs nothing when nothing spawns: it answers an event rather than
     * looking for work, which is what every other rule here does and what the
     * old mob patrol could never do.
     */
    refuseSpawns: true,


    /**
     * Move out a creature that walked in from outside.
     *
     * The spawn rule keeps a claim from filling itself; this is for the monster
     * that spawned in the dark somewhere else and came looking. It rides the
     * same watch as the player rule above, on the same tick, because it is the
     * same question — who is inside that should not be — and a creature is no
     * more entitled to a warning first than a person is.
     *
     * Waiting for it to attack was tried and dropped: by the time the game
     * reports a hit the thing is already at the door, and a boundary that
     * announces intruders instead of stopping them is an alarm, not a fence.
     */
    pushOutCreatures: true,

    /**
     * How far around the player to look, in blocks.
     *
     * Roughly what a player can see and be bothered by. Larger would reach
     * across a claim they are standing at the edge of, and would also start
     * paying for entities nobody is looking at, which is the cost this whole
     * arrangement exists to avoid.
     */
    creatureRadius: 24,

    /**
     * What a NEW claim says about each kind of creature.
     *
     * Two answers per kind: may the world CREATE one here, and may one created
     * elsewhere BE here. They are different wishes — a farm wants animals
     * living in it and does not want the world breeding more into the pens —
     * and a single switch could say neither properly.
     *
     * Existing claims keep what they already say — see `mobRules` in mobs.js.
     */
    mobDefaults: {
      // Monsters neither appear nor wander in. The two together are what
      // "my land is safe" means to most people, and it is the arrangement
      // almost every owner reaches by hand.
      hostile: { spawn: false, enter: false },
      // Animals may come and go; what is refused is the world breeding its
      // own into somebody's pens.
      animals: { spawn: false, enter: true },
      // Villagers and traders are usually the point of visiting, and a
      // village that grows on its own inside a claim is a nuisance nobody
      // asked for.
      villagers: { spawn: false, enter: true },
    },

    /**
     * Never refused, whatever the claim says.
     *
     * These are the ones a claim exists to keep: an item on the floor is
     * somebody's belongings, and a boat, a frame, a painting or a map-maker's
     * NPC is part of the build rather than a visitor to it.
     *
     * Tamed and ridden animals are covered without being listed — mobs.js asks
     * the entity whether somebody owns it, which catches the wolf, the cat and
     * the saddled horse, and goes on catching them when the game adds more.
     */
    mobsAllowed: [
      "minecraft:npc",
      "minecraft:item",
      "minecraft:item_frame",
      "minecraft:glow_item_frame",
      "minecraft:painting",
      "minecraft:armor_stand",
      "minecraft:boat",
      "minecraft:chest_boat",
      "minecraft:minecart",
      "minecraft:chest_minecart",
      "minecraft:hopper_minecart",
      "minecraft:xp_orb",
      "minecraft:leash_knot",
    ],
  },

  /** What the protection covers. */
  protect: {
    breakBlock: true,
    placeBlock: true,
    // Chests, furnaces, doors, levers, buttons, beds...
    interact: true,
    // Keeps TNT and creepers from opening a hole inside a claim.
    explosions: true,
  },

  /** Blocks anyone may use, even inside someone else's claim. */
  publicBlocks: [
    "minecraft:crafting_table",
    "minecraft:ender_chest",
  ],
};
