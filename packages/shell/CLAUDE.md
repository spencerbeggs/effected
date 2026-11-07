# @effected/shell

A tolerant shell-syntax lexer and segmenter: `ShellSyntax.parse(input)` returns a `ShellScript` of segments (simple commands split on `&&`, `||`, `;`, `|`, `|&`, `&`, the `case` terminators and newlines), each with its words, leading assignments and redirections, and words carrying their quoting provenance as typed parts. `ShellCommand.fromSegment` resolves a segment to its command name, unwrapping `sudo`, `env`, `command`, `exec`, `nohup` and `time`. Built for agent-hook guards that must know every command a Bash tool call would run.

**Tier: pure.** `effect` is the only peer; no runtime dependency, no `node:` import, no service, no layer, `"sideEffects": false`. Never add a dependency: positions stay UTF-16 offsets, and a consumer that wants line/character uses `@effected/source` itself. `__test__/entrypoints.test.ts` pins the import set, the manifest and the export list.

**Design doc:** `@./okf/modules/shell.md`. Why a package, why not core `CommandLine`, and the contract: `@./okf/decisions/shell-syntax-package.md`. Load when: changing the contract, the part kinds, the operator set, the wrapper list or the grammar's reach.

## The contract (load-bearing, never weaken)

- **Never evaluate.** No expansion of any kind and no execution. An expansion is a marked part (`variable`, `commandSubstitution`, `arithmetic`, `processSubstitution`, `glob`, `brace`, `tilde`) with its span; bodies are opaque text.
- **Never fail.** `ShellSyntax.parse` is total and synchronous; it returns a plain `ShellScript`, not a `Result`. Input the lexer cannot finish becomes an `opaque` part to the end of the input plus a `ShellDiagnostic`. No code path may throw on any input; the property test in `__test__/hostile.test.ts` holds it.
- **Fail closed.** `ShellWord.literal` is `Some` only for bare, single-quoted, ANSI-C and expansion-free double-quoted parts. Adding a part kind means deciding whether it can be literal; the default is no. Where grammar is missing, over-split (report a command the shell might not run), never under-split. In particular never read a heredoc that may not be there: a spurious one hides the lines after it, a missed one only reports its body. A token whose meaning depends on an enclosing construct needs a test inside each construct, in both scanners, and the constructs come from the bash grammar, not from memory. For `<<` (a heredoc in command text, a shift in arithmetic) they are `(( ))`, `$(( ))`, `$[ ]` and the `[ ]` subscript of a command-position `NAME[` word; `let`'s operands are ordinary words, where `<<` is a heredoc. Command position is bash's `reserved_word_acceptable`, not a local notion: the lexer's `Follows` states carry `time -p`, `time --`, `function NAME`, `coproc NAME`, `[[ … ]]`, `((…))` and `for NAME`. `\⏎` is gone before bash tokenizes, except in a comment, single quotes, after an escaping backslash or in a quoted heredoc body: every lookahead that joins two characters goes through `skipContinuations`, in both scanners and in `heredoc.ts`. A heredoc delimiter holding an expansion opener reads no body (`ExpansionInHeredocDelimiter`), since bash rebuilds `$( … )` from its parse.
- **Every substitution is reachable.** Any part that can hold a `$(…)`, backtick or `<(…)` carries `substitutions` (or `expansions`), and `ShellScript.substitutions()` names every part kind in an exhaustive switch. A new part kind that can hold one must join that switch.
- **Not `CommandLine.Word`.** The result types must never become core's execution vocabulary.

## Known limits

