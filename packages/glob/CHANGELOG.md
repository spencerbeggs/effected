# @effected/glob

## 0.2.0

### Features

* ### Synchronous compilation: `GlobPattern.compileResult` and `GlobSet.compileResult`

  ```ts
  import { Result } from "effect";
  import { GlobPattern } from "@effected/glob";

  const compiled = GlobPattern.compileResult("packages/*");
  if (Result.isSuccess(compiled)) compiled.success.matches("packages/a");
  ```

  Both new statics return `Result<_, GlobPatternError>` instead of an `Effect`. Compiling a pattern or a pattern set is pure string→predicate work with no IO and no async step, so the sync form is now the primitive: `GlobPattern.compile` and `GlobSet.compile` are thin derivations of their sync counterparts, adding only the tracing span. Both `compile` signatures are unchanged.

  This removes the `Effect.runSync(Effect.result(...))` escape hatch that synchronous call sites — a lint-staged handler, a config predicate — were forced through for work that never actually needed an Effect runtime. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.1.2

### Dependencies

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.1

### Documentation

* Documents on `GlobPattern.enumerationPrefix` (with a cross-reference on `crossesSegments`) that the getter is meaningful for non-negated patterns only. A negated pattern's prefix is still computed from the inner pattern while `matches` inverts the result, so the pattern can match paths outside its own `enumerationPrefix` — a consumer that bounds traversal to the prefix must guard on `negated` and deep-walk from the inner prefix instead. [#106][#106]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.1.0

### Features

* Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies. `GlobPattern.compile` is the one fallible entry point; once a `GlobPattern` exists, `matches` is total — pure, synchronous, no error channel, and no hostile pattern can make it overflow, allocate unboundedly or hang, because every guard fired before the instance was constructed.

  ### Compile once, match many

  `GlobSet.compile` builds include/exclude sets where a leading `!` is an exclusion filter. A compiled pattern also carries the metadata a directory enumerator needs to skip trees that cannot match.

  ```ts
  import { GlobPattern, GlobSet } from "@effected/glob";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const pattern = yield* GlobPattern.compile("packages/**");
    console.log(pattern.matches("packages/a/b/c"));
    // true — ** really crosses segment boundaries
    console.log(pattern.enumerationPrefix, pattern.crossesSegments);
    // "packages/" true

    const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
    console.log(set.matches("packages/core"), set.matches("packages/internal"));
    // true false
  });

  Effect.runPromise(program);
  ```

  ### Embed patterns in config schemas

  `GlobPattern.FromString` is a `Schema.Codec<GlobPattern, string>` that validates compilability at decode time, so an uncompilable pattern fails as a schema issue before your program ever sees a `GlobPattern`.

  ```ts
  import { GlobPattern } from "@effected/glob";
  import { Schema } from "effect";

  const Config = Schema.Struct({
    include: Schema.Array(GlobPattern.FromString),
  });
  ```

  Compilation is the only thing that fails, and it fails with one tagged `GlobPatternError` whose `reason` names the guard that fired — `PatternTooLong`, `ExpansionBudgetExceeded` or `NestingDepthExceeded` — carrying `limit` and `actual` rather than a message you have to parse. Where upstream truncates an over-budget brace expansion (silently changing what the pattern matches), this package fails instead. `GlobPattern.escape` / `unescape` build patterns safely from user-supplied literals. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
