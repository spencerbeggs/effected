# @effected/config-file-jsonc

A `ConfigCodec` adapter plugging `@effected/jsonc` into `@effected/config-file`'s
codec seam, so config files may be JSON with comments and trailing commas. Two
source files. Deliberately tiny — resist the urge to grow it.

**Design doc:** `@./.claude/design/effected/packages/config-file.md` — load when
changing the codec seam or the family's dependency shape. This package has none
of its own.

## Tier

**Pure.** Peer-depends on `@effected/config-file`, `@effected/jsonc` and
`effect`; zero runtime dependencies. All three edges are peers so the consumer's
graph holds one `ConfigCodec` interface identity and one format-package instance.

Pure **despite** its only consumer being boundary tier: tier follows a package's
own surface, not its neighbours'. An adapter performs no IO — it wraps `parse` /
`stringify` and never touches `FileSystem`. This has been gotten wrong once.

## Why a separate package

This monorepo **does not use subpath exports**, so every optional dependency of
`@effected/config-file` becomes its own package rather than an `exports` subpath.

Dependency direction is strictly acyclic: **config-file → format packages, never
the reverse.** `@effected/jsonc` stays pure and unaware of config-file; this
adapter is the only module that knows about both. Never add a config-file import
to a format package to shortcut this.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `JsoncCodec` — from `src/JsoncCodec.ts`

That is the entire surface. `JsoncCodec` is a `ConfigCodec` value, not a class:

```ts
interface ConfigCodec<E = ConfigCodecError> {
  readonly name: string;
  readonly parse: (raw: string) => Effect.Effect<unknown, E>;
  readonly stringify: (value: unknown) => Effect.Effect<string, E>;
}
```

No `R` channel on either direction — that absence *is* the purity proof.

## Conventions specific to this package

- **`name` is `"jsonc"`.** Both directions wrap failures as `ConfigCodecError`
  (`{ codec, operation, cause }`), preserving the underlying failure
  **structurally** in `cause` — never stringified.
- **Parse failures go through the typed channel, never a defect.** Hostile input
  (deep nesting) must `Cause.hasFails`, not `Cause.hasDies`.
- **`stringify` calls `JSON.stringify` directly** — `@effected/jsonc` exposes no
  `stringify` — so it is byte-identical to `ConfigCodec.json.stringify` and
  comments never survive a round trip. `JsoncEdit` / `JsoncModifier` cannot help:
  they need the original source text, while the `stringify` seam is stateless.
  Comment-preserving writes need a seam change in `@effected/config-file`.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` —
never `expect`. One file, `__test__/JsoncCodec.test.ts`, 5 tests.

```bash
pnpm vitest run packages/config-file-jsonc/__test__/JsoncCodec.test.ts
pnpm build --filter @effected/config-file-jsonc   # from the repo root
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
clean gate.
