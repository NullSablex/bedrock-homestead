# Contributing

## Setup

Python 3.9+ is the only requirement. There is no Node dependency and no
bundler — the add-on ships the JavaScript the game runs.

```bash
git clone https://github.com/NullSablex/bedrock-homestead
cd bedrock-homestead
python tools/check.py     # static analysis
node --experimental-vm-modules tools/stress.mjs # exhaustive logic checks
python tools/build.py     # writes dist/
```

To test in game, junction the packs into the game's development folders so it
reads straight from your clone. Changes take effect when you re-enter the
world; there is no hot reload.

**Turn on Content Log GUI** under Settings → Creator before anything else.
Without it a script error is invisible and you will chase a ghost.

## Before opening a pull request

```bash
python tools/check.py
node --experimental-vm-modules tools/stress.mjs
python tools/build.py
```

Both run in CI, so a failure there is a failure here. `check.py` covers imports
resolving, config keys existing, translation keys present in every language
file, characters that break the in-game font, JSON validity, and side effects
that would throw inside `beforeEvents`.

None of it proves behaviour. **Say in the pull request what you tested in game**,
or say plainly that you did not — an untested change is still worth reviewing,
but the reviewer needs to know which it is.

## Conventions

**Source language is en-US.** Comments, identifiers, the base `.lang` file.

**Player-facing text never sits in the code.** It goes through a translation key
in every `.lang` file. The only exception is the tool's item name and lore,
which the API refuses to translate — and the name is also what identifies the
tool, so it has to be the same string for everyone.

**Stay inside Latin-1 in displayed text.** Accented letters render fine; a
single character above `U+00FF` makes Minecraft redraw the whole line in a
fallback font that clashes with everything else. `check.py` rejects them.

**Comments explain why, not what.** A comment restating the line below it is
noise and will be removed. A comment recording a constraint the next reader
could not recover on their own is the most valuable thing in the file.

**One responsibility per module.** When a file starts answering two questions,
split it.

## Adding a language

1. Copy `resource_packs/homestead/texts/en_US.lang` to your language code.
2. Translate the values, leaving the keys untouched.
3. Add the code to `texts/languages.json`.
4. Run `python tools/check.py` — it fails on any key the code uses that your
   file is missing.

Keep the `%s` placeholders and the `§` colour codes. The add-on currently ships
`en_US` and `pt_BR`; a client set to anything else falls back to English.

## Changing behaviour

If you hit an API constraint — something that does not work the way it should,
or works only under a condition nobody would guess — **write it down in
`docs/architecture.md`**. Rediscovering those is the most expensive thing that
can happen to this project.

## Reporting bugs

Use the issue templates. Two things are always needed and rarely volunteered:
the **content log** output, and confirmation that **both packs** are enabled.

Protection bypasses and claim theft go through [Security](SECURITY.md) instead —
on a live server, a public report of those is an exploit handed to everyone
reading.

## Releases

Maintainer only:

1. Bump `version` in both manifests.
2. Add the section to `CHANGELOG.md`.
3. Tag `vX.Y.Z` and push it.

The workflow verifies the tag matches both manifests, builds the three
packages, and takes the release body from the changelog section for that
version.

## AI

AI tools are welcome here, under one rule that matters: **you are responsible
for what you submit**, and authorship stays human — no `Co-Authored-By:`
pointing at an assistant. See [AI-POLICY.md](AI-POLICY.md).

The failure mode worth naming: assistants routinely invent Bedrock APIs that do
not exist, or that existed in 1.21 and were removed by 1.26. Nothing here runs
JavaScript, so only the game can catch that.

## Licence

Contributions are licensed under the [MPL-2.0](LICENSE), like the rest of the
project. In practice: a file you modify stays open; a file you add can be
whatever you like.
