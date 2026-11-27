import { world } from "@minecraft/server";

/**
 * JSON documents kept in world dynamic properties.
 *
 * Three guarantees the plain getDynamicProperty/JSON.parse pair did not give:
 *
 *   - Size. A single string property is capped by the game (32767
 *     characters), and a registry of polygons reaches it long before any
 *     configured claim limit. A document is split into parts under a
 *     generation, and a small head names the generation in force. The head is
 *     written last, so a write that fails half-way leaves the previous
 *     generation intact and in force.
 *   - Integrity. A document that exists but cannot be read is reported and
 *     locked: reads see the empty value, and every write is refused. Before,
 *     the empty value was written back over it at the next change, silently
 *     erasing every area in the world.
 *   - Cost. Claims are looked up every tick for every player, projectile and
 *     block event. Parsing is redone only when the stored text changed; the
 *     comparison is against the head (or the legacy string), not a re-parse.
 *
 * Values returned by `load` are shared. A caller that mutates one must follow
 * with `save`, which drops the cache whether or not it succeeds.
 */

/** Well under the cap even when every character needs three UTF-8 bytes. */
const PART_LENGTH = 10000;

const states = new Map();

function headKey(key) {
  return `${key}:head`;
}

function partKey(key, generation, index) {
  return `${key}:${generation}:${index}`;
}

function parseHead(value) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+):(\d+)$/.exec(value);
  return match ? { generation: Number(match[1]), parts: Number(match[2]) } : undefined;
}

/** The stored text and a cheap stamp that changes whenever the text does. */
function readRaw(key) {
  const head = world.getDynamicProperty(headKey(key));
  const parsed = parseHead(head);
  if (parsed) {
    let text = "";
    for (let index = 0; index < parsed.parts; index++) {
      const part = world.getDynamicProperty(partKey(key, parsed.generation, index));
      if (typeof part !== "string") throw new Error(`missing part ${index} of ${parsed.parts}`);
      text += part;
    }
    return { stamp: `head:${head}`, text };
  }
  if (head !== undefined) throw new Error("unreadable head");

  const legacy = world.getDynamicProperty(key);
  if (legacy === undefined || legacy === "") return { stamp: "empty", text: undefined };
  if (typeof legacy !== "string") throw new Error("legacy value is not text");
  return { stamp: `legacy:${legacy}`, text: legacy };
}

function stateOf(key, empty, valid) {
  let raw;
  try {
    raw = readRaw(key);
  } catch (e) {
    raw = { stamp: `broken:${e}`, error: e };
  }

  const known = states.get(key);
  if (known && known.stamp === raw.stamp) return known;

  let state;
  if (raw.error) {
    state = { stamp: raw.stamp, value: empty(), broken: true, reason: String(raw.error) };
  } else if (raw.text === undefined) {
    state = { stamp: raw.stamp, value: empty(), broken: false };
  } else {
    try {
      const value = JSON.parse(raw.text);
      state = valid(value)
        ? { stamp: raw.stamp, value, broken: false }
        : { stamp: raw.stamp, value: empty(), broken: true, reason: "unexpected shape" };
    } catch (e) {
      state = { stamp: raw.stamp, value: empty(), broken: true, reason: String(e) };
    }
  }
  if (state.broken) {
    console.error(`[Homestead] ${key} is unreadable (${state.reason}); writes are locked to protect it`);
  }
  states.set(key, state);
  return state;
}

/** The current value, shared with other readers. */
export function load(key, empty, valid) {
  return stateOf(key, empty, valid).value;
}

/** A private copy to change and save, or nothing when the document is locked. */
export function loadForWrite(key, empty, valid) {
  const state = stateOf(key, empty, valid);
  if (state.broken) return undefined;
  return JSON.parse(JSON.stringify(state.value));
}

/** True when the stored document exists but could not be read. */
export function isBroken(key, empty, valid) {
  return stateOf(key, empty, valid).broken;
}

export function save(key, value) {
  try {
    const known = states.get(key);
    if (known?.broken) return false;

    const text = JSON.stringify(value);
    const current = parseHead(world.getDynamicProperty(headKey(key)));
    const generation = (current?.generation ?? 0) + 1;
    const parts = Math.max(1, Math.ceil(text.length / PART_LENGTH));

    let written = 0;
    try {
      for (; written < parts; written++) {
        world.setDynamicProperty(
          partKey(key, generation, written),
          text.slice(written * PART_LENGTH, (written + 1) * PART_LENGTH)
        );
      }
      world.setDynamicProperty(headKey(key), `${generation}:${parts}`);
    } catch (e) {
      for (let index = 0; index < written; index++) {
        try { world.setDynamicProperty(partKey(key, generation, index), undefined); } catch { /* best effort */ }
      }
      console.warn(`[Homestead] could not write ${key}: ${e}`);
      return false;
    }

    // The new generation is in force; what it replaced is only clutter now.
    if (current) {
      for (let index = 0; index < current.parts; index++) {
        try { world.setDynamicProperty(partKey(key, current.generation, index), undefined); } catch { /* best effort */ }
      }
    }
    try { world.setDynamicProperty(key, undefined); } catch { /* best effort */ }
    return true;
  } finally {
    // A failed write may leave a caller's mutation in the shared value.
    states.delete(key);
  }
}
