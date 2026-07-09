# @effected/config-file-yaml

A single `ConfigCodec` adapter, `YamlCodec`, plugging `@effected/yaml` into
`@effected/config-file`'s codec seam: YAML as configuration file content.

**Tier: pure.** Peer-depends on `@effected/config-file`, `@effected/yaml` and
`effect`. Zero runtime dependencies, no IO. Merged. 2 `src/` files, 1 test file,
5 tests. Deliberately tiny — do not grow it.

**For the full design:** → `@./.claude/design/effected/packages/config-file.md`

Load when changing the codec seam, the family's package boundaries, or the
adapter's error mapping.

## Why this is its own package

This monorepo **does not use subpath exports**. Every optional dependency of
`@effected/config-file` therefore becomes its own package rather than an
`exports` subpath.

## Why pure tier, despite serving a boundary package

**Tier follows a package's own surface, not its neighbours'.** This adapter
wraps `parse` / `stringify` and never touches `FileSystem`, so it is pure —
even though its only consumer, `@effected/config-file`, is boundary tier and
does the reading and writing. This was gotten wrong once; do not re-derive it
from the dependency edge.

## Acyclicity: the codec lives here, not in `@effected/yaml`

Dependency direction is strictly acyclic: **config-file → format packages,
never the reverse.** `@effected/yaml` stays pure and unaware that config-file
exists. This adapter is the only thing that knows about both — that is its
whole reason to exist. Never add a config-file import to `@effected/yaml`.

## The exported surface

`src/index.ts` re-exports exactly one binding, `YamlCodec`, from
`src/YamlCodec.ts`. Only `src/index.ts` re-exports; no barrel files.

`YamlCodec` is typed as `ConfigCodec`, whose interface (in
`@effected/config-file`, `src/ConfigCodec.ts`) is three readonly members:

- `name: string` — here, `"yaml"`
- `parse: (raw: string) => Effect.Effect<unknown, E>`
- `stringify: (value: unknown) => Effect.Effect<string, E>`

`E` defaults to `ConfigCodecError`; decorator codecs widen it. The `Yaml`
facade's static `parse` / `stringify` (both `Effect.fn`) already match that
shape, which is what makes this a one-file adapter — each direction is an
`Effect.mapError` wrapping `YamlParseError` / `YamlStringifyError` into
`ConfigCodecError({ codec, operation, cause })`.

## Error-mapping invariant

The underlying failure is preserved **structurally** in `cause` (typed
`Schema.Defect()`) — never stringified. `@effected/yaml`'s hardening (the
alias-expansion budget, the nesting-depth cap) fails through the typed error
channel, so a hostile config file surfaces as a `ConfigCodecError` carrying a
real `YamlParseError`, never a `Cause.Die` defect. The tests assert exactly
this; keep them honest.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run packages/config-file-yaml
pnpm build --filter @effected/config-file-yaml
```

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
clean gate.
