## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem it solves. If it fixes an issue, link it. -->

## Checks

- [ ] `python tools/check.py` passes
- [ ] `node --experimental-vm-modules tools/stress.mjs` passes
- [ ] `python tools/build.py` produces a package
- [ ] Tested in game, or explicitly not tested

## If it touches player-facing text

- [ ] New strings go through a translation key, not a literal
- [ ] The key is present in every `.lang` file
- [ ] No characters above `U+00FF` (accents are fine, arrows are not)

## If it touches behaviour

- [ ] Comments explain *why*, not what the code already says
- [ ] Anything learned about an API limit is recorded in `docs/architecture.md`
