---
name: hardening-a-parser-port
description: Use when porting or writing a recursive-descent parser, lexer, or tree-walker over untrusted text in the @effected monorepo — the class of hardening the cloud reviewer scans for on every migration. Covers stack-overflow depth guards (on EVERY recursion surface, which a facade has N of — not two), numeric bound guards that must reject NaN and non-integers, code-point range checks scoped to formats with wide escapes, prototype-pollution, control-character rejection, and the invariant that malformed input must fail through the typed error channel, never as an unhandled defect.
---

# Hardening a parser port

A pure parser takes untrusted strings in and must produce values or *typed
domain errors* — never a crash, never an unhandled Effect defect. These are the
hardening items a reviewer re-derives against source on every parser port.
Write each guard together with its hostile-input regression test; a hardening
claim without a test is unverified.

## The invariant that ties it together

> Malformed input fails through the documented typed error channel
> (`Effect<_, DomainError>`), NEVER as an unhandled defect.

Any `throw` inside the engine that the facade does not catch-and-materialize is
a defect leak: the engine *returns* an error record or token, and where a throw
is unavoidable on a hot path the facade `Effect.try({ catch })`s a dedicated
internal error class into the domain error. Prove it with `Effect.flip` (the
error's `_tag`) or `Effect.result`, never a `try/catch` around `Effect.runSync`.

**The invariant governs input, not callbacks.** A `throw` from a caller's
callback that already has an `Effect` error channel (a migration's `up`, a
`validate` hook) is a programmer bug and stays a defect; never `try/catch` it
into a typed error. Before you wrap a callback, a hook or a host function in
`Effect.try`, load [typed-channel.md](references/typed-channel.md): wrapping the
wrong one makes a consumer's `catchTag` swallow their own null-deref, and the
table there decides it by whether the callback's result is used.

## No unbounded recursion — enumerate every recursion surface, then close each

Any recursive descent over untrusted input needs a depth cap, or deeply-nested
input throws `RangeError: Maximum call stack size exceeded` as a defect that
escapes the typed channel.

**Enumerate the surfaces before you guard any of them.** A *recursion surface* is
any function that re-enters itself over user-controlled structure. A package's
public facade with N recursive helpers has **N surfaces, not two** — and they do
not share a cap just because they share a tree. Grep for self-recursion across
`src/`, list what you find, and close every entry on the list: `toValue`,
`equals`, `visit` and `modify` overflow on the same input as the parser.

Two remedies, and the second is often the better one:

- **Cap it** at `MAX_NESTING_DEPTH`; on exhaustion emit a single fatal diagnostic
  and return a leaf placeholder instead of recursing. Pair `enter`/`exit` in
  `try/finally` at every collection entry.
- **Remove the recursion.** `navigate.skipValue` skips a value by counting
  bracket depth over the flat token stream (`navigate.ts:155`). Being
  non-recursive it *cannot* overflow, so `navigate` and `JsoncModifier` need no
  cap — and no test can regress one they don't have. Prefer this wherever the
  walk is a skip or a scan rather than a transform.

Then, whichever remedy:

- **Measure the real overflow point and set the cap with wide margin.** A
  multi-frame chain overflows far shallower than its nesting depth suggests.
- Emit ONE fatal diagnostic (`e.code === "NestingDepthExceeded"` deduped), not
  one per level.
- **Paired codec directions count depth in the same units — container descent,
  never leaves** — and a round-trip test at exactly the cap needs a non-empty
  innermost value, or it cannot see the mismatch.
- **In a two-stage `lex → build-tree → walk-tree` pipeline, cap the builder
  slightly above the walker**; over an already-bounded tree, equal caps are
  correct.

**Depth caps close only the stack.** Superlinear time on small, flat input
(nested emphasis, unmatched openers, alias bombs) needs the faithful algorithm,
not a limit constant, unless the spec itself sanctions the limit. A green
conformance corpus says nothing about complexity.

Before you choose a cap, port a grammar with delimiter runs, links or aliases,
or declare an engine hardened, load
[recursion-and-complexity.md](references/recursion-and-complexity.md): it has
the six-surface worked example, the coupled-cap rule, the spec-sanctioned-limit
discriminator and how to run a pathological corpus without its budgets going
silently stale. An engine can pass every conformance example and still hang on
twenty repeated bytes.

## Untrusted keys and values

- **Write a parsed `__proto__` key as an own data property** with
  `Object.defineProperty`, at the single value-extraction choke point. v4
  `Schema.Record` decode is already pollution-safe; a hand-written copy of its
  output is a new write surface.
- **Read a decoded record by an external key only through `Object.hasOwn`.**
  `deps["constructor"]` is a `Function` off `Object.prototype` and type-checks as
  your value type. Grep the whole family of lookups, not the one line.
- **Guard a numeric option's integrality and range together:**
  `!Number.isInteger(n) || n < 1`. `if (n < LIMIT)` admits `NaN` (and then a loop
  runs zero times and returns empty) and `2.5`. Test both, watched failing.
- **Range-check `String.fromCodePoint` against `0x10FFFF`** only in a format whose
  escapes can exceed it (YAML's 8-hex `\U`); a 4-hex JSON escape cannot, so do not
  flag its absence there.
- **Reject raw C0 control characters** below `0x20` except tab, LF and CR (YAML
  1.2 §5.1, JSON §7): scan the document's raw span once and emit a fatal
  diagnostic. Escaped forms never appear raw, so scanning source text is enough.
- **After `JSON.parse`, reject anything that is not a non-null, non-array
  object.** Valid JSON parses to `null`, numbers and strings, and
  `=== undefined` never fires.

Before you build an object from parsed pairs, index a decoded record, or guard
a numeric option, load
[untrusted-keys-and-values.md](references/untrusted-keys-and-values.md): each
guard's obvious spelling passes review and a green suite, and the reference has
the sound spelling and the hostile test that proves it.

## Strings, paths and regexps built from input

- **Never assume two commands share a path base**: `git ls-files` is
  cwd-relative and cwd-scoped, `git diff --name-only` is repo-relative and
  repo-wide. Test with the workspace root *below* the git root.
- **When two parses are structurally indistinguishable, choose by framing**
  (position, document index), never by which one looks right.
- **Force a `RegExp` built from input to compile inside the typed catch**, on a
  one-byte and a two-byte subject, or "Regular expression too large" escapes on
  the first `exec` as a defect.
- **Substitute untrusted text with `split`/`join`**, never a string replacement,
  which reads `$&` and its siblings as patterns.
- **Match joined text, never `raw` spans**, in a format that deletes line
  continuations before it tokenizes.

Before you combine two commands' paths, pick one of several parsed documents,
compile a pattern from input, substitute into a template, or write a guard over
shell or another format's tokens, load
[strings-paths-and-regexps.md](references/strings-paths-and-regexps.md): every
one of these is silently correct on the common fixture and wrong on the input
that matters.

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

## Additional resources

- [references/typed-channel.md](references/typed-channel.md) — the engine/facade split that keeps throws out of the typed channel, the test shapes, and the callback rule with its result-used table and the `Effect.suspend` construction trap. Load when: deciding whether a throw becomes a typed error or stays a defect, wrapping a user callback or a host function, or testing that hostile input fails typed.
- [references/recursion-and-complexity.md](references/recursion-and-complexity.md) — the six-surface jsonc example, measuring a cap, paired codec units, coupled caps in a two-stage pipeline, and the time and memory vectors with the pathological-corpus discipline. Load when: guarding a recursive parser, walker or codec, choosing a depth cap, porting Markdown or any grammar with delimiter runs or aliases, or writing a complexity regression suite.
- [references/untrusted-keys-and-values.md](references/untrusted-keys-and-values.md) — `__proto__` writes, `Object.hasOwn` reads, `Schema.Record`'s decode behaviour, `NaN`-safe numeric guards, the `fromCodePoint` scope table and the `JSON.parse` result table. Load when: building an object from parsed pairs, indexing a decoded record by a caller's key, validating a numeric option, decoding escapes, or reading `JSON.parse` output.
- [references/strings-paths-and-regexps.md](references/strings-paths-and-regexps.md) — git path bases, framing-based document choice, forcing a `RegExp` compile, `$`-pattern-free substitution, and continuation-aware matching over shell tokens. Load when: combining two commands' file lists, picking a document from a multi-document file, compiling a pattern from input, substituting into a template, or writing a guard over parsed shell.
