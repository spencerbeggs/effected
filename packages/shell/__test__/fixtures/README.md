# Fixtures

Both corpora are hand-authored JSON: every expected value was written by
hand, checked against GNU bash 5.3.20 where bash and the source disagree, and
none of it was produced by running this package. `corpus.test.ts` asserts each
file's case count before running its cases, so a truncated file fails loudly.

## Case format

Each case has a `name`, an `input` and an `expect` block. A word with a literal
is written as that string; a word without one is written as
`{ "raw", "kinds" }` (its source text and part kinds), so no case can pass by
reading an expansion as a literal. A segment lists `words`, `operator` (or
`null`), and, when present, `assignments` (`[name, word]`), `redirections`
(`[fd, operator, target]`, a heredoc target written as
`{ "heredoc", "quoted", "body" }`) and `groupDepth`. A script-level
`comments` or `diagnostics` list defaults to empty. `commands` and
`substitutions` (agent shapes only) check `ShellScript.commands()` and the
parse of each substitution body.

## shell-quote.json

- **Producing tool:** none. The cases are ported by hand from the tests of
  `shell-quote` 1.10.0 (MIT, Copyright (c) 2013 James Halliday), files
  `test/parse.js`, `test/op.js`, `test/comment.js`, `test/set.js` and
  `test/env.js`, read from the copy installed at
  `node_modules/.pnpm/shell-quote@1.10.0/node_modules/shell-quote/test/` on the
  author's machine. The published 1.12.0 tarball ships no tests, so 1.10.0 is
  the newest corpus available. Each case's `source` names its file.
- **What it pins:** that every input the reference tokenizer tests is lexed
  and segmented the way bash would, by this package's non-expanding rules.
- **Divergences are deliberate and named per case** in a `divergence` field.
  The classes are: `shell-quote` expands variables from an environment and
  this package never does; it throws on `${}` and `${` and this package
  records a diagnostic; it is lenient about unterminated quotes in ways bash
  is not; it starts a comment at a mid-word `#` and bash does not; it returns
  an fd prefix (`2>`) and a leading assignment (`ABC=444`) as words; and it
  returns parentheses and `<(` as operator tokens where this package records
  `groupDepth` and process-substitution parts.
- **Not ported:** the `quote()` round-trip case, the custom-escape-character
  cases (`{ escape: '^' }`), whose option has no counterpart here (the plain
  form of the one control-character case is ported instead), the
  `splitUnquoted` field-splitting cases, which depend on expansion, and the
  linear-time case, which `hostile.test.ts` covers at a larger size.

## agent-shapes.json

- **Producing tool:** none; hand-authored.
- **Why hand-authored:** these are the command shapes coding agents emit in
  Bash tool calls (chained commands; `git commit -m "$(cat <<'EOF' … EOF)"`;
  `gh pr create --body-file -` fed by a heredoc; env-prefixed commands;
  `cd dir && …`; the `sudo` / `env` / `command` / `exec` / `nohup` / `time`
  wrappers; CRLF input; unterminated quotes and heredocs; brace expansion and
  substitutions hiding a command), written from issue 1204 and the
  savvy-web/systems commit guard it replaces. No tool emits them.
- **What it pins:** that a guard reading `ShellScript.commands()` and
  `substitutions()` sees every command these shapes would run, and nothing
  inside a heredoc body.
