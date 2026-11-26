# Config inputs — structured values, defaults and empty strings

How `Config` reads a structured or JSON-string input, what `withDefault` and
`Config.option` do and do not absorb, and how to swap the provider.

## `ConfigError` lives on `Config`, not the root

`ConfigError` is not on the `effect` root. It is `Config.ConfigError`;
importing it from `"effect"` yields `undefined`, and a `catchTag` against that
silently never matches.

## `Config.option` still carries a `ConfigError`

It turns a *missing key* into `Option.none()`, but a **provider-source failure
survives** — a present, unparseable value still fails. It is not
`Effect<Option<A>, never>`, and a test that only exercises the absent-key path
will "prove" that it is.

## A structured input is `Config.schema`

A structured input is `Config.schema(codec, "NAME")` (`Config.ts:867`), and a
JSON-string input is `Config.schema(Schema.fromJsonString(S), "NAME")` — not
`Config.String` + `JSON.parse` + `decodeUnknown*`, which re-derives the codec by
hand and puts a throwing host call in the seam.

## `withDefault` covers absent data only

`withDefault` replaces an `Absent` resolution and leaves every other error in
the channel (`Config.ts:506`). Probed under `ConfigProvider.fromEnv` with:

```ts
Config.schema(Schema.fromJsonString(Struct({ a: Number })), "INPUT_PAYLOAD")
  .pipe(Config.withDefault({ a: -1 }))
```

| `INPUT_PAYLOAD` | Result |
| --- | --- |
| unset | the default |
| `""` | the default |
| `"{nope"` | typed `ConfigError`, not swallowed by the default |
| `'{"a":"str"}'` | typed `ConfigError`, not swallowed by the default |

The `""` case is the provider's doing, not the schema's — `fromEnv` /
`fromEnvRecord` / `fromUnknown` map an empty string to *missing* unless
`{ preserveEmptyStrings: true }` (`ConfigProvider.ts:798`), and with that flag
set the same `""` is present-but-malformed and fails. That is exactly the
contract a GitHub Actions input needs — the runner exports an unset input as
`INPUT_NAME=""` — and a hand-rolled parse has to re-invent it.

## Overriding the config provider is ordinary service provision

There is no `Effect.withConfigProvider`; `ConfigProvider.ConfigProvider` is
itself a `Context.Reference` (`ConfigProvider.ts:351`), so swap it with
`Effect.provideService(effect, ConfigProvider.ConfigProvider, provider)`. Reach
for a combinator name instead and you get `undefined is not a function` at the
call site — which reads like a bad import, not a missing API.
