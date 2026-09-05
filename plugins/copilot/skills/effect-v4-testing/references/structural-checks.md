# Structural checks — asserting over source text

Loaded from `effect-v4-testing`. A **structural check** is a test whose subject
is source text rather than behavior: "this module does not reach that
dependency", "the entrypoint exports this by name", "nothing outside the seam
calls `Redacted.value`". They are the only way to pin an invariant a type
cannot express and a runtime cannot observe — and they fail silently in ways an
ordinary assertion does not, because the substrate they read is *prose plus
code*, and prose says everything.

Working examples in this repo: `packages/github/__test__/reachability.test.ts`,
`packages/github-actions/__test__/reachability.test.ts`,
`packages/npm/__test__/reachability.test.ts`,
`packages/github-actions/__test__/Secret.test.ts`.

## The direction rule: which substrate is safe depends on the assertion

Raw, unstripped source is:

- **SAFE for a `notInclude`-shaped check.** A comment naming the forbidden
  thing makes the test fail — a spurious alarm. Annoying, loud, fixable.
- **DANGEROUS for an `include`-shaped check.** A comment naming the required
  thing makes the test **pass**. Silent, and indistinguishable from the code
  actually being there.

So: **strip comments for include-shaped checks; you may keep raw source for
notInclude-shaped ones**, and say in a comment which direction you relied on,
because the next reader will otherwise "fix" the inconsistency in the wrong
direction. A repo-wide sweep on 2026-07-25 found zero remaining silent-pass
sites; the two alarm-direction sites carry the rule as comments.

The same rule stated as a habit: **before writing a structural assertion, ask
which way it fails when the substrate is wrong.** If the answer is "it passes",
the substrate must be narrowed first.

## An include-shaped check passes falsely THREE ways

"`index.ts` exports `NpmRegistry`" as a naive `source.includes("NpmRegistry")`
survives deleting the export three independent ways. Each was found by a
mutant that survived the *previous* fix
(`packages/npm/__test__/reachability.test.ts:105-135`):

1. **A comment naming it** — the doc block above the deleted export still says
   `NpmRegistry`. Closed by stripping comments.
2. **The module specifier** — `from "./NpmRegistry.js"` contains the name as a
   substring, and the specifier survives comment-stripping. Closed by removing
   specifiers before matching: `.replace(/from\s*["'][^"']+["']/g, "")`.
3. **A neighbouring identifier that contains it** — `type NpmRegistryShape`
   next door. Closed by matching on a word boundary, `/\bNpmRegistry\b/`, not
   as a substring.

Only all three together make the test fail when the export is gone:

```ts
const code = stripComments(read("index.ts")).replace(/from\s*["'][^"']+["']/g, "");
assert.match(code, /\bNpmRegistry\b/, "index.ts must export NpmRegistry by name");
```

Stripping also buys something else: the prohibition can be **written down in
the test's own prose** without tripping the check that enforces it.

## Comment strippers: LINE comments come out BEFORE block comments

The ordering is load-bearing, not stylistic. Prose containing a `/*`-bearing
token — a glob like `src/*`, a scope like `@octokit/*` or `@azure/*` — opens a
block comment as far as a regex is concerned. Strip blocks first and that
phantom opener runs to the close of the **next** doc comment, deleting every
import in between; the walker then reports a module as importing **less** than
it does. For a confinement test ("X must not reach Y") that is the permissive
direction: a lost edge is a false **pass**. Blocks cannot nest, so once the
fake openers are gone a real `/*` inside a real block comment is harmless.

```ts
const code = source
  .replace(/(^|\n)\s*\/\/.*/g, "$1")   // LINE comments first
  .replace(/\/\*[\s\S]*?\*\//g, "");   // then blocks
```

**`@example` blocks contain real import statements.** That is why an import
walker must strip at all — on its first run the `@effected/github` walker
"found" an edge that existed only in a doc comment. Phantom edges are the
notInclude direction's spurious alarm; the LINE-ordering bug above is the
include direction's silent pass. One walker can suffer both.

## Once the stripper is load-bearing, it needs its own discriminating test

A blinded scan is a silent false green, and nothing else in the suite can see
it. Give the stripper a test, and make the fixture discriminate:

- **The token must sit in a LINE comment.** Inside a block comment a `/*` is
  swallowed by its own comment and is harmless, so a fixture built that way
  passes with *or without* the fix — it proves nothing.
- Assert both directions: the mention is removed, and a real call on the next
  line survives.

```ts
// The stripper's own test (packages/github-actions/__test__/Secret.test.ts:244-245)
assert.notInclude(stripComments("/** mentions Redacted.value in TSDoc */\nconst a = 1;"), "Redacted.value");
assert.include(stripComments("// a note\nconst t = Redacted.value(s);"), "Redacted.value");

// The walker's own test (packages/github/__test__/reachability.test.ts) —
// the /*-bearing token sits in a LINE comment, which is the whole point.
const fixture = [
  "// Prose naming a scope like @octokit/* and a glob like src/* here.",
  'import { Octokit } from "@octokit/core";',
  "/** A real doc comment, whose close is the phantom's close. */",
  'import { sign } from "universal-github-app-jwt";',
].join("\n");
assert.deepStrictEqual([...runtimeSpecifiers(fixture)], ["@octokit/core", "universal-github-app-jwt"]);
```

## Always ship the positive control

Every "does not reach" assertion needs a sibling "does reach" against a module
that genuinely has the edge. Without it, the confinement assertion passes
whenever the walker is broken — which is the failure mode every rule above
exists to produce. `reachability.test.ts` states this in the test name: *the
App module DOES reach the JWT signer*.

## When the invariant needs an exception, move the seam instead

The temptation once a structural test is in place is to widen it — allow this
one file to call the forbidden thing. Prefer growing the seam a named entry
that satisfies the invariant honestly: when `@effected/github-actions` needed a
raw secret for HMAC signing, `Secret.forSigning` masks at layer construction
(once per credential, itself test-asserted) rather than taking an exemption
from the scan. The structural test then keeps covering every path nobody
audited.
