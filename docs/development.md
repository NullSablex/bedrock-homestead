# Development

The add-on itself has no third-party runtime dependencies. Repository checks
require Python 3.9 or newer and Node.js.

## Verify a change

```bash
python tools/check.py
node --experimental-vm-modules tools/stress.mjs
python tools/build.py --all
```

The static checker validates manifests, translations, stored-data contracts and
repository invariants. The deterministic stress suite loads the real add-on
modules against a small Bedrock API mock and combines geometry, permissions,
group conflicts, markers, inventory lifecycle and special use-on cases.

Build output is written to `dist/` as a combined `.mcaddon` plus separate
behavior and resource `.mcpack` files.

## Documentation

Install the locked toolchain and treat warnings as failures:

```bash
python -m pip install --require-hashes -r requirements-docs.txt
mkdocs serve
mkdocs build --strict
```

When a direct documentation dependency changes, update
`requirements-docs.in` and regenerate `requirements-docs.txt` with
`pip-compile --generate-hashes requirements-docs.in`.

## Bedrock API contract

The manifests target Minecraft Bedrock 1.26 or newer and stable
`@minecraft/server` 2.9.0 plus `@minecraft/server-ui` 2.1.0. Do not introduce a
beta dependency for a convenience feature. Preserve the tested fallback when a
new cancellable event is not available on the running game.

Enable **Content Log GUI** under Minecraft's Creator settings while testing.
Exercise the change as an owner, an authorized member, a visitor and, where
relevant, a native Operator.
