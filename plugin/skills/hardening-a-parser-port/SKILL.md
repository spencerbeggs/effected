---
name: hardening-a-parser-port
description: Use when porting or writing a recursive-descent parser, lexer, or tree-walker over untrusted text in the @effected monorepo — the class of hardening the cloud reviewer scans for on every migration. Covers stack-overflow depth guards (on EVERY recursion surface, which a facade has N of — not two), numeric bound guards that must reject NaN and non-integers, code-point range checks scoped to formats with wide escapes, prototype-pollution, control-character rejection, and the invariant that malformed input must fail through the typed error channel, never as an unhandled defect.
---

# Hardening a parser port

A pure parser takes untrusted strings in and must produce values or *typed
domain errors* — never a crash, never an unhandled Effect defect. These are
the recurring hardening items the cloud reviewer re-derives against source on
every `@effected` parser migration (jsonc, yaml, and the boundary-tier ports
to come). Write each guard together with its hostile-input regression test; a
hardening claim without a test is unverified.

## No unbounded recursion — enumerate every recursion surface, then close each

Any recursive descent over untrusted input needs a depth cap, or deeply-nested
input throws `RangeError: Maximum call stack size exceeded` as a defect that
escapes the typed channel.

**Enumerate the surfaces before you guard any of them.** A *recursion surface* is
any function that re-enters itself over user-controlled structure. A package's
public facade with N recursive helpers has **N surfaces, not two** — and they do
not share a cap just because they share a tree. Grep for self-recursion across
`src/`, list what you find, and close every entry on the list. The two-stage
CST/composer pipeline below is **one instance of this rule, not the frame**.

`@effected/jsonc` is the worked example: an *iterative* scanner and a
single-stage recursive-descent parser, yet **six** independent surfaces, each of
which overflowed the stack on `"[".repeat(20000) + "]".repeat(20000)` before it
was closed:

| # | surface | closed by |
| --- | --- | --- |
| 1 | `internal/parser.ts` value mode (`parseValue`→`parseArray`/`parseObject`) | cap |
| 2 | `internal/parser.ts` tree mode (`parseValueTree`→`…Tree`) | cap |
| 3 | `JsoncNode.evaluateNode` (backs `toValue`) | cap |
| 4 | `JsoncVisitor.visitGen` | cap |
| 5 | `Jsonc.deepEqual` | cap |
| 6 | `internal/navigate.skipValue` | **rewritten iteratively** |

Two remedies, and the second is often the better one:

- **Cap it** at `MAX_NESTING_DEPTH`; on exhaustion emit a single fatal diagnostic
  and return a leaf placeholder instead of recursing. Pair `enter`/`exit` in
  `try/finally` at every collection entry.
- **Remove the recursion.** `navigate.skipValue` skips a value by counting
  bracket depth over the flat token stream (`navigate.ts:85`). Being
  non-recursive it *cannot* overflow, so `navigate` and `JsoncModifier` need no
  cap — and no test can regress one they don't have. Prefer this wherever the
  walk is a skip or a scan rather than a transform.

Then, whichever remedy:

- **Measure the real overflow point and set the cap with wide margin.** Do not
  guess — a multi-frame recursion chain overflows far shallower than "levels of
  nesting" suggests (yaml overflowed at ~900 composer levels because each level
  is several stack frames; the cap is 256).
- Emit ONE fatal diagnostic (`e.code === "NestingDepthExceeded"` deduped), not
  one per level.