This was checked against GNU bash 5.3 only, with the reviewed shapes, every position of a backslash-newline in them, and a random differential fuzz. That is evidence, not proof, and dash, zsh and POSIX-mode bash were not tested. A guard must not treat `commands()` as a complete gate until these are closed. Two parser modes hide a command with no diagnostic: under `shopt -s extglob` (or an inherited `BASHOPTS`), `echo @(<<E)` and `cat <<E@(x)` read a heredoc bash does not, and under `shopt -s expand_aliases` an alias body is never read (`alias c='git commit'`, then `c`). So refuse `shopt` and `alias`, which are reported as command names, and control the environment. Text handed to another parser is not read: `eval`, `bash -c`, `source`, `xargs`, `find -exec` and `ssh` are reported as their own name. A script with any diagnostic may hide a command (`x=$(echo a[ )` swallows the lines after it as one unterminated substitution), so treat every diagnostic as a refusal, as the README guard does.

## Layout

- `src/ShellSyntax.ts` — the facade: calls the engine, materializes raw records into the Schema classes. The only module that imports `internal/lexer.ts`.
- `src/ShellScript.ts`, `ShellSegment.ts`, `ShellWord.ts`, `ShellWordPart.ts` (twelve part classes on a `kind` discriminant), `ShellAssignment.ts`, `ShellRedirection.ts`, `ShellHeredoc.ts`, `ShellComment.ts`, `ShellDiagnostic.ts`, `ShellCommand.ts` — one concept each.
- `src/internal/` — the engine, which imports no public module: `raw.ts` (carrier records and the literal vocabularies the public `Schema.Literals` read), `lexer.ts` (the one forward scan), `nested.ts` (the explicit-stack skip scanner for opaque bodies), `heredoc.ts` (delimiter reading and body consumption, shared by both scanners), `ansiC.ts` (the `$'…'` decoder).

## Hardening invariant

Linear time, no recursion on input depth, no throw. Specifically:

- `nested.ts` keeps nesting on a frame array; never turn it into a recursive descent. It also skips heredoc bodies inside `$(…)`, which is what keeps `it's` in a commit-message heredoc from opening a quote. Its arithmetic frames (`ARITH_SUBST`, `ARITH_GROUP`) read no heredoc and no comment, and demote to a substitution or group when the second `)` is missing. `ARITH_BRACKET` is a matched `[ … ]` (`$[`, and a subscript at any word start of command text): quotes, escapes and substitutions only, so `<<`, `#` and `)` are plain. The lexer reads a subscript only in command position, and an unclosed one is opaque to the end with `UnterminatedSubscript`, since bash reads it to EOF and rejects it.
- A top-level `((` that turns out to be two subshells sets `arithmeticFailUntil` and `heredocOffUntil`, so a megabyte of `((` is not re-scanned from every offset.
- Diagnostics are capped at 1000 plus one `DiagnosticLimitReached`.
- `bracketClose` caches its last failure so a run of `[` is linear; brace expansion is matched with a stack over per-word events. Any new lookahead needs the same treatment: ask what a megabyte of its opener costs.
- `decodeAnsiC` range-checks `\u`/`\U` before `String.fromCodePoint` (U+10FFFF), keeping an out-of-range escape as written plus an `InvalidAnsiCEscape` diagnostic.
- `ShellCommand`'s wrapper table is a `Map`, so `constructor` / `__proto__` never resolve as wrappers.
- `__test__/hostile.test.ts` holds 64 one-megabyte units to a linear growth ratio and runs 3000 random shell-dense strings through span-tiling invariants. Add a unit for every new opener.

## Testing

- `__test__/fixtures/` — `shell-quote.json` (the `shell-quote` 1.10.0 parse corpus ported to non-expanding semantics, divergences named per case) and `agent-shapes.json`; provenance in `fixtures/README.md`. `corpus.test.ts` asserts each corpus's case count first.
- `__test__/mutation-controls.test.ts` — each operator and quoting rule pinned by inputs differing in exactly the character the rule is about.
- `__test__/bypass-regressions.test.ts` — every shape a review found bash running that the analyzer hid, each with a control, plus the README guard run over them. Add a case here, checked against real bash, for any new bypass.

```bash
pnpm vitest run packages/shell
pnpm build --filter @effected/shell
```

Tests use `@effect/vitest` and `assert.*`, never `expect`.
