# Yieldable values and the bridges for the ones that are not

What `yield*` accepts inside `Effect.gen`, why `Option` and `Result` die there,
and how to cross from each into an Effect.

## The upstream migration note is wrong about `Option` and `Result`

Effect's own migration note on yieldables (`migration/yieldable.md` in the
Effect repository) documents a `Yieldable` trait whose contract is
`asEffect(): Effect<A, E, R>`, lists `Option` and `Result` as implementors, and
states "the runtime calls `.asEffect()` internally when yielding". **The
`Option`/`Result` claim does not hold**: neither implements `asEffect`, and
`typeof Option.some(1).asEffect` is `undefined`. `asEffect` itself does exist
in core (`Effectable.ts` — an opt-in base class and mixin a domain type can
extend to become yieldable), but `Option` and `Result` are not built on it.
The source settles it; the note has gone stale on this one claim.

## What yields

Directly yieldable — **all five rows probed**, against two controls:
a positive `Effect.succeed` that yielded, and a discriminating `Option.some(7)`
that died, proving the harness could observe a failure to yield at all:

| Value | `yield*` inside `Effect.gen` |
| --- | --- |
| `Effect` | works |
| `Config` | works — it **is** an `Effect` (`Config<T> extends Effect<T, ConfigError>`, `Config.ts:116`) |
| any `Context.Service` | works |
| `Option` | **dies as a defect** |
| `Result` | **dies as a defect** |

**`Option` and `Result` are both off the list, and both die the same way.**
`yield* Option.some(7)` exits `Failure` with
`Die("Fiber.runLoop: Not a valid effect: some(7)")`; `Option.none()`,
`Result.succeed(42)` and `Result.fail("boom")` die identically: `yield*
Result.succeed(42)` dies
`"Fiber.runLoop: Not a valid effect: success(42)"`, against an
`Effect.succeed` control that returned normally. Note the **success**
cases die too: this is not "errors need a bridge", it is "these are not Effects
at all". Their `[Symbol.iterator]` yields the value itself, and the fiber loop
rejects anything carrying no `evaluate` (`internal/effect.ts:739`).

## The bridges

The bridge is a module function on `Effect`, one per type:

```ts
const u = yield* Effect.fromOption(maybeUser)              // Effect.ts:1997 — fails NoSuchElementError
const v = yield* Effect.fromResult(Fmt.parseResult(text))  // Effect.ts:1955 — fails typed with the Result's E
```

`Effect.fromOption` takes an optional second argument for the failure
(`Effect.fromOption(maybeUser, () => new UserMissing())`), so the
`NoSuchElementError` default is not something you have to live with.

To hand an `Option` or a `Result` to a data-first combinator, go through the
same bridge — or just stay in a generator:

```ts
Effect.map(Effect.fromOption(Option.some(42)), (n) => n + 1)
```

## Reading a `Result` outside an Effect

Narrow with `Result.isSuccess` / `Result.isFailure`, then read the value off
**`.success` / `.failure`** — not `.value`:

```ts
const r = Fmt.parseResult(text)
if (Result.isSuccess(r)) use(r.success)   // NOT r.value — undefined, silently
else report(r.failure)                    // NOT r.left / r.right — there is no Either
```

The `Success` variant carries `.success` and the `Failure` variant `.failure`
(`Result.ts:166,102`); there is no `.value`, and no `.right` / `.left`. A read
through `.value` compiles against `unknown` in a loose context and returns
`undefined` at runtime with no error.

## No longer yieldable: call the module function

```ts
const n = yield* Ref.get(ref)          // NOT yield* ref
const v = yield* Deferred.await(deferred) // NOT yield* deferred
const r = yield* Fiber.join(fiber)     // NOT yield* fiber  (Fiber is not an Effect)
```

## `Config` needs no bridge

`Config<T>` extends `Effect<T, ConfigError>` (`Config.ts:116`), so it pipes
straight into the combinators, and there is no `Effect.fromConfig` to reach
for:

```ts
Config.String("PORT").pipe(Effect.catchTag("ConfigError", () => Effect.succeed("8080")))
```

That `Config` sits beside `Option` in every "yieldable" list ever written — and
yet needs the opposite treatment — is exactly what makes the pair a trap: the
one that looks like it needs converting does not, and the one that looks
interchangeable with it dies.
