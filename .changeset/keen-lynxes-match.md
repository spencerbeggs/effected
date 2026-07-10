---
"@effected/glob": minor
---

## Features

Initial release of `@effected/glob` — the complete minimatch dialect as pure Effect schemas: extglobs, `{a,b}` braces, character classes including POSIX classes, true `**` globstar and negation, compiled to pure string predicates. The engine is vendored with attribution (minimatch 10.2.5, brace-expansion 5.0.7, balanced-match 4.0.4) and hardened, so the package carries zero runtime dependencies beyond the `effect` peer and performs no IO:

```ts
import { GlobPattern, GlobSet } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pattern = yield* GlobPattern.compile("packages/**");
  pattern.matches("packages/core/src"); // true — globstar is real

  const set = yield* GlobSet.compile(["packages/*", "tools/cli", "!packages/internal-*"]);
  set.matches("packages/app"); // true
  set.matches("packages/internal-x"); // false — excluded
});
```

* `GlobPattern.compile(source, options?)` — compile a pattern, failing typed with `GlobPatternError` (`PatternTooLong`, `ExpansionBudgetExceeded` or `NestingDepthExceeded`) when a guard trips. `matches(candidate)` is **total**: never throws, never hangs.
* `GlobPattern.FromString` — a codec for embedding patterns in config schemas; `escape`/`unescape` statics for building patterns from user-supplied literals.
* Enumerator metadata — `hasMagic`, `negated`, `enumerationPrefix` (the longest literal directory prefix) and `crossesSegments` (whether the pattern can match deeper than one level below it), for consumers that drive directory enumeration from a pattern.
* `GlobPatternOptions` — the full minimatch options surface, schema-validated. Invalid options are a construction defect; the typed error channel is reserved for malformed patterns.
* `GlobSet` — multi-pattern include/exclude **set** semantics: a leading `!` marks an exclusion filter (deliberately distinct from minimatch's whole-pattern negation, which still works at the single-pattern level). Structural accessors (`literals`, `wildcards`, `excludes`, `isExcluded`) serve workspace-style enumerators; brace alternatives classify individually, so `{tools/cli,packages/*}` contributes one literal and one wildcard.

### Hardened against hostile input

Every upstream DoS guard is preserved — the 64KB pattern-length cap, the brace-expansion output budget, the CVE-2022-3517 ReDoS-safe pre-check and the bounded globstar backtracker — and new depth guards cover every remaining recursion surface, so malformed input always fails through the typed channel rather than as a stack overflow or a hang.

The port also closes a hole present in stock minimatch 10.2.5: coalescible extglob adoption chains recurse without ever incrementing the extglob depth counter, so a ~60KB pattern of nested `@(` groups — under minimatch's own length cap — overflows the stack at default options. Here a structural depth backstop fails it typed.

### Two deliberate deviations from upstream

* **No ambient environment detection.** Upstream reads `process.platform`; here `platform` is an explicit option defaulting to `"posix"`. Win32 path handling (drive letters, UNC roots, backslash separators) is kept, behind the option.
* **Typed budget exhaustion.** Where upstream silently truncates an over-budget brace expansion — silently changing match semantics — exhausting the budget fails typed with `ExpansionBudgetExceeded`.

And `**` is real: `packages/**` matches `packages/a/b`. The single-level rewrite some workspace tooling applies to a trailing globstar is not carried forward.
