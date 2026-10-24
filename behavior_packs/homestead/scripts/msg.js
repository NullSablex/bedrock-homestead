/**
 * Translated messages.
 *
 * No finished text in the code: we send a KEY, and the client resolves it in
 * its own language. Two players standing side by side read the same message
 * each in their own tongue, and the server never needs to know which — there
 * is no API to ask a player for their locale, and with this design it never
 * comes up.
 *
 * The keys live in homestead_RP/texts/*.lang, and they have to live in the
 * RESOURCE pack: the client resolves them, and clients never receive behavior
 * packs. That is why this add-on stopped being behavior-pack-only.
 *
 * One thing stays out, because of an API limit: item `nameTag` and `setLore`
 * take plain strings, never RawMessage. The tool's name and lore use the single
 * language set in config.js, the same for everyone — and the name is also what
 * identifies the tool, so translating it per player would break the check.
 */

/** A key with its arguments. Everything becomes a string, as .lang expects. */
export function t(key, ...args) {
  const values = args.map((a) => (a && typeof a === "object" ? a : String(a)));
  return {
    translate: key,
    with: values.some((value) => typeof value === "object")
      ? { rawtext: values.map((value) => typeof value === "object" ? value : { text: value }) }
      : values,
  };
}

/** Glues several parts into a single line. */
export function join(...parts) {
  return { rawtext: parts.filter((p) => p !== undefined) };
}

/** Literal text, for what is never translated: coordinates, player names. */
export function raw(text) {
  return { text: String(text) };
}