- **Paired codec directions must count depth in the same units — container
  descent, never leaves.** toml's parse guarded at the opening bracket only
  (scalar leaves unchecked) while its stringify guarded at the top of every
  node, leaves included: a document at exactly the cap with a **non-empty**
  innermost element parsed but failed to re-emit — a typed failure both ways,
  so nothing defected, but the round-trip broke at the exact boundary and the
  "same cap on both sides" claim in the docs was quietly false. Neither a
  679-case compliance corpus nor a differential oracle caught it, because the
  only fixture at the bound had an *empty* innermost container (no leaf to
  reach the phantom extra level). The fix and the regression discipline: hoist
  guards into the container branches on both directions, and pin a round-trip
  test at exactly the cap with a non-empty innermost value
  (effected PR #31 review; fix `ecc5f1a4`).

### The two-stage pipeline is a special case

In a two-stage `lex → build-tree → walk-tree` pipeline (yaml's CST parser then
composer), the two surfaces are *coupled*, so their caps are chosen together:

- Cap the **tree-walker** (composer) at `MAX_NESTING_DEPTH` (yaml: 256).
- Cap the **tree-builder** (CST parser) slightly ABOVE it (yaml: 264), so the
  walker's user-facing diagnostic fires first when the capped tree is walked; the
  builder's guard is the backstop that keeps tree *construction* from overflowing.

Where a post-hoc walker instead runs over an **already-bounded** tree (jsonc's
`evaluateNode`, `deepEqual`), **equal** caps are correct — the builder's output can
never exceed the walker's cap, so the walker's guard fires only on a hand-built
tree. Do not mis-flag equal caps as a defect in that shape, and do not demand a
+8 offset where the two surfaces are independent rather than chained.

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

Guard integrality and range together, and prove it:

```ts
if (!Number.isInteger(maxDepth) || maxDepth < 1) {
  return yield* Effect.die(new Error(`maxDepth must be a positive integer, received ${maxDepth}`));
}
```

Ship a test for `NaN` and one for a fractional value, each **watched failing
against the bare `< LIMIT` comparison** — a guard whose failure mode is
"returns empty" is untestable by inspection. And when you document the guard,
state the full predicate: prose that says "`maxDepth < 1` is a defect" invites
a reader to conclude `2.5` is accepted (this exact partial documentation
shipped alongside the partial guard in `@effected/walker` before both were
fixed).

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
output — it is neither dropped nor written to the prototype (probed beta.94 in
the `@effected/lockfiles` hostility suite: a `__proto__` pnpm importer decodes
into an entry literally named `__proto__` with `Object.prototype` unpolluted).
Two consequences: don't pre-filter such keys expecting decode to choke on
them, and if you later copy a decoded record by hand, that copy loop is a new
`obj[key] = value` surface needing the `defineProperty` route above.

**The read side is a separate hazard, and it needs no hostile key at all.**
`Schema.Record` decodes into a plain `{}` inheriting `Object.prototype`, so an
unguarded `obj[key]` read with an untrusted or caller-controlled `key` resolves
*inherited* members: `tags["constructor"]` returns a function, `"toString"`,
`"hasOwnProperty"` likewise — handed onward typed as your value type. Read
untrusted maps only through an ownership check:

```ts
const value = Object.hasOwn(map, key) ? map[key] : undefined;
```

Apply it at **every** indexed read of a decoded record, and sweep for the one
call site that skipped it — the ts-vfs port guarded its whole resolution
machinery and still shipped one unguarded read (`resolveVersion`'s dist-tag
lookup), where `resolveVersion(name, "constructor")` genuinely returned an
inherited function as a "version" until the PR #67 review caught it. Keys
enumerated by `Object.keys`/`Object.entries` are own-only and safe; it is the
*lookup by external key* that must be guarded. Pin it with a hostile-ref test
(`"constructor"`, `"__proto__"`, `"toString"`).

## Test membership with `Object.hasOwn`, never bracket notation

The write path is only half of it. **Reading** a key off a parsed record with
bracket notation inherits from `Object.prototype`:

```ts
// UNSOUND — returns Option.some(<Function>) for a manifest with no deps at all.
const dep = deps["constructor"];        // → a Function, off Object.prototype
if (dep !== undefined) return Option.some(dep);

// SOUND:
if (Object.hasOwn(deps, name)) return Option.some(deps[name]);
```

Verified: `({})["constructor"]` is a `Function`, while
`Object.hasOwn({}, "constructor")` is `false`. A method declared to return
`Option<string>` therefore handed back an `Option.some(<Function>)` — **unsound,
not merely untidy**, and it type-checks perfectly because the index signature
promises a `string`.

Every key an attacker names (`constructor`, `toString`, `valueOf`, `hasOwnProperty`)
is a live hit. The tell in the real case: **every sibling predicate already used
`Object.hasOwn`** — an inconsistency across a family of guards is a defect, not a
style preference. Grep the family, not the line.

## Reject unescaped C0 control characters

Raw control characters below `0x20` (except tab `0x09`, LF `0x0a`, CR `0x0d`)
are not printable per most text-format specs (YAML 1.2 §5.1, JSON §7). Scan the
document's raw span once and emit a fatal diagnostic; escaped forms in
quoted scalars never appear raw in the source, so scanning source text is
sufficient.

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

This was live in **three** places in one package, each throwing a `TypeError` on
a property read — malformed input escaping as an **unhandled defect**, which is
precisely the invariant below. `typeof null === "object"` is what makes the
plausible guard (`typeof parsed !== "object"`) insufficient on its own.

## Path bases: `git diff --name-only` is REPO-relative, `git ls-files` is CWD-relative

Probed in a scratch repo, both commands run from the subdirectory `pkgs/alpha`,
with the **same file** modified:

| command | printed |
| --- | --- |
| `git ls-files` | `nested.txt` — relative to the **cwd** |
| `git diff --name-only` | `pkgs/alpha/nested.txt` — relative to the **repo top-level** |

One file, two spellings. Put both in a `Set` and it holds two entries; compare
them and nothing matches.

**Normalize each result from its OWN base — never from a single assumed one.**

```ts
// WRONG — resolving ls-files against the repo root yields <root>/nested.txt,
// a path that does not exist. This IS the bug.
resolve(repoRoot, p);

// RIGHT — each command's output resolved against the base it actually used:
const fromLsFiles = resolve(cwdTheCommandRanIn, p);   // cwd-relative
const fromDiff    = resolve(repoTopLevel, p);         // repo-relative
```

`git rev-parse --show-toplevel` gives the repo base; `--show-prefix` gives the
cwd's offset from it. Simplest of all, make `ls-files` agree with `diff` at the
source: **`git ls-files --full-name`** prints repo-relative paths (verified — it
returned `pkgs/alpha/nested.txt`).

Two further asymmetries the probe exposed, both easy to miss: `ls-files` is also
**scoped** to the cwd (it listed only files under `pkgs/alpha`), while
`diff --name-only` reports the **whole repo** — so the two commands do not even
cover the same set of files.

The generalizable rule, which is the reusable part:

> **When combining the output of two commands, never assume they share a path
> base. Verify each one's base independently.** Mixing bases is *silently
> correct* whenever the two happen to coincide — which is the common case, and
> the one your tests will cover.

That last clause is the testing consequence: **a fixture where the workspace root
and the git root coincide cannot distinguish the correct implementation from the
broken one.** Any test for path-base handling must place the workspace root
*below* the git root, or it proves nothing.

## Structurally indistinguishable parses: position is the only sound discriminator

pnpm 11 writes a **two-document** `pnpm-lock.yaml` under `configDependencies`.
No *structural* rule can pick the right document: both carry `lockfileVersion`,
`importers` and `packages`, and the preamble validates cleanly against the same
schema. A "pick the document that looks like a lockfile" heuristic selects the
wrong one and reports success.

**POSITION is the only sound discriminator** — the real lockfile is the last (or
the nth) document, by the format's own framing rule. Which is exactly why the bug
was silent: a structural heuristic *did* find a valid-looking answer.

Generalize it:

> When two candidate parses are structurally indistinguishable, a structural
> heuristic is not a rule — it is a coin flip that happens to land right on your
> fixtures. Discriminate on the framing (position, document index, an explicit
> marker), and make the choice explicit in the code.

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

It re-derives each claim against source: **every** recursion surface enumerated
and then either capped (paired `enter`/`exit` in `try/finally`) or provably
non-recursive; the `0x10FFFF` bound before `fromCodePoint` *in formats with wide
escapes*; the `defineProperty` route for `__proto__`; the C0 scan. Ship the guard
AND its hostile-input test in the same commit, or the claim reads as unverified.

Two ways this check goes wrong in both directions. Guarding only the surfaces the
two-stage frame predicts leaves the rest of the facade — `toValue`, `equals`,
`visit`, `modify` — overflowing on the same input. Demanding a guard on a surface
whose format or control flow cannot reach it manufactures a finding. Enumerate,
then judge each surface on its own.
