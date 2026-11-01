const SETTINGS = Object.freeze({
  safe: Object.freeze({
    guests: Object.freeze({
      enter: true, doors: true, containers: false,
      use: true, place: false, break: false,
    }),
    allowPvp: false,
  }),
  arena: Object.freeze({
    guests: Object.freeze({
      enter: true, doors: false, containers: false,
      use: false, place: false, break: false,
    }),
    allowPvp: true,
  }),
  community: Object.freeze({
    guests: Object.freeze({
      enter: true, doors: true, containers: false,
      use: true, place: false, break: false,
    }),
    allowPvp: false,
  }),
});

export const PUBLIC_PRESET_IDS = Object.freeze(Object.keys(SETTINGS));

/** Returns a new record; the caller decides whether persistence succeeded. */
export function withPublicPreset(claim, id) {
  const preset = SETTINGS[id];
  if (!preset || !claim) return undefined;
  return {
    ...claim,
    guests: { ...preset.guests },
    combat: { allowPvp: preset.allowPvp },
  };
}
