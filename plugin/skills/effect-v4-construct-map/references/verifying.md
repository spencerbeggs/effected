# How to verify quickly

One runtime probe beats an hour of type-error archaeology — **but a probe that
answers from the wrong place is worse than no probe**, because it confirms a
conclusion with total confidence. Five rules, each earned.

**1. `cd` into the package. Print the resolved version inside the probe.**
The repo root resolves `effect@3.x`; only `packages/<pkg>/` resolves the v4
beta. A root-run probe reports the **v3** surface — and will sometimes *agree*
with the v4 answer by luck, which no working-directory warning can catch.

~~~bash
cd packages/<pkg> && node --input-type=module -e "
const v = (await import('effect/package.json', { with: { type: 'json' } })).default.version;
console.log('resolved effect:', v);   // must be 4.x, or your answer is meaningless
import * as S from 'effect/Schema';
console.log(typeof S.TheApiYouWant);
"
~~~

**2. `typeof x === 'undefined'` does NOT mean "removed".** Type-only exports
(`Context.Key`, `Context.Tag`) are `undefined` at runtime while being perfectly
alive in the `.d.ts`. For a type, read `node_modules/effect/dist/*.d.ts` —
note the declarations are at `dist/`, **not** `dist/dts/`.

**3. A probe file must LIVE inside the package.** Bare specifiers resolve from
the file's location, not the cwd, so a probe copied to `/tmp` cannot resolve
`effect` at all. But the tsconfig `include` is `${configDir}/*.ts` and does
**not** match subdirectories — a probe in a subdir silently falls out of the
compilation program and gives a **false pass** on a deliberate control error.
Put it at the package root. **Run your control error FIRST**, confirm it fires,
then test the real thing. Delete it by *absolute* path immediately — a probe
left at the package root breaks every other agent's `types:check`.

A control that fires, verified against beta.94:

~~~ts
import { Effect } from "effect";
export const control = Effect.catchAll;   // v3 name; MUST error
// probe.ts(2,31): error TS2339: Property 'catchAll' does not exist on type 'typeof Effect'
~~~

**For a type-level probe, `@ts-expect-error` needs its own control.** An
*unused* `@ts-expect-error` is itself an error (TS2578) under tsgo — confirm
that before trusting a consumed one, or a directive that silently matched
nothing reads exactly like a proven claim.

**4. Construct memoized global state in the same order the code under test
will.** `ConfigProvider.fromEnv()` snapshots `process.env` at construction and
`Context.Reference` memoizes; a probe that reads the reference before setting
the var "proves" the provider ignores the environment.

**5. A green vitest run that reports `0 tests passed` is a FAILED run.** A
module-level throw (see the `Context.Service` TDZ in `effect-v4-services-layers`)
is swallowed by the agent reporter and exits 0. Zero collected tests is never a
pass — read the Tests line, not the exit code.

For dual/curried APIs, probe the arity (`L.effect.length`).

## When a tool returns nothing, that is not an answer

**A shell tool that errors, or is silently not looking at your file, produces a
clean-looking "no problems found".** Each of these has burned a real session:

- `rg` against a nonexistent path prints an error that reads like a clean
  no-match; `rg -E` is parsed as `--encoding` under the `ugrep` alias and dies.
  Never pair a search with an `|| echo "absent"` fallback — the failure becomes
  the conclusion. Verify the path exists first.
- **`npx biome check <path>` from inside a package exits 0 on a file with real
  violations** — it is not picking up the repo config. Lint through the repo's
  own command (`pnpm lint`), and prove the harness by planting a violation you
  know is caught. An exit 0 with *no output at all* is the tell.
- **`perl -pi -e 's|…|…|'` uses `|` as the delimiter.** A pattern or replacement
  that itself contains `|` (very much including `||`) terminates the field early
  and silently rewrites something else — verified to corrupt every line of the
  target file. Prefer the editor over a regex one-liner for source edits; if you
  must, pick a delimiter absent from both sides.
