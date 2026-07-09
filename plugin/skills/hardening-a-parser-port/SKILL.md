---
name: hardening-a-parser-port
description: Use when porting or writing a recursive-descent parser, lexer, or tree-walker over untrusted text in the @effected monorepo — the class of hardening the cloud reviewer scans for on every migration. Covers stack-overflow depth guards (in BOTH pipeline stages), code-point range checks, prototype-pollution, control-character rejection, and the invariant that malformed input must fail through the typed error channel, never as an unhandled defect.
---

# Hardening a parser port

A pure parser takes untrusted strings in and must produce values or *typed
domain errors* — never a crash, never an unhandled Effect defect. These are
the recurring hardening items the cloud reviewer re-derives against source on
every `@effected` parser migration (jsonc, yaml, and the boundary-tier ports
to come). Write each guard together with its hostile-input regression test; a
hardening claim without a test is unverified.

## No unbounded recursion — guard BOTH pipeline stages

Any recursive descent over untrusted input needs a depth cap, or deeply-nested
input throws `RangeError: Maximum call stack size exceeded` as a defect that
escapes the typed channel.

In a two-stage `lex → build-tree → walk-tree` pipeline (CST parser then
composer, or scanner then evaluator), **both** recursive stages need a guard:

- Cap the **tree-walker** (composer) at `MAX_NESTING_DEPTH`; on exhaustion push
  a single fatal diagnostic and return a leaf placeholder instead of recursing.
  Pair `enter`/`exit` in `try/finally` at every collection-composer entry.
- Cap the **tree-builder** (CST parser) slightly ABOVE the walker's cap, so the
  walker's user-facing diagnostic fires first when the capped tree is walked;
  the builder's guard is the backstop that keeps tree *construction* from
  overflowing.
- **Measure the real overflow point and set the cap with wide margin.** Do not
  guess — a multi-frame recursion chain overflows far shallower than "levels of
  nesting" suggests (yaml overflowed at ~900 composer levels because each level
  is several stack frames; the cap is 256, the CST cap 264).
- Emit ONE fatal diagnostic (`e.code === "NestingDepthExceeded"` deduped), not
  one per level.

**Single-stage recursive-descent parsers need only one cap.** The two-stage rule
above is for a `lex → build-tree → walk-tree` pipeline (yaml's CST + composer). A
parser with an *iterative* scanner and a single recursive build stage (jsonc) has
one recursive build surface — cap it once. Guard any independent post-hoc walker
over the already-bounded tree separately; **equal** caps are fine there, because
the builder's output can never exceed the walker's cap, so the walker's guard only
fires on a hand-built tree. Do not mis-flag equal caps as a defect in that shape.

## Range-check every `String.fromCodePoint` / `fromCharCode` fed by parsed hex

An escape like `\U00110000` (8 hex digits) can denote a code point above the
Unicode maximum `U+10FFFF`; `String.fromCodePoint` throws a `RangeError` that
escapes as a defect. Validate before the call:

```ts
const cp = /* parse hex */;
if (cp <= 0x10ffff) value += String.fromCodePoint(cp);
else return makeErrorToken(/* … */); // typed error, not a throw
```

Guard **both** the lexer (which builds the scalar value inline and throws
first, mid-scan) and any composer re-decode of the same source. 4-hex-digit
`\u` escapes max out at `0xFFFF` and are always safe; only the wide forms need
the check.

## `__proto__` and special keys → own data properties

When building an object from parsed key/value pairs, a bare `obj[key] = value`
mutates the prototype for `key === "__proto__"`. Route keys through
`Object.defineProperty`, matching `JSON.parse` semantics:

```ts
if (key === "__proto__") {
 Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
} else {
 obj[key] = value;
}
```

Do this at the single value-extraction choke point (`Node.toValue`), so both
the value path and any tree-walker share it.

## Reject unescaped C0 control characters

Raw control characters below `0x20` (except tab `0x09`, LF `0x0a`, CR `0x0d`)
are not printable per most text-format specs (YAML 1.2 §5.1, JSON §7). Scan the
document's raw span once and emit a fatal diagnostic; escaped forms in
quoted scalars never appear raw in the source, so scanning source text is
sufficient.

## The invariant that ties it together

> Malformed input fails through the documented typed error channel
> (`Effect<_, DomainError>`), NEVER as an unhandled defect.

Any `throw` inside the engine that the facade does not catch-and-materialize
is a defect leak. The cycle-firewall design already keeps the engine
facade-free (it emits raw records; the facade builds the typed error), so the
engine's job is to *return* an error record or error token, not throw. Where a
throw is unavoidable on a hot path (e.g. a circular-reference guard), throw a
dedicated internal error class and have the facade `Effect.try({ catch })` it
into the domain error.

Test it the right way (v4):

```ts
const error = yield* Effect.flip(Yaml.parse(hostileInput));
assert.strictEqual(error._tag, "YamlParseError");        // typed, not a defect
// or, to prove it is not a defect at all:
const r = yield* Effect.result(Yaml.parse(hostileInput)); // never throws
assert.strictEqual(r._tag, "Failure");
```

A `try/catch` around `Effect.runSync` that catches a `RangeError` is the smell
this skill exists to eliminate — that is a defect that reached the caller.

### Scope: this governs INPUT, not caller-supplied callbacks

The invariant is about **data crossing the boundary**. It does **not** extend to
callbacks the caller hands you that already declare an `Effect` error channel —
a migration step's `up: (raw) => Effect<unknown, E>`, a `validate` hook, a
`VersionAccess.get`. Those are *producers* with a typed channel of their own.

**A `throw` from one of them is a contract violation — a programmer bug, not a
data condition — and must stay a defect.** Do not `try/catch` a user callback
into a typed error. If you do, the consumer's `catchTag("MigrationError")`
silently swallows their own null-deref and carries on with a half-migrated
config. Effect's defect/failure split exists precisely to keep those apart, and
the library cannot tell a typo from a data condition — which is why the *author*
declares intent by calling `Effect.fail`.

The distinction that decides it: **does the callback's result participate in the
operation's result?**

| callback | result used? | a `throw` should be |
| --- | --- | --- |
| `options.validate` — its return value is handed back to the caller | yes | a **defect** |
| a migration's `up` — its output becomes the config | yes | a **defect** |
| an `emit` / observability hook — result discarded (`Effect<void>`) | no | **absorbed** (`Effect.catchDefect`), and logged |

`Effect.try` / `Effect.tryPromise` around a *host* function stays correct —
`JSON.parse`, `crypto.subtle.decrypt`, `fs.readFileString`. Those have no channel
but a throw or a rejection. That is not analogous to a callback that has one and
declined to use it.

One more trap: guarding only the *synchronous construction* of a callback's
effect catches the least idiomatic way to write it. `Effect.suspend(run)`
normalizes a construction-time throw into the same defect channel as a throw
inside `Effect.sync` or `Effect.gen`, so all shapes behave identically. Anything
narrower routes the same bug to the typed channel or the defect channel
depending on an invisible detail of how the caller built their effect.

## How the reviewer checks

It re-derives each claim against source: depth guards paired in `try/finally`
with the CST cap above the composer cap, the `0x10FFFF` bound before
`fromCodePoint`, the `defineProperty` route for `__proto__`, the C0 scan. Ship
the guard AND its hostile-input test in the same commit, or the claim reads as
unverified.
