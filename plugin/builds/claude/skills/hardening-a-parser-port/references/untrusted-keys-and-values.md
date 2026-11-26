# Untrusted keys and values

The guards for what a parse produces: keys that name `Object.prototype`
members, numeric options that compare false against everything, code points
past the Unicode maximum, and `JSON.parse` results that are valid and not
objects.

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

The guidance above is for objects **you** build. When untrusted records flow
through v4 `Schema.Record` instead, decode is already pollution-safe: a
`__proto__` key survives decoding as an ordinary **own data property** of the
output — it is neither dropped nor written to the prototype (a `__proto__`
pnpm importer in `@effected/lockfiles` decodes into an entry literally named
`__proto__` with `Object.prototype` unpolluted). Two consequences: don't
pre-filter such keys expecting decode to choke on them, and if you later copy a
decoded record by hand, that copy loop is a new `obj[key] = value` surface
needing the `defineProperty` route above.

## The read side needs no hostile key at all

`Schema.Record` decodes into a plain `{}` inheriting `Object.prototype`, so an
unguarded `obj[key]` read with an untrusted or caller-controlled `key` resolves
*inherited* members: `tags["constructor"]` returns a function, `"toString"`,
`"hasOwnProperty"` likewise — handed onward typed as your value type. Read
untrusted maps only through an ownership check:

```ts
// UNSOUND — returns Option.some(<Function>) for a manifest with no deps at all.
const dep = deps["constructor"];        // → a Function, off Object.prototype
if (dep !== undefined) return Option.some(dep);

// SOUND:
if (Object.hasOwn(deps, name)) return Option.some(deps[name]);
```

`({})["constructor"]` is a `Function`, while `Object.hasOwn({}, "constructor")`
is `false`. A method declared to return `Option<string>` therefore hands back an
`Option.some(<Function>)` — **unsound, not merely untidy**, and it type-checks
perfectly because the index signature promises a `string`. A version resolver
that looks up a dist-tag by an external name returns an inherited function as a
"version" for `resolveVersion(name, "constructor")`.

Apply the check at **every** indexed read of a decoded record, and sweep for the
one call site that skipped it: a port that guards its whole resolution
machinery can still ship one unguarded read. Keys enumerated by
`Object.keys`/`Object.entries` are own-only and safe; it is the *lookup by
external key* that must be guarded. Every key an attacker names (`constructor`,
`toString`, `valueOf`, `hasOwnProperty`) is a live hit, so pin it with a
hostile-ref test (`"constructor"`, `"__proto__"`, `"toString"`).

The tell: **every sibling predicate already uses `Object.hasOwn`** — an
inconsistency across a family of guards is a defect, not a style preference.
Grep the family, not the line.

## Numeric bound guards — `if (n < LIMIT)` silently admits `NaN` and non-integers

The guard on a **numeric option** (a `maxDepth`, a size cap, an iteration bound)
has an obvious spelling that is wrong in a way invisible to review and to a
green suite. `NaN < 1` is `false`, and so is `2.5 < 1` — every relational
comparison against `NaN` is `false`. So:

```ts
if (maxDepth < 1) return yield* Effect.die(...);   // NaN and 2.5 sail past
for (let depth = 0; depth < maxDepth; depth++) { ... }  // 0 < NaN is ALSO false
```

`maxDepth: NaN` skips the guard **and** runs the loop zero times, returning an
empty result — indistinguishable from a legitimate empty result, which is the
exact silent outcome the guard was written to forbid. A fractional bound
truncates at a non-integer instead of dying. These are the two inputs a caller
most plausibly passes by accident: an unparsed `Number(env.MAX_DEPTH)`, or a
computed average.

Guard integrality and range together:

```ts
if (!Number.isInteger(maxDepth) || maxDepth < 1) {
  return yield* Effect.die(new Error(`maxDepth must be a positive integer, received ${maxDepth}`));
}
```

Ship a test for `NaN` and one for a fractional value, each **watched failing
against the bare `< LIMIT` comparison** — a guard whose failure mode is
"returns empty" is untestable by inspection. And when you document the guard,
state the full predicate: prose that says "`maxDepth < 1` is a defect" invites
a reader to conclude `2.5` is accepted, and partial prose travels with a
partial guard.

## Range-check `String.fromCodePoint` fed by parsed hex — in formats that have wide escapes

**Scope this check to the format before you go looking.** It applies only where an
escape can denote a code point above the Unicode maximum `U+10FFFF`:

| format | widest escape | max value | check needed? |
| --- | --- | --- | --- |
| YAML | `\U00110000` (8 hex) | unbounded | **yes** |
| JSON / JSONC | `￿` (4 hex) | `0xFFFF` | **no** — structurally impossible |

A JSON-family scanner using `String.fromCharCode` on a 4-hex value is *already*
correct and needs no guard; `@effected/jsonc` is exactly this case. Do not go
hunting for a `fromCodePoint` range hazard in a format that cannot express one,
and do not flag its absence as a finding.

Where the format *does* have wide escapes, `String.fromCodePoint` throws a
`RangeError` that escapes as a defect. Validate before the call:

```ts
const cp = /* parse hex */;
if (cp <= 0x10ffff) value += String.fromCodePoint(cp);
else return makeErrorToken(/* … */); // typed error, not a throw
```

Guard **both** the lexer (which builds the scalar value inline and throws first,
mid-scan) and any composer re-decode of the same source.

## `JSON.parse` returns `null`, a number, or a string — for VALID JSON

A `=== undefined` guard after `JSON.parse` **never fires**. The four characters
`null` are a perfectly valid `package.json`, and they parse to `null`, not
`undefined`:

| input | `JSON.parse` → | caught by `=== undefined`? |
| --- | --- | --- |
| `null` | `null` (`typeof` `"object"`!) | **no** |
| `42` | `42` | **no** |
| `"hi"` | `"hi"` | **no** |
| `true` | `true` | **no** |

```ts
// WRONG — `parsed.name` throws a TypeError on `null`, escaping as a DEFECT.
const parsed = JSON.parse(text);
if (parsed === undefined) return yield* Effect.fail(new InvalidJson({ path }));

// RIGHT — reject anything that is not a non-null object.
if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
 return yield* Effect.fail(new InvalidShape({ path }));
}
```

`typeof null === "object"` is what makes the plausible guard
(`typeof parsed !== "object"`) insufficient on its own. Expect the wrong guard
in more than one place in a package: each is a property read that throws a
`TypeError` and escapes as an unhandled defect.
