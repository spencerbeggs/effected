# @effected/config-file-toml

A single `ConfigCodec` adapter, `TomlCodec`, plugging `@effected/toml` into
`@effected/config-file`'s codec seam: TOML as configuration file content.

**Tier: pure.** Peer-depends on `@effected/config-file`, `@effected/toml` and
`effect`. Zero runtime dependencies, no IO. 2 `src/` files, 1 test file,
5 tests. Deliberately tiny — do not grow it.

**For the full design:** → `@../../.claude/design/effected/packages/config-file.md`

Load when changing the codec seam, the family's package boundaries, or the
adapter's error mapping.

## Why this is its own package

This monorepo **does not use subpath exports**. Every optional dependency of
`@effected/config-file` therefore becomes its own package rather than an
`exports` subpath.

## Why pure tier, despite depending on a boundary package

**Tier 2 does not propagate (R3).** This adapter depends on boundary-tier
`@effected/config-file`, but a boundary package's IO is discharged by the app's
platform layer at the edge, so a consumer pays no external install for it — the
dependency does not lift this package's tier. Its own surface does no IO either:
it wraps `parse` / `stringify` and never touches `FileSystem` (R4: tier follows a
package's own surface). This was gotten wrong once; do not re-derive it from the
dependency edge.

## Acyclicity: the codec lives here, not in `@effected/toml`

Dependency direction is strictly acyclic: **config-file → format packages,
never the reverse.** `@effected/toml` stays pure and unaware that config-file
exists. This adapter is the only thing that knows about both — that is its
whole reason to exist. Never add a config-file import to `@effected/toml`.

## The exported surface

`src/index.ts` re-exports exactly one binding, `TomlCodec`, from
`src/TomlCodec.ts`. Only `src/index.ts` re-exports; no barrel files.

`TomlCodec` is typed as `ConfigCodec`, whose interface (in
`@effected/config-file`, `src/ConfigCodec.ts`) is three readonly members:

- `name: string` — here, `"toml"`
- `parse: (raw: string) => Effect.Effect<unknown, E>`
- `stringify: (value: unknown) => Effect.Effect<string, E>`

`E` defaults to `ConfigCodecError`; decorator codecs widen it. The `Toml`
facade's static `parse` / `stringify` (both `Effect.fn`) already match that
shape, which is what makes this a one-file adapter — each direction is an
`Effect.mapError` wrapping `TomlParseError` / `TomlStringifyError` into
`ConfigCodecError({ codec, operation, cause })`.

Two value-model facts worth knowing at the seam: TOML date-times parse into
`@effected/toml`'s four date-time classes (never JS `Date`), and integers
beyond ±(2^53 − 1) parse into `bigint`. The seam is `unknown`, so neither
needs adapter handling — the consumer's config schema decides.

## Error-mapping invariant

The underlying failure is preserved **structurally** in `cause` (typed
`Schema.Defect()`) — never stringified. `@effected/toml`'s hardening (the
nesting-depth cap, enforced independently on both parse and stringify) fails
through the typed error channel, so a hostile config file surfaces as a
`ConfigCodecError` carrying a real `TomlParseError`, never a `Cause.Die`
defect. Unlike the yaml adapter, **stringify has a cheap genuine failure
case** — TOML has no null — pinned by a test asserting the structured
`TomlStringifyError` (`UnsupportedValue`) survives in `cause`. The tests
assert exactly this; keep them honest.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run packages/config-file-toml
pnpm build --filter @effected/config-file-toml
```

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
clean gate.
