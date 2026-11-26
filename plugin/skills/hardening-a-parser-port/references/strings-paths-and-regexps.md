# Strings, paths and regular expressions built from input

Five traps where the code is correct on every fixture you are likely to write
and wrong on the input an attacker, or an unusual layout, supplies.

## Path bases: `git diff --name-only` is REPO-relative, `git ls-files` is CWD-relative

Both commands run from the subdirectory `pkgs/alpha`, with the **same file**
modified:

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
source: **`git ls-files --full-name`** prints repo-relative paths
(`pkgs/alpha/nested.txt`).

Two further asymmetries: `ls-files` is also **scoped** to the cwd (it lists only
files under `pkgs/alpha`), while `diff --name-only` reports the **whole repo** —
so the two commands do not even cover the same set of files.

> **When combining the output of two commands, never assume they share a path
> base. Verify each one's base independently.** Mixing bases is *silently
> correct* whenever the two happen to coincide — which is the common case, and
> the one your tests will cover.

The testing consequence: **a fixture where the workspace root and the git root
coincide cannot distinguish the correct implementation from the broken one.**
Any test for path-base handling must place the workspace root *below* the git
root, or it proves nothing.

## Structurally indistinguishable parses: position is the only sound discriminator

pnpm writes a **two-document** `pnpm-lock.yaml` under `configDependencies`.
No *structural* rule can pick the right document: both carry `lockfileVersion`,
`importers` and `packages`, and the preamble validates cleanly against the same
schema. A "pick the document that looks like a lockfile" heuristic selects the
wrong one and reports success.

**POSITION is the only sound discriminator** — the real lockfile is the last (or
the nth) document, by the format's own framing rule. That is why the bug is
silent: a structural heuristic *does* find a valid-looking answer.

> When two candidate parses are structurally indistinguishable, a structural
> heuristic is not a rule — it is a coin flip that happens to land right on your
> fixtures. Discriminate on the framing (position, document index, an explicit
> marker), and make the choice explicit in the code.

## A port that builds a `RegExp` from input: force its compile inside the typed catch

`new RegExp(source)` succeeding proves only that the syntax parsed. V8 builds
the code on the first `exec`, and a source too large for it throws a
`SyntaxError` ("Regular expression too large") there. It builds that code
separately for a one-byte (Latin-1) subject and a two-byte one, each on its
first `exec` of that kind, and a source of non-Latin-1 literals compiles
trivially for a one-byte subject, which can never match it. If the first
`exec` of either kind is a match, the throw escapes a total `matches` as a
defect, outside every typed catch. In a glob matcher, about 32,000 literal
characters and one wildcard throw on `matches("x")`, and
`"ā".repeat(33_000) + "*"` survives a one-byte warm-up and throws on
`matches("ā…")`.

So run the regexp once on each kind of subject where it is built, inside the
catch that turns a `SyntaxError` into the typed failure:

```ts
const compileOrFail = (source: string, flags: string): RegExp => {
  try {
    const regexp = new RegExp(source, flags)
    regexp.test("") // forces V8's lazy one-byte compile
    regexp.test("Ā") // and its two-byte one, so a match is never the first exec of either
    return regexp
  } catch (e) {
    if (e instanceof SyntaxError) throw new GuardExceeded("InvalidRegExp", 0, 0)
    throw e
  }
}
```

Only flags without `g` or `y` make that `test` stateless. A spy that counts
`RegExp` constructions during matching cannot see this defect, because no
construction happens there: pin it with a row whose source is too large, and
assert that compiling fails typed and that `matches` never throws.

## A string replacement reads `$` patterns: substitute with `split`/`join`

`String.prototype.replace` and `replaceAll` with a STRING replacement read
`$&`, `$$`, `` $` ``, `$'` and `$<name>` as patterns, so substituting
untrusted text with `template.replaceAll("*", match)` turns a match of
`a$&b` into `a*b` and `` a$`b `` into the text before the star. Wherever the
replacement is data (a path segment, a file name, a pattern match), substitute
literally:

```ts
const substituteEveryStar = (template: string, match: string): string => template.split("*").join(match)
const substituteFirstStar = (template: string, match: string): string => {
  const at = template.indexOf("*")
  return at === -1 ? template : template.slice(0, at) + match + template.slice(at + 1)
}
```

A replacer function (`replace(re, () => match)`) is also literal. The one
exception is deliberate parity with a reference that itself uses a string
replacement: `@effected/tsconfig-json` keeps `replace(/\*/g, subpath)`
because tsc does, and pins it with a test.

## A consumer-side regex over `raw` spans must strip continuations first

A parser that keeps each token's `raw` source slice keeps whatever the format
removes before it tokenizes. Shell is the sharp case: bash deletes every
backslash-newline (`\⏎`) before it reads a token, and so does
`@effected/shell`, which resolves `[\⏎[` to `[[`. But `raw` keeps the `\⏎` as
written. A guard that runs a pattern over `raw` (`/\(\(/`, `/^\[\[$/`,
`/PS4=/`) misses the split spelling, and bash runs the joined one:
`[\⏎[ x -eq 0 ]]`, `(\⏎( x ))` and `P\⏎S4=…` each pass a guard that matches
`raw`.

Strip continuations before any text match, the way the format does: in
`@effected/shell`, match `ShellWord.joined` and `ShellAssignment.joined`, never
`raw`. When the parser offers no joined accessor, join exactly where the
format joins (bash keeps `\⏎` inside single quotes and after an escaping
backslash) and test every position a continuation can take in the pattern's
input. A port that exposes `raw` should also expose the joined text, so each
consumer does not have to write its own stripping and get it wrong.

The same blindness hits a guard keyed on parse structure when the program
re-parses an argument at run time. bash's `declare -a 'x=($(cmd))'` is a
quoted word to the parser, with no array part. But `declare` re-reads a
`( … )` value as a compound assignment when its target is an array, and runs
`cmd`. `printf -v`, `read` and `trap` re-read their arguments in the same way.
A rule that looks for the parsed construct (an `opaque` array part) never sees
the quoted spelling of the same construct. For each argument the program
re-reads, refuse any value that is not literal or that could take the
re-read form after quote removal.
