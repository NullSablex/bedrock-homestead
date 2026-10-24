# Languages

Homestead ships in English (`en_US`) and Brazilian Portuguese (`pt_BR`). The
game uses the player's language and falls back to English when a translation is
missing. Player-entered area names are kept as entered after validation.

## Add a translation

1. Copy `resource_packs/homestead/texts/en_US.lang` to a new locale file.
2. Translate the text after each `=` without changing the key or placeholders.
3. Add the locale filename to `resource_packs/homestead/texts/languages.json`.
4. Run `python tools/check.py` to find missing, extra or invalid entries.
5. Test menus, action-bar messages and chat output in Minecraft at the target
   UI scale.

Keep messages short: Bedrock forms have fixed widths and long text wraps or is
clipped. The project checks its supported character range because some
decorative Unicode characters do not render consistently in Minecraft's font.

Documentation translations use MkDocs suffix files, for example
`docs/index.pt-BR.md`. A page without a translated version falls back to its
English source.
